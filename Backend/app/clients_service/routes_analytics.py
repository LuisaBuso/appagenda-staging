"""
Routes para Analytics de Clientes
📊 Cubre los datos que el frontend reportó como faltantes:
   - Recurrencia promedio (días entre visitas)
   - LTV promedio
   - Nuevos clientes por mes (histórico)
   - Estado base completo (activos / tibios / fríos / churn)
"""
from fastapi import APIRouter, Query, HTTPException, Depends
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from collections import defaultdict
from zoneinfo import ZoneInfo
import logging

from app.database.mongo import collection_clients, collection_sales, collection_locales, collection_auth
from app.auth.routes import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clientes", tags=["Analytics de Clientes"])


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _build_sede_filter(current_user: dict, sede_id: Optional[str]) -> Optional[str]:
    """
    Aplica la misma lógica de restricción de sede que el resto de la app.
    Devuelve el sede_id efectivo o None (todas las sedes).
    """
    rol = current_user.get("rol")
    if rol == "admin_sede":
        user_sede = current_user.get("sede_id")
        sedes_perm = set(current_user.get("sedes_permitidas", []))
        sedes_perm.add(user_sede)
        if sede_id and sede_id not in sedes_perm:
            raise HTTPException(status_code=403, detail="Sin acceso a esa sede.")
        return sede_id or user_sede
    return sede_id  # admin_franquicia / super_admin pueden ver todo


async def _zona_horaria(sede_id: Optional[str]) -> str:
    if not sede_id:
        return "America/Bogota"
    doc = await collection_locales.find_one({"_id": sede_id})
    return (doc or {}).get("zona_horaria", "America/Bogota")


# ─── Endpoint principal ────────────────────────────────────────────────────────

