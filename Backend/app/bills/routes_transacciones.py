# ============================================================
# ENDPOINT DETALLE DE TRANSACCIONES (JSON para el frontend)
# Archivo: app/bills/routes_transacciones.py
#
# Uso:
#   GET /api/billing/transacciones
#       ?sede_id=SD-88809
#       &fecha_desde=2026-05-01          ← YYYY-MM-DD o DD-MM-YYYY
#       &fecha_hasta=2026-05-15
#       &tipo_item=ambos                 ← servicios | productos | ambos
#       &profesional=ES-00123            ← profesional_id, nombre o email (opcional)
#       &page=1                          ← paginación (opcional, default 1)
#       &page_size=100                   ← máx 500 (opcional, default 100)
#
# Devuelve:
#   {
#     "total": 312,
#     "page": 1,
#     "page_size": 100,
#     "pages": 4,
#     "sede_nombre": "Sede Centro",
#     "desde": "2026-05-01",
#     "hasta": "2026-05-15",
#     "items": [ { ...TransaccionItem } ]
#   }
#
# Registro en main.py:
#   from app.bills.routes_transacciones import router as transacciones_router
#   app.include_router(transacciones_router, prefix="/api/billing")
# ============================================================

from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime
from typing import Optional

from app.auth.routes import get_current_user
from app.database.mongo import (
    collection_sales,
    collection_citas,
    collection_locales,
    collection_estilista,
    collection_auth,
)

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────

