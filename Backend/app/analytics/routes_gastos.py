"""
Routes para Gastos y P&L (Estado de Resultados)
💸 Registra gastos de la sede y calcula utilidad neta
📊 Ingresos base: collection_sales (desglose_pagos.total) — igual que el dashboard
"""
from fastapi import APIRouter, Query, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import logging
from bson import ObjectId

from app.database.mongo import collection_sales, collection_locales
from app.auth.routes import get_current_user

logger = logging.getLogger(__name__)

# ── Colección nueva ────────────────────────────────────────────────────────────
# Agrega en app/database/mongo.py:
#   collection_gastos = db["gastos"]
try:
    from app.database.mongo import collection_bills
except ImportError:
    collection_bills = None  # failsafe mientras se configura

router = APIRouter(prefix="/gastos", tags=["Gastos y P&L"])


# ─── Modelos ──────────────────────────────────────────────────────────────────

TipoGasto = Literal["fijo", "directo", "operativo"]

CATEGORIAS_POR_TIPO = {
    "fijo":      ["arriendo", "nomina", "servicios_publicos", "seguro", "otro_fijo"],
    "directo":   ["comisiones", "insumos", "productos_revendidos", "otro_directo"],
    "operativo": ["marketing", "mantenimiento", "transporte", "software", "otro_operativo"],
}


class GastoCreate(BaseModel):
    concepto:  str              = Field(..., min_length=2, max_length=120)
    tipo:      TipoGasto
    categoria: Optional[str]   = None
    monto:     float            = Field(..., gt=0)
    moneda:    str              = Field("COP", pattern="^(COP|USD|MXN)$")
    sede_id:   str
    periodo:   str              = Field(
        ..., pattern=r"^\d{4}-\d{2}$", description="Mes YYYY-MM al que aplica el gasto"
    )
    nota:      Optional[str]   = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _require_gastos():
    if collection_bills is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "La colección 'bills' no está configurada. "
                "Agrega `collection_bills = db['bills']` en app/database/mongo.py."
            ),
        )


def _check_rol(current_user: dict):
    allowed = {"admin_sede", "admin_franquicia", "super_admin"}
    if current_user.get("rol") not in allowed:
        raise HTTPException(status_code=403, detail="Se requiere rol de administrador.")


def _check_sede_access(current_user: dict, sede_id: Optional[str]) -> Optional[str]:
    """Valida acceso y devuelve el sede_id efectivo."""
    if current_user.get("rol") != "admin_sede":
        return sede_id
    sedes_perm = set(current_user.get("sedes_permitidas", []))
    sedes_perm.add(current_user.get("sede_id"))
    if sede_id and sede_id not in sedes_perm:
        raise HTTPException(status_code=403, detail="Sin acceso a esa sede.")
    return sede_id or current_user.get("sede_id")


async def _zona_horaria(sede_id: Optional[str]) -> str:
    if not sede_id:
        return "America/Bogota"
    doc = await collection_locales.find_one({"_id": sede_id})
    return (doc or {}).get("zona_horaria", "America/Bogota")


def _get_date_range(periodo: str, zona: str):
    """'YYYY-MM' → (inicio_mes, fin_mes) con la TZ de la sede."""
    tz = ZoneInfo(zona)
    year, month = int(periodo[:4]), int(periodo[5:7])
    inicio = datetime(year, month, 1, 0, 0, 0, tzinfo=tz)
    fin = (
        datetime(year + 1, 1, 1, tzinfo=tz)
        if month == 12
        else datetime(year, month + 1, 1, tzinfo=tz)
    ) - timedelta(seconds=1)
    return inicio, fin


def _to_response(doc: dict) -> dict:
    return {
        "id":        str(doc["_id"]),
        "concepto":  doc["concepto"],
        "tipo":      doc["tipo"],
        "categoria": doc.get("categoria"),
        "monto":     doc["monto"],
        "moneda":    doc["moneda"],
        "sede_id":   doc["sede_id"],
        "periodo":   doc["periodo"],
        "nota":      doc.get("nota"),
        "creado_por":doc.get("creado_por", ""),
        "creado_en": doc.get("creado_en", ""),
    }


# ─── CRUD Gastos ──────────────────────────────────────────────────────────────

@router.get("/categorias")
async def get_categorias():
    """Catálogo de categorías por tipo. No requiere autenticación."""
    return {"categorias": CATEGORIAS_POR_TIPO}