@router.get("/analytics")
async def clientes_analytics(
    sede_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    allowed = {"admin_sede", "admin_franquicia", "super_admin", "recepcionista", "call_center"}
    if current_user.get("rol") not in allowed:
        raise HTTPException(403, "No autorizado.")

    sede_efectiva = _build_sede_filter(current_user, sede_id)
    zona = await _zona_horaria(sede_efectiva)
    tz = ZoneInfo(zona)
    ahora = datetime.now(tz)

    match_base = {}
    if sede_efectiva:
        match_base["sede_id"] = sede_efectiva

    pipeline = [
        *([ {"$match": match_base} ] if match_base else []),
        {"$group": {
            "_id": None,
            "ltv_promedio": {
                "$avg": {"$cond": [
                    {"$and": [{"$gt": ["$ltv_proyectado", 0]}, {"$ifNull": ["$ltv_proyectado", False]}]},
                    "$ltv_proyectado", "$$REMOVE"
                ]}
            },
            "ticket_promedio_negocio": {
                "$avg": {"$cond": [{"$gt": ["$ticket_promedio", 0]}, "$ticket_promedio", "$$REMOVE"]}
            },
            "recurrencia_promedio": {
                "$avg": {"$cond": [
                    {"$and": [{"$gt": ["$frecuencia_dias", 0]}, {"$ifNull": ["$frecuencia_dias", False]}]},
                    "$frecuencia_dias", "$$REMOVE"
                ]}
            },
            "activos":   {"$sum": {"$cond": [{"$eq": ["$segmento", "Activo"]},    1, 0]}},
            "en_riesgo": {"$sum": {"$cond": [{"$eq": ["$segmento", "En riesgo"]}, 1, 0]}},
            "perdidos":  {"$sum": {"$cond": [{"$eq": ["$segmento", "Perdido"]},   1, 0]}},
            "sin_visita": {"$sum": {"$cond": [
                {"$or": [
                    {"$not": {"$ifNull": ["$ultima_visita", False]}},
                    {"$eq": ["$dias_sin_visitar", 0]}
                ]}, 1, 0
            ]}},
            "recurrentes": {"$sum": {"$cond": [
                {"$and": [{"$ifNull": ["$frecuencia_dias", False]}, {"$lte": ["$frecuencia_dias", 120]}]},
                1, 0
            ]}},
            "con_frecuencia": {"$sum": {"$cond": [{"$ifNull": ["$frecuencia_dias", False]}, 1, 0]}},
            "total": {"$sum": 1}
        }}
    ]

    resultado = await collection_clients.aggregate(pipeline).to_list(1)
    r = resultado[0] if resultado else {}
    r.pop("_id", None)

    recurrencia_dias = r.get("recurrencia_promedio")
    ltv_prom    = r.get("ltv_promedio", 0) or 0
    ticket_prom = r.get("ticket_promedio_negocio", 0) or 0
    total       = r.get("total", 0)
    con_frecuencia = r.get("con_frecuencia", 0)

    return {
        "success": True,
        "sede_id": sede_efectiva,
        "zona_horaria": zona,
        "generado_en": ahora.isoformat(),
        "ltv": {
            "ltv_promedio":       round(ltv_prom),
            "ticket_promedio":    round(ticket_prom),
            "clientes_con_datos": con_frecuencia,
            "formula": "ticket_promedio × (365 / frecuencia_dias) × 3 años"
        },
        "recurrencia": {
            "promedio_dias":         round(recurrencia_dias) if recurrencia_dias else None,
            "texto":                 f"Cada {round(recurrencia_dias)} días" if recurrencia_dias else "Sin datos",
            "clientes_recurrentes":  r.get("recurrentes", 0),
            "total_con_frecuencia":  con_frecuencia,
            "pct_recurrentes":       round(r.get("recurrentes", 0) / con_frecuencia * 100) if con_frecuencia else 0,
            "nota":                  "Recurrente = vuelve mínimo cada 120 días"
        },
        "estado_base": {
            "activos":    r.get("activos", 0),
            "en_riesgo":  r.get("en_riesgo", 0),
            "perdidos":   r.get("perdidos", 0),
            "sin_visita": r.get("sin_visita", 0),
            "total":      total,
            # nuevos_por_mes y nuevos eliminados — ver /analytics/nuevos
        },
    }


@router.get("/analytics/nuevos")
async def clientes_nuevos_detalle(
    mes: Optional[str] = Query(None, description="YYYY-MM, ej: 2026-04"),
    fecha_inicio: Optional[str] = Query(None, description="YYYY-MM-DD"),
    fecha_fin: Optional[str] = Query(None, description="YYYY-MM-DD"),
    sede_id: Optional[str] = Query(None),
    descargar: bool = Query(False, description="True para descargar Excel"),
    current_user: dict = Depends(get_current_user)
):
    allowed = {"admin_sede", "admin_franquicia", "super_admin", "recepcionista", "call_center"}
    if current_user.get("rol") not in allowed:
        raise HTTPException(403, "No autorizado.")

    sede_efectiva = _build_sede_filter(current_user, sede_id)
    rol = current_user.get("rol")
    hoy = datetime.now()

    # ── Rango de fechas ───────────────────────────────────────────────
    if mes:
        try:
            año, m = mes.split("-")
            fecha_inicio_dt = datetime(int(año), int(m), 1)
            fecha_fin_dt = (
                datetime(int(año) + 1, 1, 1) if int(m) == 12
                else datetime(int(año), int(m) + 1, 1)
            ) - timedelta(seconds=1)
        except Exception:
            raise HTTPException(400, "Formato inválido. Use YYYY-MM")
    elif fecha_inicio and fecha_fin:
        try:
            fecha_inicio_dt = datetime.strptime(fecha_inicio, "%Y-%m-%d")
            fecha_fin_dt    = datetime.strptime(fecha_fin, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        except Exception:
            raise HTTPException(400, "Formato inválido. Use YYYY-MM-DD")
    else:
        fecha_inicio_dt = hoy.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        fecha_fin_dt    = hoy

    # ── Emails de la sede ─────────────────────────────────────────────
    emails_sede: Optional[list] = None
    if rol != "super_admin" and sede_efectiva:
        sedes_a_buscar = [sede_efectiva] + current_user.get("sedes_permitidas", [])
        usuarios = await collection_auth.find(
            {"sede_id": {"$in": sedes_a_buscar}},
            {"correo_electronico": 1}
        ).to_list(None)
        emails_sede = [u["correo_electronico"] for u in usuarios if u.get("correo_electronico")]

    # ── Query ─────────────────────────────────────────────────────────
    query: dict = {"fecha_creacion": {"$gte": fecha_inicio_dt, "$lte": fecha_fin_dt}}

    if emails_sede:
        query["creado_por"] = {"$in": emails_sede}
    elif rol != "super_admin" and sede_efectiva:
        franquicia_id = current_user.get("franquicia_id")
        if franquicia_id:
            query["franquicia_id"] = franquicia_id

    # ── Obtener TODOS para el total y el Excel ────────────────────────
    projection = {
        "_id": 0, "cliente_id": 1, "nombre": 1,
        "telefono": 1, "fecha_creacion": 1, "creado_por": 1,
    }

    todos = await (
        collection_clients
        .find(query, projection)
        .sort("fecha_creacion", -1)
        .to_list(None)
    )

    total = len(todos)

    # ── Serializar ────────────────────────────────────────────────────
    def serializar(c):
        fecha = c.get("fecha_creacion")
        if isinstance(fecha, datetime):
            fecha = fecha.strftime("%Y-%m-%d")
        return {
            "cliente_id":     c.get("cliente_id", ""),
            "nombre":         c.get("nombre", ""),
            "telefono":       c.get("telefono", ""),
            "fecha_creacion": fecha,
            "creado_por":     c.get("creado_por", ""),
        }

    # ── Descarga Excel ────────────────────────────────────────────────
    if descargar:
        try:
            import openpyxl
            from fastapi.responses import StreamingResponse
            import io

            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Clientes nuevos"
            ws.append(["ID", "Nombre", "Teléfono", "Fecha registro", "Registrado por"])

            for c in todos:
                s = serializar(c)
                ws.append([
                    s["cliente_id"],
                    s["nombre"],
                    s["telefono"],
                    s["fecha_creacion"],
                    s["creado_por"],
                ])

            buffer = io.BytesIO()
            wb.save(buffer)
            buffer.seek(0)

            periodo_str = mes or fecha_inicio_dt.strftime("%Y-%m")
            return StreamingResponse(
                buffer,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f'attachment; filename="nuevos_{periodo_str}.xlsx"'}
            )
        except ImportError:
            raise HTTPException(500, "openpyxl no está instalado. Ejecuta: pip install openpyxl")

    # ── Respuesta JSON — máximo 20 en la lista ────────────────────────
    LIMITE_LISTA = 20
    clientes_lista = [serializar(c) for c in todos[:LIMITE_LISTA]]

    return {
        "success": True,
        "sede_id": sede_efectiva,
        "periodo": {
            "inicio": fecha_inicio_dt.strftime("%Y-%m-%d"),
            "fin":    fecha_fin_dt.strftime("%Y-%m-%d"),
        },
        "total": total,
        "mostrando": len(clientes_lista),
        "hay_mas": total > LIMITE_LISTA,
        "descarga_url": f"/clientes/analytics/nuevos?mes={mes or fecha_inicio_dt.strftime('%Y-%m')}&descargar=true" if total > LIMITE_LISTA else None,
        "clientes": clientes_lista,
    }