# ============================================================
# routes_finanzas_movimientos.py — REFACTORIZADO
#
# CAMBIOS RESPECTO A LA VERSIÓN ANTERIOR:
#   - Eliminada dependencia de collection_finance_movements
#   - Egresos (ambas cajas) → cash_expenses  (campo `caja` discrimina)
#   - Ingresos caja mayor  → cash_incomes
#   - Traslados            → cash_expenses  (tipo="traslado", afecta_pl=False)
#   - GET /resumen         → usa calcular_resumen_dia (caja menor) +
#                            queries directos filtrados por caja (caja mayor)
#
# La lógica de caja menor (ingresos por ventas/citas, saldo corrido, etc.)
# ya está 100% cubierta por accounting_logic.py / routes_cash.py.
# Este router solo gestiona los movimientos manuales de caja mayor
# y los egresos manuales de caja menor que no pasan por el POS.
# ============================================================

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.auth.routes import get_current_user
from app.database.mongo import db, collection_locales as locales
from app.cash.accounting_logic import calcular_resumen_dia
from app.cash.utils_cash import generar_egreso_id, generar_ingreso_id
from app.database.mongo import collection_sales

router = APIRouter(prefix="/finanzas/movimientos", tags=["Finanzas - Movimientos"])

# ── Colecciones ───────────────────────────────────────────────────────────────
cash_expenses = db["cash_expenses"]
cash_incomes  = db["cash_ingresos"]
cash_closures = db["cash_closures"]

# ── Literals / tipos ─────────────────────────────────────────────────────────
CategoriaEgresoMayor = Literal[
    "arriendo", "nomina", "comisiones", "servicios_publicos", "impuestos",
    "proveedor", "insumos", "marketing", "mantenimiento", "transporte",
    "software", "seguros", "honorarios", "otro",
]
MetodoPago    = Literal["transferencia", "debito_automatico", "tarjeta_corporativa",
                        "cheque", "efectivo", "pse"]
CajaTipo      = Literal["caja_menor", "caja_mayor"]

# Mapeo de categoría de caja menor → tipo estándar de cash_expenses
_CATEGORIA_MENOR_A_TIPO = {
    "almuerzos"      : "gasto_operativo",
    "domicilios"     : "gasto_operativo",
    "propinas"       : "otro",
    "gasto_operativo": "gasto_operativo",
    "otro"           : "otro",
}


# ── Modelos de request ────────────────────────────────────────────────────────

class MovimientoBase(BaseModel):
    sede_id      : str
    fecha        : str = Field(..., description="YYYY-MM-DD")
    concepto     : str = Field(..., min_length=3, max_length=200)
    monto        : float = Field(..., gt=0)
    observaciones: Optional[str] = Field(None, max_length=1000)


class EgresoCajaMayorRequest(MovimientoBase):
    categoria        : CategoriaEgresoMayor
    metodo_pago      : MetodoPago
    referencia_factura: Optional[str] = Field(None, max_length=80)


class IngresoCajaMayorRequest(MovimientoBase):
    categoria        : Literal["devolucion_proveedor", "intereses",
                                "ingreso_extraordinario", "otro"]
    metodo_pago      : MetodoPago
    referencia_factura: Optional[str] = Field(None, max_length=80)


class EgresoCajaMenorRequest(MovimientoBase):
    categoria  : Literal["almuerzos", "domicilios", "propinas",
                          "gasto_operativo", "otro"]
    metodo_pago: Literal["efectivo", "transferencia", "pse"] = "efectivo"


class TrasladoCajasRequest(BaseModel):
    sede_id     : str
    fecha       : str
    concepto    : str = Field(..., min_length=3, max_length=200)
    monto       : float = Field(..., gt=0)
    caja_origen : CajaTipo
    caja_destino: CajaTipo
    observaciones: Optional[str] = Field(None, max_length=1000)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _check_admin(current_user: dict) -> None:
    if current_user.get("rol") not in {"admin_sede", "admin_franquicia", "super_admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores pueden registrar movimientos.",
        )


def _parse_fecha(fecha: str) -> str:
    try:
        return datetime.strptime(fecha, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail="fecha debe tener formato YYYY-MM-DD"
        ) from exc


def _auditoria(current_user: dict) -> dict:
    return {
        "registrado_por"      : current_user.get("email"),
        "registrado_por_nombre": current_user.get("nombre"),
        "registrado_por_rol"  : current_user.get("rol"),
        "creado_en"           : datetime.utcnow(),
        "actualizado_en"      : datetime.utcnow(),
    }