@router.post("/", status_code=201)
async def crear_gasto(
    gasto: GastoCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Registra un gasto de la sede.

    | Tipo | Ejemplos |
    |------|---------|
    | **fijo** | Arriendo, nómina, servicios públicos |
    | **directo** | Comisiones, insumos, productos revendidos |
    | **operativo** | Marketing, mantenimiento, software |
    """
    _check_rol(current_user)
    _require_gastos()
    _check_sede_access(current_user, gasto.sede_id)

    zona = await _zona_horaria(gasto.sede_id)
    ahora = datetime.now(ZoneInfo(zona))

    doc = {
        **gasto.model_dump(),
        "creado_por": current_user.get("username", ""),
        "creado_en":  ahora.isoformat(),
    }
    result = await collection_bills.insert_one(doc)
    doc["_id"] = result.inserted_id

    logger.info(
        f"💸 gasto creado: {gasto.concepto} ({gasto.tipo}) "
        f"— {gasto.monto} {gasto.moneda} | periodo={gasto.periodo}"
    )
    return _to_response(doc)


@router.get("/")
async def listar_gastos(
    sede_id: Optional[str]    = Query(None),
    periodo: Optional[str]    = Query(None, pattern=r"^\d{4}-\d{2}$"),
    tipo:    Optional[TipoGasto] = Query(None),
    current_user: dict        = Depends(get_current_user),
):
    """Lista gastos con filtros opcionales por sede, periodo y tipo."""
    _check_rol(current_user)
    _require_gastos()
    sede_id = _check_sede_access(current_user, sede_id)

    query: dict = {}
    if sede_id:
        query["sede_id"] = sede_id
    if periodo:
        query["periodo"] = periodo
    if tipo:
        query["tipo"] = tipo

    docs = await collection_bills.find(query).sort("periodo", -1).to_list(500)
    return {"gastos": [_to_response(d) for d in docs], "total": len(docs)}


@router.delete("/{gasto_id}", status_code=200)
async def eliminar_gasto(
    gasto_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Elimina un gasto por su ID."""
    _check_rol(current_user)
    _require_gastos()
    try:
        oid = ObjectId(gasto_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID de gasto inválido.")

    result = await collection_bills.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Gasto no encontrado.")
    return {"success": True, "deleted_id": gasto_id}


# ─── P&L ──────────────────────────────────────────────────────────────────────

@router.get("/pl")
async def pl_dashboard(
    periodo:  str           = Query(
        ..., pattern=r"^\d{4}-\d{2}$", description="Mes a analizar YYYY-MM, ej: 2025-03"
    ),
    sede_id:  Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """
    Estado de Resultados (P&L) mensual.

    **Ingresos** = `collection_sales.desglose_pagos.total`
    → misma fuente que `/ventas/dashboard`, los totales siempre coinciden.

    **Egresos** = gastos registrados en este módulo para el período.

    **Utilidad neta** = Ingresos − (Costos directos + Gastos fijos + Gastos operativos)

    🔒 Requiere rol de administrador.
    """
    _check_rol(current_user)
    sede_id = _check_sede_access(current_user, sede_id)

    zona = await _zona_horaria(sede_id)
    inicio, fin = _get_date_range(periodo, zona)

    # ── Ingresos: collection_sales ────────────────────────────────────────────
    sales_q: dict = {"fecha_pago": {"$gte": inicio, "$lte": fin}}
    if sede_id:
        sales_q["sede_id"] = sede_id

    ventas = await collection_sales.find(sales_q).to_list(None)

    ingresos: dict = {}  # { moneda: float }
    for v in ventas:
        moneda = v.get("moneda", "COP")
        total  = v.get("desglose_pagos", {}).get("total", 0)
        ingresos[moneda] = round(ingresos.get(moneda, 0) + total, 2)

    # ── Egresos: collection_bills ────────────────────────────────────────────
    gastos_docs: List[dict] = []
    if collection_bills is not None:
        gastos_q: dict = {"periodo": periodo}
        if sede_id:
            gastos_q["sede_id"] = sede_id
        gastos_docs = await collection_bills.find(gastos_q).to_list(None)

    egresos: dict = {}  # { moneda: { tipo: float } }
    for g in gastos_docs:
        moneda = g.get("moneda", "COP")
        tipo   = g.get("tipo", "operativo")
        monto  = g.get("monto", 0)
        if moneda not in egresos:
            egresos[moneda] = {"fijo": 0.0, "directo": 0.0, "operativo": 0.0}
        egresos[moneda][tipo] += monto

    for moneda in egresos:
        for t in egresos[moneda]:
            egresos[moneda][t] = round(egresos[moneda][t], 2)

    # ── P&L por moneda ────────────────────────────────────────────────────────
    todas = set(ingresos) | set(egresos)
    pl: dict = {}

    for moneda in todas:
        ing = ingresos.get(moneda, 0)
        eg  = egresos.get(moneda, {"fijo": 0, "directo": 0, "operativo": 0})
        total_eg = round(eg["fijo"] + eg["directo"] + eg["operativo"], 2)
        utilidad = round(ing - total_eg, 2)
        margen   = round(utilidad / ing * 100, 1) if ing > 0 else 0.0

        pl[moneda] = {
            "ingresos":     ing,
            "egresos": {
                "costos_directos":   eg["directo"],
                "gastos_fijos":      eg["fijo"],
                "gastos_operativos": eg["operativo"],
                "total":             total_eg,
            },
            "utilidad_neta":    utilidad,
            "margen_neto_pct":  margen,
            "cantidad_ventas":  sum(1 for v in ventas if v.get("moneda", "COP") == moneda),
        }

    resp: dict = {
        "success":            True,
        "periodo":            periodo,
        "sede_id":            sede_id,
        "zona_horaria":       zona,
        "rango": {
            "inicio": inicio.isoformat(),
            "fin":    fin.isoformat(),
        },
        "pl_por_moneda":      pl,
        "ventas_registradas": len(ventas),
        "gastos_registrados": len(gastos_docs),
        "nota": (
            "Ingresos = collection_sales.desglose_pagos.total. "
            "Misma fuente que /ventas/dashboard — totales siempre coherentes."
        ),
    }

    if collection_bills is None:
        resp["advertencia"] = (
            "⚠️ Colección 'gastos' no configurada. Egresos son 0. "
            "Agrega `collection_gastos = db['gastos']` en app/database/mongo.py."
        )

    return resp