def _parse_fecha(valor: str) -> datetime:
    """Acepta YYYY-MM-DD o DD-MM-YYYY."""
    for fmt in ("%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(valor.strip(), fmt)
        except ValueError:
            continue
    raise ValueError(
        f"Formato de fecha no reconocido: '{valor}'. Use YYYY-MM-DD o DD-MM-YYYY."
    )


# ── Endpoint ──────────────────────────────────────────────────────

@router.get("/transacciones")
async def get_transacciones(
    sede_id:      str           = Query(...,     description="Ej: SD-88809"),
    fecha_desde:  Optional[str] = Query(None,    description="YYYY-MM-DD o DD-MM-YYYY"),
    fecha_hasta:  Optional[str] = Query(None,    description="YYYY-MM-DD o DD-MM-YYYY"),
    tipo_item:    str           = Query("ambos", description="servicios | productos | ambos"),
    profesional:  Optional[str] = Query(None,    description="profesional_id (ES-xxx), nombre o email. Si se omite trae todos."),
    page:         int           = Query(1,       ge=1),
    page_size:    int           = Query(100,     ge=1, le=500),
    current_user: dict          = Depends(get_current_user),
):
    # ── Auth ──────────────────────────────────────────────────────
    rol = current_user.get("rol", "")
    if rol not in ("admin_sede", "super_admin"):
        raise HTTPException(status_code=403, detail="No autorizado")

    # ── Validar tipo_item ─────────────────────────────────────────
    tipo_item = tipo_item.lower().strip()
    if tipo_item not in ("servicios", "productos", "ambos"):
        raise HTTPException(
            status_code=422,
            detail="tipo_item debe ser 'servicios', 'productos' o 'ambos'.",
        )

    # ── Parsear fechas ────────────────────────────────────────────
    hoy = datetime.now()
    try:
        dt_desde = _parse_fecha(fecha_desde) if fecha_desde else hoy.replace(day=1)
        dt_hasta = (
            _parse_fecha(fecha_hasta).replace(hour=23, minute=59, second=59)
            if fecha_hasta
            else hoy.replace(hour=23, minute=59, second=59)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    desde_str = dt_desde.strftime("%Y-%m-%d")
    hasta_str = dt_hasta.strftime("%Y-%m-%d")

    # ── Sede ──────────────────────────────────────────────────────
    sede = await collection_locales.find_one({"sede_id": sede_id})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")
    sede_nombre = sede.get("nombre", sede_id)

    # ── Mapa email → nombre real ──────────────────────────────────
    auth_docs = await collection_auth.find(
        {"sede_id": sede_id},
        {"correo_electronico": 1, "email": 1, "nombre": 1},
    ).to_list(None)

    email_a_nombre: dict = {}
    for doc in auth_docs:
        email  = str(doc.get("correo_electronico") or doc.get("email") or "").strip().lower()
        nombre = str(doc.get("nombre") or "").strip()
        if email and nombre:
            email_a_nombre[email] = nombre

    def resolver_nombre(valor: str) -> str:
        """Si el valor es un email, lo convierte al nombre real; si no, lo devuelve tal cual."""
        v = str(valor or "").strip()
        if not v:
            return v
        if "@" in v:
            return email_a_nombre.get(v.lower(), v.split("@")[0])
        return v

    # ── Mapa profesional_id → nombre ─────────────────────────────
    est_docs = await collection_estilista.find({"sede_id": sede_id}).to_list(None)
    pid_a_nombre: dict = {}
    for e in est_docs:
        pid    = e.get("profesional_id", "")
        nombre = (e.get("nombre", "") + " " + e.get("apellido", "")).strip()
        if pid and nombre:
            pid_a_nombre[pid] = nombre

    nombres_sede  = {sede_nombre.strip().lower(), sede_id.strip().lower()}
    ROLES_PROPIOS = {"recepcionista", "call_center", "admin_sede"}

    # ── Obtener ventas del período (misma lógica que el Excel) ────
    # Ventas ligadas a citas: se filtra por la fecha de la cita (agenda)
    citas_docs = await collection_citas.find(
        {
            "sede_id":        sede_id,
            "estado_factura": "facturado",
            "fecha":          {"$gte": desde_str, "$lte": hasta_str},
        },
        {"_id": 1, "fecha": 1},
    ).to_list(None)

    cita_id_a_fecha: dict = {}
    cita_ids_str: list    = []
    for c in citas_docs:
        oid = str(c["_id"])
        cita_ids_str.append(oid)
        cita_id_a_fecha[oid] = c.get("fecha", "")

    ventas_citas = []
    if cita_ids_str:
        ventas_citas = await collection_sales.find(
            {
                "sede_id":     sede_id,
                "tipo_origen": "cita",
                "origen_id":   {"$in": cita_ids_str},
            }
        ).to_list(None)

    ventas_directas = await collection_sales.find(
        {
            "sede_id":        sede_id,
            "estado_factura": "facturado",
            "tipo_origen":    {"$ne": "cita"},
            "fecha_pago":     {"$gte": dt_desde, "$lte": dt_hasta},
        }
    ).to_list(None)

    ventas = ventas_citas + ventas_directas

    # ── Tipos de ítem permitidos ──────────────────────────────────
    TIPO_PERMITIDO = {
        "servicios": {"servicio"},
        "productos":  {"producto"},
        "ambos":      {"servicio", "producto"},
    }
    tipos_validos = TIPO_PERMITIDO[tipo_item]

    # ── Helper: responsable de un producto ───────────────────────
    def _responsable_producto(v: dict, item: dict, responsable_srv: Optional[str]) -> Optional[str]:
        """
        Devuelve el nombre display del responsable del producto.
        Prioridad:
          1. agregado_por_rol en ROLES_PROPIOS → ese email resuelto
          2. Venta directa con vendido_por válido → vendido_por
          3. Cita → responsable del servicio (estilista)
        """
        agr_rol   = str(item.get("agregado_por_rol",   "") or "")
        agr_email = str(item.get("agregado_por_email", "") or "").strip()
        tipo_origen = v.get("tipo_origen", v.get("tipo_venta", ""))

        if agr_rol in ROLES_PROPIOS and agr_email:
            return resolver_nombre(agr_email)

        vendido_raw = str(v.get("vendido_por", "") or "").strip()
        vendido     = resolver_nombre(vendido_raw)
        local_venta = str(v.get("local", "") or "").strip().lower()
        if vendido.strip().lower() in nombres_sede or vendido.strip().lower() == local_venta:
            vendido = ""

        if tipo_origen != "cita" and vendido and "," not in vendido:
            return vendido

        return responsable_srv  # fallback: estilista de la cita

    # ── Resolver filtro por profesional / vendedor ────────────────
    # Acepta: profesional_id exacto (ES-xxx), nombre parcial o email.
    # Se normaliza para comparación case-insensitive y sin tildes.
    def _normalizar(v: str) -> str:
        import unicodedata
        return unicodedata.normalize("NFD", str(v or "").strip().lower()).encode(
            "ascii", "ignore"
        ).decode()

    filtro_profesional: Optional[str] = None   # None = sin filtro
    if profesional:
        filtro_profesional = _normalizar(profesional)

    def _pasa_filtro(responsable: str, pid: str = "") -> bool:
        """Devuelve True si la fila coincide con el filtro de profesional."""
        if filtro_profesional is None:
            return True
        # Coincidencia por profesional_id exacto
        if filtro_profesional == _normalizar(pid):
            return True
        # Coincidencia parcial por nombre o email resuelto
        return filtro_profesional in _normalizar(responsable)

    # ── Construir filas de detalle ────────────────────────────────
    filas: list[dict] = []

    for v in ventas:
        tipo_origen   = v.get("tipo_origen", v.get("tipo_venta", ""))
        pid_v         = str(v.get("profesional_id", "") or "")
        pnombre_v     = v.get("profesional_nombre", "") or ""
        vendido_raw   = str(v.get("vendido_por",   "") or "").strip()
        facturado_raw = str(v.get("facturado_por", "") or "").strip()
        cliente       = v.get("nombre_cliente", "")  or ""
        comp          = v.get("numero_comprobante", "") or ""
        fecha_v       = v.get("fecha_pago")
        local_venta   = str(v.get("local", "") or "").strip().lower()

        vendido   = resolver_nombre(vendido_raw)
        facturado = resolver_nombre(facturado_raw)
        if vendido.strip().lower() in nombres_sede or vendido.strip().lower() == local_venta:
            vendido = ""

        # Responsable principal del documento (servicio o fallback producto)
        if tipo_origen == "cita":
            responsable_srv = pnombre_v or pid_a_nombre.get(pid_v, pid_v) or ""
            tipo_label      = "Cita"
            origen_id_v     = str(v.get("origen_id", ""))
            fecha_cita_str  = cita_id_a_fecha.get(origen_id_v, "")
            if fecha_cita_str:
                try:
                    fecha_v = datetime.strptime(fecha_cita_str, "%Y-%m-%d")
                except ValueError:
                    pass
        else:
            if vendido and "," not in vendido:
                responsable_srv = vendido
            else:
                responsable_srv = resolver_nombre(facturado_raw)
            tipo_label = "Venta directa"

        # Convertir fecha a ISO string para JSON
        if isinstance(fecha_v, datetime):
            fecha_iso = fecha_v.strftime("%Y-%m-%d")
        elif isinstance(fecha_v, str):
            fecha_iso = fecha_v[:10]  # tomar solo YYYY-MM-DD
        else:
            fecha_iso = None

        for item in v.get("items", []):
            tipo_i = item.get("tipo", "")
            if tipo_i not in tipos_validos:
                continue

            # Para productos, resolver el responsable específico
            if tipo_i == "producto":
                responsable = _responsable_producto(v, item, responsable_srv) or ""
            else:
                responsable = responsable_srv

            # Aplicar filtro por profesional / vendedor
            if not _pasa_filtro(responsable, pid_v):
                continue

            # Las comisiones vienen tal cual de la BD (calculadas en facturación)
            subtotal     = float(item.get("subtotal", 0))
            comision_bd  = float(item.get("comision", 0))
            pct_bd       = float(item.get("porcentaje_comision",
                                  item.get("comision_porcentaje", 0)))

            filas.append({
                "fecha":           fecha_iso,
                "comprobante":     comp,
                "tipo":            tipo_label,           # "Cita" | "Venta directa"
                "responsable":     responsable,          # nombre del estilista / vendedor
                "tipo_item":       "Servicio" if tipo_i == "servicio" else "Producto",
                "nombre_item":     item.get("nombre", ""),
                "cantidad":        int(item.get("cantidad", 1)),
                "precio_unitario": float(item.get("precio_unitario", 0)),
                "subtotal":        subtotal,
                "comision":        comision_bd,          # tal como está en la BD
                "porcentaje_comision": pct_bd,           # tal como está en la BD
                "cliente":         cliente,
            })

    # ── Ordenar por fecha descendente ─────────────────────────────
    filas.sort(key=lambda x: x["fecha"] or "", reverse=True)

    # ── Paginación ────────────────────────────────────────────────
    total  = len(filas)
    pages  = max(1, -(-total // page_size))  # ceil division
    offset = (page - 1) * page_size
    pagina = filas[offset: offset + page_size]

    return {
        "total":               total,
        "page":                page,
        "page_size":           page_size,
        "pages":               pages,
        "sede_id":             sede_id,
        "sede_nombre":         sede_nombre,
        "desde":               desde_str,
        "hasta":               hasta_str,
        "tipo_item":           tipo_item,
        "profesional_filtro":  profesional or None,  # None = sin filtro (todos)
        "items":               pagina,
    }