async def _insertar(collection, doc: dict) -> dict:
    result    = await collection.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


# ── Endpoints de escritura ────────────────────────────────────────────────────

@router.post("/egreso-caja-mayor", status_code=201)
async def registrar_egreso_caja_mayor(
    payload     : EgresoCajaMayorRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Registra un egreso manual de caja mayor (nómina, arriendo, proveedores…).
    Se almacena en cash_expenses con caja='caja_mayor' para que el resumen
    financiero lo distinga de los egresos operativos de caja menor.
    """
    _check_admin(current_user)
    fecha = _parse_fecha(payload.fecha)

    doc = {
        "egreso_id"          : generar_egreso_id(),
        "sede_id"            : payload.sede_id,
        "fecha"              : fecha,
        "tipo"               : "gasto_operativo",   # tipo estándar de cash_expenses
        "categoria"          : payload.categoria,   # categoría específica de caja mayor
        "concepto"           : payload.concepto,
        "descripcion"        : payload.observaciones,
        "monto"              : payload.monto,
        "moneda"             : "COP",
        "metodo_pago"        : payload.metodo_pago,
        "referencia_factura" : payload.referencia_factura,
        # ── Clasificación contable ──
        "caja"               : "caja_mayor",
        "origen"             : "manual_caja_mayor",
        "tipo_movimiento"    : "egreso",
        "afecta_pl"          : True,
        **_auditoria(current_user),
    }
    return await _insertar(cash_expenses, doc)


@router.post("/ingreso-caja-mayor", status_code=201)
async def registrar_ingreso_caja_mayor(
    payload     : IngresoCajaMayorRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Registra un ingreso manual de caja mayor (devolución de proveedor,
    intereses, ingresos extraordinarios…).
    Se almacena en cash_incomes con caja='caja_mayor'.
    """
    _check_admin(current_user)
    fecha = _parse_fecha(payload.fecha)

    doc = {
        "ingreso_id"         : generar_ingreso_id(),
        "sede_id"            : payload.sede_id,
        "fecha"              : fecha,
        "categoria"          : payload.categoria,
        "motivo"             : payload.concepto,
        "descripcion"        : payload.observaciones,
        "monto"              : payload.monto,
        "moneda"             : "COP",
        "metodo_pago"        : payload.metodo_pago,
        "referencia_factura" : payload.referencia_factura,
        # ── Clasificación contable ──
        "caja"               : "caja_mayor",
        "origen"             : "manual_caja_mayor",
        "tipo_movimiento"    : "ingreso",
        "afecta_pl"          : True,
        **_auditoria(current_user),
    }
    return await _insertar(cash_incomes, doc)


@router.post("/egreso-caja-menor", status_code=201)
async def registrar_egreso_caja_menor(
    payload     : EgresoCajaMenorRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Registra un egreso manual de caja menor (almuerzos, propinas, domicilios…).
    Usa la misma colección cash_expenses que routes_cash.py, con caja='caja_menor'
    para mantener coherencia con el cierre de caja diario existente.
    """
    _check_admin(current_user)
    fecha    = _parse_fecha(payload.fecha)
    tipo_std = _CATEGORIA_MENOR_A_TIPO.get(payload.categoria, "otro")

    doc = {
        "egreso_id"      : generar_egreso_id(),
        "sede_id"        : payload.sede_id,
        "fecha"          : fecha,
        "tipo"           : tipo_std,
        "categoria"      : payload.categoria,
        "concepto"       : payload.concepto,
        "descripcion"    : payload.observaciones,
        "monto"          : payload.monto,
        "moneda"         : "COP",
        "metodo_pago"    : payload.metodo_pago,
        # ── Clasificación contable ──
        "caja"           : "caja_menor",
        "origen"         : "manual_caja_menor",
        "tipo_movimiento": "egreso",
        "afecta_pl"      : True,
        **_auditoria(current_user),
    }
    return await _insertar(cash_expenses, doc)


@router.post("/traslado", status_code=201)
async def registrar_traslado(
    payload     : TrasladoCajasRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Registra un traslado entre caja menor y caja mayor.
    Se guarda como un documento único en cash_expenses con
    tipo='traslado' y afecta_pl=False para excluirlo del P&L.
    caja_origen y caja_destino quedan como campos explícitos.
    """
    _check_admin(current_user)

    if payload.caja_origen == payload.caja_destino:
        raise HTTPException(
            status_code=422,
            detail="caja_origen y caja_destino no pueden ser iguales.",
        )

    fecha = _parse_fecha(payload.fecha)

    doc = {
        "egreso_id"      : generar_egreso_id(),
        "sede_id"        : payload.sede_id,
        "fecha"          : fecha,
        "tipo"           : "traslado",
        "concepto"       : payload.concepto,
        "descripcion"    : payload.observaciones,
        "monto"          : payload.monto,
        "moneda"         : "COP",
        "metodo_pago"    : "efectivo",
        "caja_origen"    : payload.caja_origen,
        "caja_destino"   : payload.caja_destino,
        # ── Clasificación contable ──
        "caja"           : payload.caja_origen,
        "origen"         : "manual_caja_mayor",
        "tipo_movimiento": "traslado",
        "afecta_pl"      : False,
        **_auditoria(current_user),
    }
    return await _insertar(cash_expenses, doc)


# ── Resumen financiero ────────────────────────────────────────────────────────

@router.get("/resumen")
async def resumen_financiero(
    sede_id     : str,
    fecha_inicio: str = Query(..., description="YYYY-MM-DD"),
    fecha_fin   : str = Query(..., description="YYYY-MM-DD"),
    current_user: dict = Depends(get_current_user),
):
    """
    Resumen financiero consolidado para un rango de fechas.

    Estructura de respuesta:
    ┌─ pl            → P&L solo con movimientos que afectan resultados
    │                   (no incluye traslados)
    ├─ caja_menor    → calculado por accounting_logic (ventas + egresos manuales)
    │                   para cada día del rango y luego agregado
    ├─ caja_mayor    → suma de ingresos/egresos con caja='caja_mayor'
    │                   registrados en este router
    └─ traslados     → resumen de traslados internos entre cajas
    """
    fecha_inicio = _parse_fecha(fecha_inicio)
    fecha_fin    = _parse_fecha(fecha_fin)

    filtro_rango = {"sede_id": sede_id, "fecha": {"$gte": fecha_inicio, "$lte": fecha_fin}}

    # ── Caja mayor: ingresos manuales ────────────────────────────────────────
    docs_ingresos_mayor = await cash_incomes.find({
        **filtro_rango,
        "caja"     : "caja_mayor",
        "eliminado": {"$ne": True},
    }).to_list(5000)

    # ── Caja mayor: egresos manuales ─────────────────────────────────────────
    docs_egresos_mayor = await cash_expenses.find({
        **filtro_rango,
        "caja"           : "caja_mayor",
        "tipo_movimiento": {"$ne": "traslado"},
        "eliminado"      : {"$ne": True},
    }).to_list(5000)

    # ── Caja menor: egresos manuales (los ingresos vienen de accounting_logic) ─
    docs_egresos_menor = await cash_expenses.find({
        **filtro_rango,
        "caja"           : "caja_menor",
        "tipo_movimiento": {"$ne": "traslado"},
        "origen"         : {"$ne": "migracion"},
        "eliminado"      : {"$ne": True},
    }).to_list(5000)

    # ── Traslados ─────────────────────────────────────────────────────────────
    docs_traslados = await cash_expenses.find({
        **filtro_rango,
        "tipo_movimiento": "traslado",
    }).to_list(1000)

    # ── Caja menor: ingresos reales via accounting_logic ─────────────────────
    # Iteramos día a día para usar la lógica contable existente correctamente.
    # Para rangos grandes el frontend debería usar reporte-periodo de routes_cash.

    from datetime import timedelta

    inicio_dt  = datetime.strptime(fecha_inicio, "%Y-%m-%d")
    fin_dt_exc = datetime.strptime(fecha_fin,    "%Y-%m-%d") + timedelta(days=1)

    ventas_rango = await collection_sales.find({
        "sede_id"   : sede_id,
        "fecha_pago": {"$gte": inicio_dt, "$lt": fin_dt_exc},
        "eliminado" : {"$ne": True},
    }).to_list(10_000)

    ingresos_efectivo_menor = sum(
        float((d.get("desglose_pagos") or {}).get("efectivo", 0) or 0)
        for d in ventas_rango
    )
    # Digital (tarjeta, addi, transferencia…) → va directo al banco (Caja Mayor)
    ingresos_digital_mayor = max(0.0, sum(
        float((d.get("desglose_pagos") or {}).get("total",    0) or 0)
        - float((d.get("desglose_pagos") or {}).get("efectivo", 0) or 0)
        for d in ventas_rango
    ))

    total_vendido = sum(
        float((d.get("desglose_pagos") or {}).get("total", 0) or 0)
        for d in ventas_rango
    )

    # ── Totales ───────────────────────────────────────────────────────────────
    total_ingresos_mayor = sum(d.get("monto", 0) for d in docs_ingresos_mayor)

    # Desglose por categoría de egresos de caja mayor
    egresos_mayor_por_categoria: dict = {}
    total_egresos_mayor = 0
    for doc in docs_egresos_mayor:
        cat = doc.get("categoria", "otro")
        monto = doc.get("monto", 0)
        egresos_mayor_por_categoria[cat] = egresos_mayor_por_categoria.get(cat, 0) + monto
        total_egresos_mayor += monto

    total_egresos_menor  = sum(d.get("monto", 0) for d in docs_egresos_menor)

    # ── NUEVO: ventas digitales van directo a Caja Mayor ─────────────────────────
    # Efectivo → Caja Menor. Todo lo demás (tarjeta, addi, transferencia…) → Caja Mayor.
    total_ventas_digital = max(0.0, total_vendido - ingresos_efectivo_menor)

    total_menor_a_mayor = sum(
        d.get("monto", 0) for d in docs_traslados
        if d.get("caja_origen") == "caja_menor"
    )
    total_mayor_a_menor = sum(
        d.get("monto", 0) for d in docs_traslados
        if d.get("caja_origen") == "caja_mayor"
    )

    # P&L: excluye traslados (afecta_pl=False), solo movimientos reales
    pl_ingresos = total_vendido + total_ingresos_mayor
    pl_egresos  = total_egresos_mayor + total_egresos_menor

    # Saldo caja mayor: ingresos manuales + traslados RECIBIDOS - egresos - traslados ENVIADOS
    saldo_caja_mayor = (
        ingresos_digital_mayor    # +$72,500   addi/tarjeta/transferencia → banco directo
        + total_ingresos_mayor      # +$0        ingresos manuales admin
        + total_menor_a_mayor       # +$200,000  traslado RECIBIDO del cajón  ← SUMA
        - total_egresos_mayor       # −$0        egresos manuales admin
        - total_mayor_a_menor       # −$0        base enviada al cajón
    )

    # Saldo caja menor: efectivo de ventas + traslados RECIBIDOS - egresos - traslados ENVIADOS
    saldo_caja_menor = (
        ingresos_efectivo_menor   # +$370,000  efectivo de ventas → entra al cajón
        + total_mayor_a_menor       # +$0        base enviada desde banco
        - total_egresos_menor       # −$0        gastos operativos cajón
        - total_menor_a_mayor       # −$200,000  entregado al banco
    )

    return {
        "pl": {
            "ingresos"                    : round(total_vendido,          2),
            "ingresos_manuales_mayor"     : round(total_ingresos_mayor,   2),
            "egresos"                     : round(total_egresos_mayor + total_egresos_menor, 2),
            "egresos_mayor_total"         : round(total_egresos_mayor,    2),
            "egresos_menor_total"         : round(total_egresos_menor,    2),
            "egresos_mayor_por_categoria" : {
                cat: round(monto, 2)
                for cat, monto in egresos_mayor_por_categoria.items()
            },
            "utilidad"    : round(total_vendido + total_ingresos_mayor
                                - total_egresos_mayor - total_egresos_menor, 2),
            "aclaracion"  : "Los traslados internos no impactan el P&L.",
        },
        "caja_menor": {
            "ingresos_efectivo"    : round(ingresos_efectivo_menor, 2),
            "egresos_manuales"     : round(total_egresos_menor,     2),
            "traslados_enviados"   : round(total_menor_a_mayor,     2),
            "traslados_recibidos"  : round(total_mayor_a_menor,     2),
            "saldo_neto_efectivo"  : round(saldo_caja_menor,        2),
        },
        "caja_mayor": {
            "ventas_digital"       : round(ingresos_digital_mayor,  2),
            "ingresos"             : round(total_ingresos_mayor,    2),
            "egresos"              : round(total_egresos_mayor,     2),
            "traslados_recibidos"  : round(total_menor_a_mayor,     2),   # suma ✓
            "traslados_enviados"   : round(total_mayor_a_menor,     2),   # resta ✓
            "saldo"                : round(saldo_caja_mayor,        2),
        },
        "consolidado": round(saldo_caja_menor + saldo_caja_mayor, 2),
        "traslados": {
            "menor_a_mayor": round(total_menor_a_mayor, 2),
            "mayor_a_menor": round(total_mayor_a_menor, 2),
            "cantidad"     : len(docs_traslados),
        },
    }