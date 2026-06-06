"""
app/analytics/routes.py

Dos endpoints de Business Intelligence para la app de agendamiento:

  GET /analytics/performance      → BI completo por profesional
  GET /analytics/resumen-agenda   → Widget rápido para el frontend de agenda
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, date, timedelta
from typing import Optional, Dict, Any
from collections import defaultdict

from app.auth.routes import get_current_user
from app.database.mongo import (
    collection_citas,
    collection_servicios,
    collection_estilista,
    collection_horarios,
    collection_locales,
)

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════
#  HELPERS INTERNOS
# ═══════════════════════════════════════════════════════════════════════

def _parse_date(value: str) -> date:
    """
    Acepta los formatos:
      YYYY-MM-DD  (ISO)
      DD/MM/YYYY
      DD-MM-YYYY
      YYYY/MM/DD
    """
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    raise HTTPException(
        status_code=400,
        detail=f"Formato de fecha inválido: '{value}'. Use YYYY-MM-DD o DD/MM/YYYY",
    )


def _hhmm_to_min(hhmm: str) -> int:
    """'09:30' → 570 minutos."""
    try:
        h, m = map(int, str(hhmm).split(":"))
        return h * 60 + m
    except Exception:
        return 0


def _minutos_disponibles_dia(disponibilidad: list, iso_weekday: int) -> int:
    """
    Retorna cuántos minutos tiene disponible un profesional en un día
    de la semana dado (1 = lunes … 7 = domingo).
    """
    for dia in disponibilidad:
        if (
            int(dia.get("dia_semana", 0)) == iso_weekday
            and dia.get("activo", True) is True
        ):
            return max(
                0,
                _hhmm_to_min(dia.get("hora_fin", "00:00"))
                - _hhmm_to_min(dia.get("hora_inicio", "00:00")),
            )
    return 0


def _minutos_disponibles_periodo(disponibilidad: list, desde: date, hasta: date) -> int:
    """Suma los minutos disponibles de un profesional en todo el período."""
    total = 0
    d = desde
    while d <= hasta:
        total += _minutos_disponibles_dia(disponibilidad, d.isoweekday())
        d += timedelta(days=1)
    return total


def _minutos_cita(cita: dict) -> int:
    """Calcula la duración real de una cita en minutos."""
    try:
        return max(
            0,
            _hhmm_to_min(cita.get("hora_fin", "00:00"))
            - _hhmm_to_min(cita.get("hora_inicio", "00:00")),
        )
    except Exception:
        return int(cita.get("servicio_duracion") or 0)


def _es_cancelada(estado: str) -> bool:
    return estado.strip().lower() in ("cancelada", "no_asistio", "no asistio")


# ─── Scope dinámico ─────────────────────────────────────────────────────────
async def _build_scope_filter(
    current_user: dict,
    sede_id_query: Optional[str],
) -> Dict[str, Any]:
    """
    Construye el fragmento de filtro MongoDB respetando el scope dinámico
    (X-Sede-Id ya resuelto por get_current_user) y el rol del usuario.

    Roles:
      super_admin      → puede pedir cualquier sede o todas
      admin_franquicia → limitado a sedes de su franquicia
      admin_sede       → su sede activa o sedes_permitidas
      recepcionista    → igual que admin_sede
      call_center      → igual que admin_sede
      estilista        → solo sus propias citas (profesional_id forzado)
    """
    rol = current_user["rol"]
    sede_activa = current_user.get("sede_id")
    sedes_permitidas = current_user.get("sedes_permitidas", [])
    franquicia_id = current_user.get("franquicia_id")
    filtro: Dict[str, Any] = {}

    if rol == "super_admin":
        if sede_id_query:
            filtro["sede_id"] = sede_id_query
        # Sin sede_id → todas las sedes (sin filtro)

    elif rol == "admin_franquicia":
        if sede_id_query:
            # Validar que la sede pertenece a la franquicia
            sede_doc = await collection_locales.find_one({"sede_id": sede_id_query})
            if sede_doc and str(sede_doc.get("franquicia_id")) != str(franquicia_id):
                raise HTTPException(
                    status_code=403,
                    detail="Esa sede no pertenece a tu franquicia",
                )
            filtro["sede_id"] = sede_id_query
        else:
            # Todas las sedes de la franquicia
            sedes_docs = await collection_locales.find(
                {"franquicia_id": franquicia_id}
            ).to_list(None)
            ids_fran = [s["sede_id"] for s in sedes_docs if s.get("sede_id")]
            if ids_fran:
                filtro["sede_id"] = {"$in": ids_fran}

    elif rol in ("admin_sede", "recepcionista", "call_center"):
        if sede_id_query:
            autorizadas = set(filter(None, [sede_activa] + sedes_permitidas))
            if sede_id_query not in autorizadas:
                raise HTTPException(
                    status_code=403,
                    detail="No tienes acceso a esa sede",
                )
            filtro["sede_id"] = sede_id_query
        else:
            filtro["sede_id"] = sede_activa

    elif rol == "estilista":
        filtro["sede_id"] = sede_activa
        filtro["profesional_id"] = current_user.get("profesional_id")

    else:
        raise HTTPException(
            status_code=403,
            detail=f"El rol '{rol}' no tiene acceso a analytics",
        )

    return filtro


def _comision_pct(
    categoria: str,
    servicio_id: str,
    prof_doc: dict,
) -> float:
    """
    Determina el % de comisión del profesional para un servicio.

    Prioridad de búsqueda en el documento del estilista:
      1. comisiones_por_categoria[categoria]
      2. comisiones[categoria]
      3. comisiones[servicio_id]          (fallback por servicio_id)
      4. comision_servicios               (tasa plana)
      5. comision                         (tasa plana legacy)
    """
    comisiones_cat = (
        prof_doc.get("comisiones_por_categoria")
        or prof_doc.get("comisiones")
        or {}
    )
    if isinstance(comisiones_cat, dict):
        pct = (
            comisiones_cat.get(categoria)
            or comisiones_cat.get(servicio_id)
        )
        if pct is not None:
            return float(pct)

    return float(
        prof_doc.get("comision_servicios")
        or prof_doc.get("comision")
        or 0
    )


# ═══════════════════════════════════════════════════════════════════════
# 📊  ENDPOINT 1: PERFORMANCE ANALYTICS  (BI completo por profesional)
# ═══════════════════════════════════════════════════════════════════════
@router.get("/performance", response_model=dict)
async def analytics_performance(
    fecha_desde: Optional[str] = Query(
        None,
        description="Inicio del período. Formatos: YYYY-MM-DD | DD/MM/YYYY | DD-MM-YYYY. "
                    "Default: primer día del mes actual.",
    ),
    fecha_hasta: Optional[str] = Query(
        None,
        description="Fin del período. Mismos formatos que fecha_desde. Default: hoy.",
    ),
    sede_id: Optional[str] = Query(
        None,
        description="Filtro de sede. Solo disponible para super_admin y admin_franquicia.",
    ),
    profesional_id: Optional[str] = Query(
        None,
        description="Filtrar un único profesional.",
    ),
    current_user: dict = Depends(get_current_user),
):
    """
    ## Performance Analytics por profesional

    Retorna para cada profesional en el período:

    ### KPIs
    - **ingresos_generados** — suma de `valor_total` de citas no canceladas
    - **comision_proyectada** — calculada por servicio usando la tasa de comisión
      del profesional para la *categoría* del servicio (campo `categoria` en
      la colección `services`).  Si el estilista tiene tasas por categoría en
      `comisiones_por_categoria`, se usan esas; de lo contrario se usa la tasa
      plana en `comision_servicios` o `comision`.
    - **ticket_promedio** — ingresos / número de citas activas
    - **tasa_ocupacion_pct** — (minutos agendados / minutos disponibles según
      horario) × 100.  `null` si el profesional no tiene horario configurado.
    - **horas_agendadas / horas_disponibles** — para visualizar la ocupación

    ### Volumen
    - Conteo de citas por estado (confirmada, completada, cancelada…)

    ### Breakdown
    - **por_categoria** — ingresos y comisiones agrupados por categoría de servicio
    - **top_servicios** — los 10 servicios que más ingresos generaron

    ### Scope dinámico
    | Rol               | Scope                                    |
    |-------------------|------------------------------------------|
    | super_admin       | Todas las sedes o la sede_id solicitada  |
    | admin_franquicia  | Sedes de su franquicia                   |
    | admin_sede        | Su sede activa o sedes_permitidas        |
    | recepcionista     | Ídem admin_sede                          |
    | call_center       | Ídem admin_sede                          |
    | estilista         | Solo sus propias citas                   |
    """

    # ── 1. Fechas ──────────────────────────────────────────────────────
    hoy = date.today()
    d_desde = _parse_date(fecha_desde) if fecha_desde else hoy.replace(day=1)
    d_hasta = _parse_date(fecha_hasta) if fecha_hasta else hoy

    if d_desde > d_hasta:
        raise HTTPException(
            status_code=400,
            detail="fecha_desde no puede ser mayor que fecha_hasta",
        )

    str_desde = d_desde.strftime("%Y-%m-%d")
    str_hasta = d_hasta.strftime("%Y-%m-%d")
    dias_periodo = (d_hasta - d_desde).days + 1

    # ── 2. Filtro con scope dinámico ───────────────────────────────────
    filtro = await _build_scope_filter(current_user, sede_id)
    filtro["fecha"] = {"$gte": str_desde, "$lte": str_hasta}

    # Filtro adicional por profesional (si no es estilista, ya está forzado)
    if profesional_id and current_user["rol"] != "estilista":
        filtro["profesional_id"] = profesional_id

    # ── 3. Cargar citas ────────────────────────────────────────────────
    citas = await collection_citas.find(filtro).to_list(None)

    if not citas:
        return {
            "periodo": {"desde": str_desde, "hasta": str_hasta, "dias": dias_periodo},
            "resumen_global": {
                "total_ingresos": 0,
                "total_comision": 0,
                "ticket_promedio_global": 0,
                "total_citas": 0,
                "total_profesionales": 0,
                "moneda": "COP",
            },
            "profesionales": [],
        }

    # ── 4. Cargar en batch: servicios, profesionales, horarios ────────
    servicio_ids = set()
    prof_ids = set()
    for c in citas:
        prof_ids.add(c.get("profesional_id"))
        for s in c.get("servicios", []):
            if s.get("servicio_id"):
                servicio_ids.add(s["servicio_id"])

    servicios_docs = await collection_servicios.find(
        {"servicio_id": {"$in": list(servicio_ids)}}
    ).to_list(None)
    servicios_map: Dict[str, dict] = {s["servicio_id"]: s for s in servicios_docs}

    profesionales_docs = await collection_estilista.find(
        {"profesional_id": {"$in": list(prof_ids)}}
    ).to_list(None)
    profesionales_map: Dict[str, dict] = {p["profesional_id"]: p for p in profesionales_docs}

    horarios_docs = await collection_horarios.find(
        {"profesional_id": {"$in": list(prof_ids)}}
    ).to_list(None)
    horarios_map: Dict[str, dict] = {h["profesional_id"]: h for h in horarios_docs}

    # ── 5. Agrupar citas por profesional ──────────────────────────────
    por_prof: Dict[str, list] = defaultdict(list)
    for c in citas:
        pid = c.get("profesional_id") or "sin_asignar"
        por_prof[pid].append(c)

    # ── 6. Calcular métricas por profesional ──────────────────────────
    resultados = []
    moneda_global = "COP"

    for prof_id, citas_prof in por_prof.items():
        prof_doc = profesionales_map.get(prof_id, {})

        # Contadores
        cnt_estados: Dict[str, int] = defaultdict(int)
        ingresos_total = 0.0
        comision_total = 0.0
        minutos_agendados = 0
        citas_con_valor = 0

        servicios_cnt: Dict[str, dict] = defaultdict(
            lambda: {"cantidad": 0, "ingresos": 0.0, "comision": 0.0}
        )
        categorias_cnt: Dict[str, dict] = defaultdict(
            lambda: {"cantidad": 0, "ingresos": 0.0, "comision": 0.0}
        )

        for cita in citas_prof:
            estado = str(cita.get("estado", "pendiente")).strip().lower()
            cnt_estados[estado] += 1

            if _es_cancelada(estado):
                continue  # las canceladas no cuentan para ingresos

            valor = float(cita.get("valor_total") or 0)
            ingresos_total += valor
            if valor > 0:
                citas_con_valor += 1

            minutos_agendados += _minutos_cita(cita)

            if cita.get("moneda"):
                moneda_global = cita["moneda"]

            # ── Servicios de la cita ───────────────────────────────────
            for s_item in cita.get("servicios", []):
                s_id = s_item.get("servicio_id", "")
                s_doc = servicios_map.get(s_id, {})
                subtotal = float(
                    s_item.get("subtotal")
                    or s_item.get("precio")
                    or 0
                )
                categoria = str(s_doc.get("categoria") or "Sin categoría")
                nombre_s = (
                    s_doc.get("nombre")
                    or s_item.get("nombre")
                    or s_id
                    or "Servicio"
                )
                cantidad = int(s_item.get("cantidad") or 1)

                pct = _comision_pct(categoria, s_id, prof_doc)
                comision_item = round(subtotal * pct / 100, 2)
                comision_total += comision_item

                # Por servicio
                servicios_cnt[nombre_s]["cantidad"] += cantidad
                servicios_cnt[nombre_s]["ingresos"] = round(
                    servicios_cnt[nombre_s]["ingresos"] + subtotal, 2
                )
                servicios_cnt[nombre_s]["comision"] = round(
                    servicios_cnt[nombre_s]["comision"] + comision_item, 2
                )

                # Por categoría
                categorias_cnt[categoria]["cantidad"] += cantidad
                categorias_cnt[categoria]["ingresos"] = round(
                    categorias_cnt[categoria]["ingresos"] + subtotal, 2
                )
                categorias_cnt[categoria]["comision"] = round(
                    categorias_cnt[categoria]["comision"] + comision_item, 2
                )

        # ── Ocupación ─────────────────────────────────────────────────
        horario = horarios_map.get(prof_id)
        minutos_disponibles = (
            _minutos_disponibles_periodo(
                horario.get("disponibilidad", []), d_desde, d_hasta
            )
            if horario
            else 0
        )
        tasa_ocupacion = (
            round((minutos_agendados / minutos_disponibles) * 100, 1)
            if minutos_disponibles > 0
            else None
        )

        # ── Citas activas (no canceladas) ─────────────────────────────
        citas_activas = sum(
            v for k, v in cnt_estados.items() if not _es_cancelada(k)
        )

        # ── Ticket promedio ───────────────────────────────────────────
        ticket_promedio = (
            round(ingresos_total / citas_con_valor, 2) if citas_con_valor > 0 else 0
        )

        # Top 10 servicios por ingresos
        top_servicios = sorted(
            [{"nombre": k, **v} for k, v in servicios_cnt.items()],
            key=lambda x: x["ingresos"],
            reverse=True,
        )[:10]

        # Por categoría ordenado por ingresos
        por_categoria = sorted(
            [{"categoria": k, **v} for k, v in categorias_cnt.items()],
            key=lambda x: x["ingresos"],
            reverse=True,
        )

        # Nombre del profesional: primero del doc, luego de la cita
        nombre_prof = prof_doc.get("nombre") or next(
            (c.get("profesional_nombre") for c in citas_prof if c.get("profesional_nombre")),
            prof_id,
        )

        resultados.append(
            {
                "profesional_id": prof_id,
                "nombre": nombre_prof,
                "sede_id": prof_doc.get("sede_id") or (
                    citas_prof[0].get("sede_id") if citas_prof else None
                ),
                "sede_nombre": citas_prof[0].get("sede_nombre") if citas_prof else None,
                # ── KPIs principales ───────────────────────────────────
                "kpis": {
                    "ingresos_generados": round(ingresos_total, 2),
                    "comision_proyectada": round(comision_total, 2),
                    "ticket_promedio": ticket_promedio,
                    "tasa_ocupacion_pct": tasa_ocupacion,
                    "minutos_agendados": minutos_agendados,
                    "horas_agendadas": round(minutos_agendados / 60, 1),
                    "minutos_disponibles": minutos_disponibles,
                    "horas_disponibles": round(minutos_disponibles / 60, 1),
                },
                # ── Volumen ────────────────────────────────────────────
                "citas": {
                    "total": len(citas_prof),
                    "activas": citas_activas,
                    "por_estado": dict(cnt_estados),
                },
                # ── Breakdown ─────────────────────────────────────────
                "por_categoria": por_categoria,
                "top_servicios": top_servicios,
            }
        )

    # Ordenar por ingresos descendente
    resultados.sort(key=lambda x: x["kpis"]["ingresos_generados"], reverse=True)

    # ── 7. Resumen global ──────────────────────────────────────────────
    total_ingresos = round(sum(r["kpis"]["ingresos_generados"] for r in resultados), 2)
    total_comision = round(sum(r["kpis"]["comision_proyectada"] for r in resultados), 2)
    total_activas = sum(r["citas"]["activas"] for r in resultados)
    ticket_global = round(total_ingresos / total_activas, 2) if total_activas > 0 else 0

    return {
        "periodo": {
            "desde": str_desde,
            "hasta": str_hasta,
            "dias": dias_periodo,
        },
        "resumen_global": {
            "total_ingresos": total_ingresos,
            "total_comision": total_comision,
            "ticket_promedio_global": ticket_global,
            "total_citas": sum(r["citas"]["total"] for r in resultados),
            "total_citas_activas": total_activas,
            "total_profesionales": len(resultados),
            "moneda": moneda_global,
        },
        "profesionales": resultados,
    }


# ═══════════════════════════════════════════════════════════════════════
# 📋  ENDPOINT 2: RESUMEN AGENDA  (widget rápido para el frontend)
# ═══════════════════════════════════════════════════════════════════════
@router.get("/resumen-agenda", response_model=dict)
async def resumen_agenda(
    sede_id: Optional[str] = Query(
        None,
        description="Sede a consultar. Respeta el scope dinámico del usuario.",
    ),
    fecha: Optional[str] = Query(
        None,
        description="Día de referencia (default: hoy). Formatos: YYYY-MM-DD | DD/MM/YYYY",
    ),
    current_user: dict = Depends(get_current_user),
):
    """
    ## Resumen rápido para el widget de agenda

    Devuelve en una sola llamada:

    ### `hoy`
    - Total y estado de citas del día
    - Ingresos del día
    - **Tasa de ocupación del día** (minutos agendados / minutos disponibles
      según horario de los profesionales que tienen citas ese día)

    ### `mes`
    - Citas reservadas en lo que va del mes
    - Ingresos acumulados del mes
    - Ticket promedio mensual

    ### `proximas_citas`
    - Las 5 próximas citas del día (para mostrar en la agenda)

    ### `ranking_profesionales_mes`
    - Top 10 profesionales por ingresos en el mes

    Detecta el rol automáticamente:
    - `estilista` → solo ve sus propias citas
    - `admin_sede` / `recepcionista` / `call_center` → toda su sede
    - `admin_franquicia` → toda su franquicia
    - `super_admin` → puede usar el param `sede_id`
    """

    # ── 1. Fechas de referencia ────────────────────────────────────────
    hoy = date.today()
    dia = _parse_date(fecha) if fecha else hoy
    dia_str = dia.strftime("%Y-%m-%d")
    mes_inicio_str = dia.replace(day=1).strftime("%Y-%m-%d")
    # El "mes hasta" es el propio día de referencia para no traer futuro
    mes_hasta_str = dia_str

    # ── 2. Scope dinámico ──────────────────────────────────────────────
    filtro_scope = await _build_scope_filter(current_user, sede_id)

    # ── 3. Citas del día ──────────────────────────────────────────────
    filtro_dia = {**filtro_scope, "fecha": dia_str}
    citas_dia = await collection_citas.find(
        filtro_dia,
        sort=[("hora_inicio", 1)],
    ).to_list(None)

    cnt_dia: Dict[str, int] = defaultdict(int)
    ingresos_dia = 0.0
    minutos_ocupados_dia = 0
    profs_con_citas_hoy: set = set()

    for c in citas_dia:
        estado = str(c.get("estado", "")).strip().lower()
        cnt_dia[estado] += 1
        if not _es_cancelada(estado):
            ingresos_dia += float(c.get("valor_total") or 0)
            minutos_ocupados_dia += _minutos_cita(c)
            if c.get("profesional_id"):
                profs_con_citas_hoy.add(c["profesional_id"])

    # Tasa de ocupación del día
    horarios_hoy = await collection_horarios.find(
        {"profesional_id": {"$in": list(profs_con_citas_hoy)}}
    ).to_list(None)
    horarios_hoy_map = {h["profesional_id"]: h for h in horarios_hoy}

    minutos_disponibles_dia = sum(
        _minutos_disponibles_dia(
            horarios_hoy_map[pid].get("disponibilidad", []),
            dia.isoweekday(),
        )
        for pid in profs_con_citas_hoy
        if pid in horarios_hoy_map
    )
    tasa_dia = (
        round((minutos_ocupados_dia / minutos_disponibles_dia) * 100, 1)
        if minutos_disponibles_dia > 0
        else None
    )

    # Próximas 5 citas del día (no canceladas, ordenadas por hora)
    proximas = []
    for c in citas_dia:
        if _es_cancelada(str(c.get("estado", "")).strip().lower()):
            continue
        proximas.append(
            {
                "cita_id": str(c.get("_id")),
                "hora_inicio": c.get("hora_inicio"),
                "hora_fin": c.get("hora_fin"),
                "cliente_nombre": c.get("cliente_nombre"),
                "profesional_nombre": c.get("profesional_nombre"),
                "servicio_nombre": c.get("servicio_nombre") or ", ".join(
                    s.get("nombre", "") for s in c.get("servicios", [])
                ),
                "estado": c.get("estado"),
                "estado_pago": c.get("estado_pago"),
                "valor_total": c.get("valor_total"),
            }
        )
        if len(proximas) >= 5:
            break

    # ── 4. Citas del mes ──────────────────────────────────────────────
    filtro_mes = {
        **filtro_scope,
        "fecha": {"$gte": mes_inicio_str, "$lte": mes_hasta_str},
    }
    citas_mes = await collection_citas.find(filtro_mes).to_list(None)

    cnt_mes: Dict[str, int] = defaultdict(int)
    ingresos_mes = 0.0
    citas_activas_mes = 0

    ranking_data: Dict[str, dict] = defaultdict(
        lambda: {"nombre": "", "citas": 0, "ingresos": 0.0, "minutos": 0}
    )

    for c in citas_mes:
        estado = str(c.get("estado", "")).strip().lower()
        cnt_mes[estado] += 1
        if _es_cancelada(estado):
            continue

        valor = float(c.get("valor_total") or 0)
        ingresos_mes += valor
        citas_activas_mes += 1

        pid = c.get("profesional_id") or "sin_asignar"
        ranking_data[pid]["citas"] += 1
        ranking_data[pid]["ingresos"] = round(
            ranking_data[pid]["ingresos"] + valor, 2
        )
        ranking_data[pid]["minutos"] += _minutos_cita(c)
        if not ranking_data[pid]["nombre"]:
            ranking_data[pid]["nombre"] = (
                c.get("profesional_nombre") or pid
            )

    ticket_mes = (
        round(ingresos_mes / citas_activas_mes, 2) if citas_activas_mes > 0 else 0
    )

    # Top 10 por ingresos
    ranking = sorted(
        [{"profesional_id": k, **v} for k, v in ranking_data.items()],
        key=lambda x: x["ingresos"],
        reverse=True,
    )[:10]

    # ── 5. Citas del mes por día (sparkline data) ─────────────────────
    citas_por_dia: Dict[str, int] = defaultdict(int)
    for c in citas_mes:
        if not _es_cancelada(str(c.get("estado", "")).strip().lower()):
            citas_por_dia[str(c.get("fecha", ""))] += 1
    citas_por_dia_list = sorted(
        [{"fecha": k, "citas": v} for k, v in citas_por_dia.items()],
        key=lambda x: x["fecha"],
    )

    moneda = (
        citas_dia[0].get("moneda")
        if citas_dia
        else (citas_mes[0].get("moneda") if citas_mes else "COP")
    )

    return {
        "fecha_consulta": dia_str,
        "mes_referencia": f"{dia.year}-{dia.month:02d}",
        "moneda": moneda,
        "rol_consultante": current_user["rol"],
        "sede_id_activa": current_user.get("sede_id"),

        # ── Día ───────────────────────────────────────────────────────
        "hoy": {
            "total_citas": len(citas_dia),
            "activas": len(citas_dia) - cnt_dia.get("cancelada", 0) - cnt_dia.get("no_asistio", 0),
            "por_estado": dict(cnt_dia),
            "ingresos": round(ingresos_dia, 2),
            "minutos_agendados": minutos_ocupados_dia,
            "horas_agendadas": round(minutos_ocupados_dia / 60, 1),
            "tasa_ocupacion_pct": tasa_dia,
            "profesionales_con_citas": len(profs_con_citas_hoy),
        },

        # ── Mes ───────────────────────────────────────────────────────
        "mes": {
            "total_citas": len(citas_mes),
            "activas": citas_activas_mes,
            "por_estado": dict(cnt_mes),
            "ingresos": round(ingresos_mes, 2),
            "ticket_promedio": ticket_mes,
            "citas_por_dia": citas_por_dia_list,   # útil para un sparkline
        },

        # ── Próximas citas del día ────────────────────────────────────
        "proximas_citas": proximas,

        # ── Ranking mensual ───────────────────────────────────────────
        "ranking_profesionales_mes": ranking,
    }