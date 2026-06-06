# ============================================================
# accounting_logic.py
# SOLUCIÓN HÍBRIDA con prioridad a datos migrados
#
# REGLA PRINCIPAL:
#   1. Verificar si existe data en cash_expenses para (sede_id, fecha)
#   2. Si SÍ → usar cash_expenses + cash_closures (datos migrados)
#   3. Si NO → flujo normal: appointments + sales
#
# Esto permite coexistir datos migrados del sistema anterior
# con los datos nuevos sin tocar la lógica existente.
# ============================================================

from datetime import datetime
from typing import Any, Dict, List, Optional
from app.database.mongo import (
    collection_citas as appointments,
    collection_sales as sales,
    collection_locales as locales,
    db
)

cash_expenses = db["cash_expenses"]
cash_closures = db["cash_closures"]
cash_incomes = db["cash_ingresos"]

# ============================================================
# MAPEO DE MÉTODOS DE PAGO
# Incluye variantes del sistema migrado (sin tildes, espacios)
# ============================================================

MAPEO_METODOS_PAGO = {
    # Sistema nuevo
    "efectivo"                              : "efectivo",
    "tarjeta_de_credito"                    : "tarjeta_credito",
    "tarjeta_credito"                       : "tarjeta_credito",
    "tarjeta_de_debito"                     : "tarjeta_debito",
    "tarjeta_debito"                        : "tarjeta_debito",
    "pos"                                   : "pos",
    "transferencia"                         : "transferencia",
    "transferencia_bancaria"                : "transferencia",
    "abonos"                                : "abonos",
    "link_de_pago"                          : "link_de_pago",
    "link_pago"                             : "link_de_pago",
    "addi"                                  : "addi",
    "giftcard"                              : "giftcard",
    "cheque"                                : "otros",
    "online"                                : "otros",
    "caja_fuerte"                           : "otros",
    "otro"                                  : "otros",
    "descuento_por_nomina"                  : "descuento_por_nomina",
    "descuento_nomina"                      : "descuento_por_nomina",
    "abono_transferencia"                   : "abono_transferencia",

    # Variantes del sistema migrado (texto del CSV ya sin tildes)
    "tarjeta de credito"                    : "tarjeta_credito",
    "tarjeta de debito"                     : "tarjeta_debito",
    "abonos a reservas por transferencias"  : "abonos",
    "abonos a reservas por transferencia"   : "abonos",
}

def _normalizar_metodo(metodo_raw: str) -> str:
    """Normaliza un método de pago a la clave estándar."""
    if not metodo_raw:
        return "otros"
    key = metodo_raw.lower().strip()
    return MAPEO_METODOS_PAGO.get(key, "otros")


def _metodos_pago_base() -> Dict[str, float]:
    return {
        "efectivo": 0,
        "tarjeta_credito": 0,
        "tarjeta_debito": 0,
        "pos": 0,
        "abono_transferencia": 0,   # ← nuevo
        "transferencia": 0,
        "link_de_pago": 0,
        "giftcard": 0,
        "addi": 0,
        "abonos": 0,
        "otros": 0,
        "descuento_por_nomina": 0,
    }


def _parse_fecha_any(valor: Any, fecha_fallback: Optional[str] = None) -> Optional[datetime]:
    if isinstance(valor, datetime):
        return valor
    if not valor and fecha_fallback:
        valor = fecha_fallback
    if not valor:
        return None

    valor_str = str(valor).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(valor_str, fmt)
        except ValueError:
            continue
    return None


def _fecha_para_manual(doc: dict, fecha_fallback: Optional[str] = None) -> Optional[datetime]:
    return (
        _parse_fecha_any(doc.get("creado_en"))
        or _parse_fecha_any(doc.get("fecha"), fecha_fallback)
        or _parse_fecha_any(fecha_fallback)
    )



def _extraer_fecha_migrado(doc: dict, fecha_fallback: str = None) -> "datetime | None":
    """
    Extrae la fecha CON HORA de un documento migrado de cash_expenses.

    Estrategia de prioridad:
    1. _raw.fecha          → "2025-12-12 09:37:00"  (tiene la hora real)
    2. fecha del documento → "2025-12-12"            (solo fecha, sin hora)
    3. fecha_fallback      → parámetro de la función padre

    Devuelve un objeto datetime o None si ninguna fuente es parseable.
    """
    FORMATOS = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ]

    # Fuentes en orden de prioridad
    candidatos = [
        doc.get("_raw", {}).get("fecha") if isinstance(doc.get("_raw"), dict) else None,
        doc.get("fecha"),
        fecha_fallback,
    ]

    for valor in candidatos:
        if not valor:
            continue
        valor_str = str(valor).strip()
        for fmt in FORMATOS:
            try:
                return datetime.strptime(valor_str, fmt)
            except ValueError:
                continue

    return None

# ============================================================
# HELPERS DE QUERY ROBUSTA
# ============================================================

def _fecha_query(fecha: str) -> dict:
    """
    Tolera ambos formatos: YYYY-MM-DD y DD-MM-YYYY.
    fecha siempre entra como YYYY-MM-DD.
    """
    try:
        dt = datetime.strptime(fecha, "%Y-%m-%d")
        fecha_invertida = dt.strftime("%d-%m-%Y")  # "11-03-2026"
    except ValueError:
        fecha_invertida = fecha

    return {"$in": [fecha, fecha_invertida]}

async def _buscar_apertura(sede_id: str, fecha: str):
    """
    Busca la apertura de caja con múltiples estrategias:
    1. Por apertura_id  (determinístico, más fiable)
    2. Por sede_id + fecha exacta + tipo
    3. Por sede_id + fecha como regex + tipo
    """
    # Estrategia 1: apertura_id es predecible → AP-YYYY-MM-DD-SEDE_ID
    apertura = await cash_closures.find_one({
        "apertura_id": f"AP-{fecha}-{sede_id}"
    })
    if apertura:
        return apertura

    # Estrategia 2: campos exactos
    apertura = await cash_closures.find_one({
        "sede_id": sede_id,
        "fecha"  : fecha,
        "tipo"   : "apertura"
    })
    if apertura:
        return apertura

    # Estrategia 3: regex sobre fecha (cubre "2025-12-12 00:00:00")
    apertura = await cash_closures.find_one({
        "sede_id": sede_id,
        "fecha"  : _fecha_query(fecha),
        "tipo"   : "apertura"
    })
    return apertura


# ============================================================
# VERIFICADOR: ¿Existe data migrada para esta fecha/sede?
# ============================================================

async def _tiene_data_migrada(sede_id: str, fecha: str) -> bool:
    """
    Devuelve True si cash_expenses tiene al menos 1 documento
    para la sede y fecha dadas (proveniente de migración).
    Usa regex en fecha para cubrir ambos formatos de string.
    Se usa como interruptor de toda la lógica.
    """
    doc = await cash_expenses.find_one({
        "sede_id": sede_id,
        "fecha"  : _fecha_query(fecha),
        "origen" : "migracion"
    })
    return doc is not None


async def _ingresos_manuales_docs(sede_id: str, fecha: str) -> List[Dict]:
    return await cash_incomes.find({
        "sede_id": sede_id,
        "fecha": _fecha_query(fecha),
        "eliminado": {"$ne": True}  
    }).sort("creado_en", 1).to_list(None)


async def _ingresos_manuales_por_metodo(sede_id: str, fecha: str) -> Dict[str, float]:
    metodos = _metodos_pago_base()
    docs = await _ingresos_manuales_docs(sede_id, fecha)

    for ingreso in docs:
        metodo_norm = _normalizar_metodo(ingreso.get("metodo_pago", ""))
        monto = float(ingreso.get("monto", 0) or 0)
        if metodo_norm not in metodos:
            metodos[metodo_norm] = 0
        metodos[metodo_norm] += monto

    metodos["total_general"] = sum(
        monto for key, monto in metodos.items() if key != "total_general"
    )
    return metodos


def _formatear_ingresos_manuales_para_flujo(
    docs: List[Dict],
    fecha_fallback: Optional[str] = None
) -> List[Dict]:
    ingresos_formateados: List[Dict] = []

    for ingreso in docs:
        fecha_dt = _fecha_para_manual(ingreso, fecha_fallback)
        ingresos_formateados.append({
            "fecha": fecha_dt,
            "nombre_cliente": "N/A",
            "cedula_cliente": "",
            "email_cliente": "",
            "telefono_cliente": "",
            "medio_pago": ingreso.get("metodo_pago", "efectivo").replace("_", " ").title(),
            "tipo_movimiento": (
                "Ingreso Manual - Caja Mayor"
                if ingreso.get("caja") == "caja_mayor"
                else "Ingreso Manual"
            ),
            "id_movimiento": ingreso.get("ingreso_id", ""),
            "nro_comprobante": ingreso.get("comprobante_numero", ""),
            "flujo_periodo": float(ingreso.get("monto", 0) or 0),
            "usuario_modificacion": ingreso.get("registrado_por_nombre") or ingreso.get("registrado_por"),
            "notas": ingreso.get("motivo", ""),
        })

    return ingresos_formateados


# ============================================================
# ── RAMA MIGRADA: leer desde cash_expenses / cash_closures ──
# ============================================================

async def _ingresos_efectivo_migrado(sede_id: str, fecha: str) -> Dict:
    """
    Calcula ingresos en efectivo desde cash_expenses (migrado).
    Busca documentos con categoria=INGRESO y medio_de_pago=efectivo.
    """
    docs = await cash_expenses.find({
        "sede_id"   : sede_id,
        "fecha"     : _fecha_query(fecha),
        "categoria" : "INGRESO",
        "origen"    : "migracion"
    }).to_list(None)

    total     = 0
    cantidad  = 0
    for d in docs:
        metodo = _normalizar_metodo(d.get("medio_de_pago", ""))
        if metodo == "efectivo":
            total    += d.get("monto", 0) or 0
            cantidad += 1

    return {
        "total"          : total,
        "cantidad_pagos" : cantidad,
        "cantidad_ventas": cantidad
    }


async def _ingresos_por_metodo_migrado(sede_id: str, fecha: str) -> Dict:
    """
    Calcula ingresos discriminados por método desde cash_expenses (migrado).
    Solo considera categoria=INGRESO.
    """
    metodos = _metodos_pago_base()

    docs = await cash_expenses.find({
        "sede_id"   : sede_id,
        "fecha"     : _fecha_query(fecha),
        "categoria" : "INGRESO",
        "origen"    : "migracion"
    }).to_list(None)

    for d in docs:
        metodo_norm = _normalizar_metodo(d.get("medio_de_pago", ""))
        if metodo_norm not in metodos:
            metodos[metodo_norm] = 0
        metodos[metodo_norm] += d.get("monto", 0) or 0

    metodos["total_general"] = sum(
        monto for key, monto in metodos.items() if key != "total_general"
    )
    return metodos


async def _egresos_efectivo_migrado(sede_id: str, fecha: str) -> Dict:
    agrupados = { ... }  # igual que antes
    
    # ← AGREGAR esto al final, antes del return
    por_metodo = {
        "efectivo": 0, "tarjeta_credito": 0, "tarjeta_debito": 0,
        "pos": 0, "transferencia": 0, "link_de_pago": 0,
        "giftcard": 0, "addi": 0, "abonos": 0, "otros": 0,
    }
    # Los migrados no tienen metodo_pago → todos van a efectivo por defecto
    por_metodo["efectivo"] = agrupados["total"]
    
    agrupados["por_metodo"]     = por_metodo
    agrupados["total_efectivo"] = por_metodo["efectivo"]
    return agrupados


async def _ventas_dia_migrado(sede_id: str, fecha: str) -> List[Dict]:
    """
    Obtiene ingresos del día desde cash_expenses (migrado).
    Equivalente a obtener_ventas_dia() pero desde datos migrados.
    """
    docs = await cash_expenses.find({
        "sede_id"   : sede_id,
        "fecha"     : _fecha_query(fecha),
        "categoria" : "INGRESO",
        "origen"    : "migracion"
    }).sort("creado_en", 1).to_list(None)

    ventas = []
    for d in docs:
        # Prioridad: _raw.fecha (tiene hora real) → fecha del doc → fallback
        fecha_dt = _extraer_fecha_migrado(d, fecha)

        ventas.append({
            "fecha"               : fecha_dt,
            "nombre_cliente"      : d.get("nombre_cliente"),
            "cedula_cliente"      : d.get("ci_cliente"),
            "email_cliente"       : d.get("email_cliente"),
            "telefono_cliente"    : d.get("telefono_cliente"),
            "medio_pago"          : d.get("medio_de_pago", "").capitalize(),
            "tipo_movimiento"     : d.get("tipo"),
            "id_movimiento"       : d.get("id_movimiento_origen"),
            "nro_comprobante"     : d.get("nro_comprobante"),
            "flujo_periodo"       : d.get("monto", 0),
            "usuario_modificacion": d.get("usuario_modificacion"),
            "notas"               : d.get("notas"),
            "codigo_autorizacion" : d.get("codigo_autorizacion"),
        })

    return ventas


async def _egresos_dia_migrado(sede_id: str, fecha: str) -> List[Dict]:
    """
    Obtiene egresos del día desde cash_expenses (migrado).
    Equivalente a obtener_egresos_dia() pero desde datos migrados.
    """
    docs = await cash_expenses.find({
        "sede_id"   : sede_id,
        "fecha"     : _fecha_query(fecha),
        "categoria" : "EGRESO",
        "origen"    : "migracion"
    }).sort("creado_en", 1).to_list(None)

    egresos = []
    for d in docs:
        # Prioridad: _raw.fecha (tiene hora real) → fecha del doc → fallback
        fecha_dt = _extraer_fecha_migrado(d, fecha)

        egresos.append({
            "fecha"           : fecha_dt,
            "concepto"        : d.get("concepto", d.get("descripcion", "")),
            "medio_pago"      : d.get("medio_de_pago", "Efectivo"),
            "tipo_movimiento" : "Egresos",
            "id_egreso"       : d.get("egreso_id"),
            "nro_comprobante" : d.get("nro_comprobante"),
            "flujo_periodo"   : d.get("monto", 0),
            "notas"           : d.get("descripcion"),
        })

    return egresos


async def _movimientos_efectivo_migrado(sede_id: str, fecha: str) -> Dict:
    """
    Obtiene movimientos en efectivo desde cash_expenses (migrado).
    Usa categoria=EFECTIVO que tiene el campo flujo ('+' o '-').
    """
    # Saldo inicial desde cash_closures
    apertura     = await _buscar_apertura(sede_id, fecha)
    saldo_inicial = apertura.get("efectivo_inicial", 0) if apertura else 0

    docs = await cash_expenses.find({
        "sede_id"   : sede_id,
        "fecha"     : _fecha_query(fecha),
        "categoria" : "EFECTIVO",
        "origen"    : "migracion"
    }).sort("creado_en", 1).to_list(None)

    movimientos = []
    for d in docs:
        es_ingreso = str(d.get("flujo", "+")).strip() == "+"
        monto      = d.get("monto", 0) or 0
        tipo_mov   = d.get("tipo", "")

        # Prioridad: _raw.fecha (tiene hora real) → fecha del doc → fallback
        fecha_dt = _extraer_fecha_migrado(d, fecha)

        notas_val = d.get("notas") or ""
        movimientos.append({
            "fecha"      : fecha_dt,
            "tipo"       : "INGRESO" if es_ingreso else "EGRESO",
            "descripcion": f"{tipo_mov} - {notas_val}".strip(" -"),
            "comprobante": d.get("nro_comprobante", ""),
            "ingreso"    : monto if es_ingreso else 0,
            "egreso"     : 0 if es_ingreso else monto,
            "saldo"      : 0,
        })

    ingresos_manuales = await _ingresos_manuales_docs(sede_id, fecha)
    for ingreso in ingresos_manuales:
        if _normalizar_metodo(ingreso.get("metodo_pago", "")) != "efectivo":
            continue

        monto = float(ingreso.get("monto", 0) or 0)
        if monto <= 0:
            continue

        movimientos.append({
            "fecha": _fecha_para_manual(ingreso, fecha),
            "tipo": "INGRESO",
            "descripcion": f"Ingreso manual - {ingreso.get('motivo', '')}".strip(" -"),
            "comprobante": ingreso.get("comprobante_numero", ""),
            "ingreso": monto,
            "egreso": 0,
            "saldo": 0,
        })

    # Calcular saldo corrido
    movimientos.sort(key=lambda x: x["fecha"] if x["fecha"] else datetime.min)
    saldo = saldo_inicial
    for mov in movimientos:
        saldo      += mov["ingreso"]
        saldo      -= mov["egreso"]
        mov["saldo"] = saldo

    return {
        "saldo_inicial": saldo_inicial,
        "movimientos"  : movimientos,
        "saldo_final"  : saldo,
    }


# ============================================================
# ── RAMA NORMAL: leer desde appointments + sales ────────────
# (código original sin modificaciones)
# ============================================================

async def calcular_ingresos_efectivo_appointments(
    sede_id: str,
    fecha: str
) -> Dict:
    fecha_dt     = datetime.strptime(fecha, "%Y-%m-%d" or "%d-%m-%Y")
    fecha_inicio = fecha_dt.replace(hour=0,  minute=0,  second=0,  microsecond=0)
    fecha_fin    = fecha_dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    pipeline = [
        {
            "$match": {
                "sede_id": sede_id,
                # ✅ Ya NO filtramos por fecha de cita aquí, porque el pago puede ser en otro día
                "historial_pagos": {"$exists": True, "$ne": []},
                "$or": [
                    {"estado_factura": {"$exists": False}},
                    {"estado_factura": {"$ne": "facturado"}}
                ]
            }
        },
        {"$unwind": "$historial_pagos"},
        {
            "$match": {
                "historial_pagos.metodo": "efectivo",
                # ✅ Filtramos por fecha del PAGO, no de la cita
                "historial_pagos.fecha": {
                    "$gte": fecha_inicio,
                    "$lte": fecha_fin
                }
            }
        },
        {
            "$group": {
                "_id": None,
                "total_efectivo": {"$sum": "$historial_pagos.monto"},
                "abonos": {"$sum": {"$cond": [{"$eq": ["$historial_pagos.tipo", "abono_inicial"]}, "$historial_pagos.monto", 0]}},
                "cantidad_pagos": {"$sum": 1},
                "citas_ids": {"$addToSet": "$_id"}
            }
        }
    ]

    resultado = await appointments.aggregate(
        pipeline, allowDiskUse=True
    ).to_list(None)

    if not resultado:
        return {"total": 0, "cantidad_pagos": 0, "cantidad_citas": 0}

    return {
        "total"         : resultado[0]["total_efectivo"],
        "cantidad_pagos": resultado[0]["cantidad_pagos"],
        "cantidad_citas": len(resultado[0]["citas_ids"])
    }


async def calcular_ingresos_efectivo_sales(
    sede_id: str,
    fecha: str
) -> Dict:
    fecha_dt     = datetime.strptime(fecha, "%Y-%m-%d")
    fecha_inicio = fecha_dt.replace(hour=0,  minute=0,  second=0,  microsecond=0)
    fecha_fin    = fecha_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

    pipeline = [
        {
            "$match": {
                "sede_id": sede_id,
                "historial_pagos": {"$exists": True, "$ne": []}
            }
        },
        {"$unwind": "$historial_pagos"},
        {
            "$match": {
                "historial_pagos.metodo": "efectivo",
                # ✅ Re-filtrar por fecha después del unwind
                "historial_pagos.fecha": {
                    "$gte": fecha_inicio,
                    "$lte": fecha_fin
                }
            }
        },
        {
            "$group": {
                "_id": None,
                "total_efectivo": {"$sum": "$historial_pagos.monto"},
                "cantidad_pagos": {"$sum": 1},
                "ventas_ids": {"$addToSet": "$identificador"}
            }
        }
    ]

    resultado = await sales.aggregate(
        pipeline, allowDiskUse=True
    ).to_list(None)

    ventas_migradas = await sales.find({
        "sede_id"  : sede_id,
        "fecha_pago": {"$gte": fecha_inicio, "$lte": fecha_fin},
        "historial_pagos": {"$exists": False},
        "desglose_pagos.efectivo": {"$exists": True, "$gt": 0}
    }).to_list(None)

    total_migrado     = sum(v.get("desglose_pagos", {}).get("efectivo", 0) for v in ventas_migradas)
    cantidad_migradas = len(ventas_migradas)

    if not resultado:
        return {
            "total"          : total_migrado,
            "cantidad_pagos" : cantidad_migradas,
            "cantidad_ventas": cantidad_migradas
        }

    return {
        "total"          : resultado[0]["total_efectivo"] + total_migrado,
        "cantidad_pagos" : resultado[0]["cantidad_pagos"] + cantidad_migradas,
        "cantidad_ventas": len(resultado[0]["ventas_ids"]) + cantidad_migradas
    }


async def calcular_ingresos_por_metodo_pago(
    sede_id: str,
    fecha: str
) -> Dict:
    fecha_dt     = datetime.strptime(fecha, "%Y-%m-%d" or "%d-%m-%Y")
    fecha_inicio = fecha_dt.replace(hour=0,  minute=0,  second=0,  microsecond=0)
    fecha_fin    = fecha_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

    metodos = _metodos_pago_base()

    # 1. Appointments NO facturadas
    pipeline_appointments = [
        {
            "$match": {
                "sede_id": sede_id,
                # ✅ Sin filtro de fecha de cita
                "historial_pagos": {"$exists": True, "$ne": []},
                "$or": [
                    {"estado_factura": {"$exists": False}},
                    {"estado_factura": {"$ne": "facturado"}}
                ]
            }
        },
        {"$unwind": "$historial_pagos"},
        {
            "$match": {
                "historial_pagos.fecha": {
                    "$gte": fecha_inicio,
                    "$lte": fecha_fin
                }
            }
        },
        {
            "$group": {
                "_id"  : "$historial_pagos.metodo",
                "total": {"$sum": "$historial_pagos.monto"}
            }
        }
    ]

    for item in await appointments.aggregate(pipeline_appointments, allowDiskUse=True).to_list(None):
        metodo_norm = _normalizar_metodo(item["_id"])
        if metodo_norm not in metodos:
            metodos[metodo_norm] = 0
        metodos[metodo_norm] += item["total"]

    # 2. Sales con historial_pagos
    pipeline_sales = [
    {
        "$match": {
            "sede_id": sede_id,
            # ✅ Sin filtro de fecha aquí — se hace después del unwind
            "historial_pagos": {"$exists": True, "$ne": []}
        }
    },
    {"$unwind": "$historial_pagos"},
    {
        # ✅ Re-filtrar por fecha DESPUÉS del unwind
        "$match": {
            "historial_pagos.fecha": {
                "$gte": fecha_inicio,
                "$lte": fecha_fin
            }
        }
    },
    {
        "$group": {
            "_id"  : "$historial_pagos.metodo",  # ✅ con $ 
            "total": {"$sum": "$historial_pagos.monto"}
        }
    }
]

    for item in await sales.aggregate(pipeline_sales, allowDiskUse=True).to_list(None):
        metodo_norm = _normalizar_metodo(item["_id"])
        if metodo_norm not in metodos:
            metodos[metodo_norm] = 0
        metodos[metodo_norm] += item["total"]

    # 3. Sales migradas (desglose_pagos)
    for venta in await sales.find({
        "sede_id"  : sede_id,
        "fecha_pago": {"$gte": fecha_inicio, "$lte": fecha_fin},
        "historial_pagos": {"$exists": False},
        "desglose_pagos" : {"$exists": True}
    }).to_list(None):
        for metodo, monto in venta.get("desglose_pagos", {}).items():
            if metodo == "total":
                continue
            metodo_norm = _normalizar_metodo(metodo)
            if metodo_norm not in metodos:
                metodos[metodo_norm] = 0
            metodos[metodo_norm] += monto

    # ❌ ELIMINAR estas líneas al final de calcular_ingresos_por_metodo_pago
    abonos_valor = metodos.pop("abonos", 0)
    metodos["abonos_informativos"] = abonos_valor

    # ✅ REEMPLAZAR por esto — query que filtra por TIPO, no por método
    pipeline_abonos = [
        {
            "$match": {
                "sede_id": sede_id,
                "historial_pagos": {"$exists": True, "$ne": []},
                "$or": [
                    {"estado_factura": {"$exists": False}},
                    {"estado_factura": {"$ne": "facturado"}}
                ]
            }
        },
        {"$unwind": "$historial_pagos"},
        {
            "$match": {
                "historial_pagos.tipo": "abono_inicial",
                "historial_pagos.fecha": {
                    "$gte": fecha_inicio,
                    "$lte": fecha_fin
                }
            }
        },
        {
            "$group": {
                "_id": None,
                "total": {"$sum": "$historial_pagos.monto"}
            }
        }
    ]

    total_abonos = 0
    resultado_abonos = await appointments.aggregate(pipeline_abonos, allowDiskUse=True).to_list(None)
    if resultado_abonos:
        total_abonos += resultado_abonos[0]["total"]

    # Lo mismo para sales
    pipeline_abonos_sales = [
        {
            "$match": {
                "sede_id": sede_id,
                "historial_pagos": {"$exists": True, "$ne": []}
            }
        },
        {"$unwind": "$historial_pagos"},
        {
            "$match": {
                "historial_pagos.tipo": "abono_inicial",
                "historial_pagos.fecha": {
                    "$gte": fecha_inicio,
                    "$lte": fecha_fin
                }
            }
        },
        {
            "$group": {
                "_id": None,
                "total": {"$sum": "$historial_pagos.monto"}
            }
        }
    ]

    resultado_abonos_sales = await sales.aggregate(pipeline_abonos_sales, allowDiskUse=True).to_list(None)
    if resultado_abonos_sales:
        total_abonos += resultado_abonos_sales[0]["total"]

    metodos["abonos_informativos"] = total_abonos

    # total_general NO cambia — los abonos ya están sumados en su método real
    metodos["total_general"] = sum(
        monto for key, monto in metodos.items()
        if key not in ("total_general", "abonos_informativos")
    )
    return metodos

async def calcular_egresos_efectivo(
    sede_id: str,
    fecha: str
) -> Dict:
    agrupados = {
        "compras_internas" : {"total": 0, "cantidad": 0},
        "gastos_operativos": {"total": 0, "cantidad": 0},
        "retiros_caja"     : {"total": 0, "cantidad": 0},
        "otros"            : {"total": 0, "cantidad": 0},
    }

    # ← NUEVO: desglose por método de pago
    por_metodo = {
        "efectivo": 0, "tarjeta_credito": 0, "tarjeta_debito": 0,
        "pos": 0, "transferencia": 0, "link_de_pago": 0,
        "giftcard": 0, "addi": 0, "abonos": 0, "otros": 0,
    }

    for egreso in await cash_expenses.find({
    "sede_id": sede_id,
    "fecha"  : _fecha_query(fecha),
    "origen" : {"$ne": "migracion"},
    "eliminado": {"$ne": True}
    }).to_list(None):
        tipo  = egreso.get("tipo", "otro")
        monto = egreso.get("monto", 0)
        metodo = _normalizar_metodo(egreso.get("metodo_pago", "efectivo"))  # ← NUEVO
        if tipo in agrupados:
            agrupados[tipo]["total"]    += monto
            agrupados[tipo]["cantidad"] += 1
        else:
            agrupados["otros"]["total"]    += monto
            agrupados["otros"]["cantidad"] += 1

        if metodo not in por_metodo:
            por_metodo[metodo] = 0
        por_metodo[metodo] += monto

    agrupados["por_metodo"] = por_metodo           # ← NUEVO
    agrupados["total_efectivo"] = por_metodo.get("efectivo", 0)  # ← NUEVO
    agrupados["total"]          = sum(               # ← AGREGAR ESTO
        agrupados[cat]["total"]
        for cat in ["compras_internas", "gastos_operativos", "retiros_caja", "otros"]
    )
    return agrupados


async def _obtener_ventas_dia_sistema(
    sede_id: str,
    fecha: str
) -> List[Dict]:
    fecha_dt     = datetime.strptime(fecha, "%Y-%m-%d")
    fecha_inicio = fecha_dt.replace(hour=0,  minute=0,  second=0,  microsecond=0)
    fecha_fin    = fecha_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

    ventas_formateadas = []

    # =========================================================
    # 1. APPOINTMENTS NO FACTURADAS
    # Igual que calcular_ingresos_por_metodo_pago rama appointments
    # =========================================================
    pipeline_appointments = [
        {
            "$match": {
                "sede_id": sede_id,
                "historial_pagos": {"$exists": True, "$ne": []},
                "$or": [
                    {"estado_factura": {"$exists": False}},
                    {"estado_factura": {"$ne": "facturado"}}
                ]
            }
        },
        {"$unwind": "$historial_pagos"},
        {
            "$match": {
                "historial_pagos.fecha": {
                    "$gte": fecha_inicio,
                    "$lte": fecha_fin
                }
            }
        }
    ]

    async for cita in appointments.aggregate(pipeline_appointments, allowDiskUse=True):
        pago = cita["historial_pagos"]
        ventas_formateadas.append({
            "fecha"               : pago.get("fecha"),
            "nombre_cliente"      : cita.get("cliente_nombre", ""),
            "cedula_cliente"      : cita.get("cedula_cliente", ""),
            "email_cliente"       : cita.get("cliente_email", ""),
            "telefono_cliente"    : cita.get("cliente_telefono", ""),
            "medio_pago"          : pago.get("metodo", "").replace("_", " ").title(),
            "tipo_movimiento"     : pago.get("tipo", ""),
            "id_movimiento"       : str(cita.get("_id", "")),
            "nro_comprobante"     : cita.get("numero_comprobante", ""),
            "flujo_periodo"       : pago.get("monto", 0),
            "usuario_modificacion": pago.get("registrado_por", ""),
            "notas"               : pago.get("notas", ""),
        })

    # =========================================================
    # 2. SALES CON HISTORIAL_PAGOS
    # Filtra por fecha REAL del pago, no por fecha_pago (cierre)
    # =========================================================
    pipeline_sales = [
        {
            "$match": {
                "sede_id": sede_id,
                # ✅ Sin filtro de fecha aquí — se hace después del unwind
                "historial_pagos": {"$exists": True, "$ne": []}
            }
        },
        {"$unwind": "$historial_pagos"},
        {
            # ✅ Filtrar por fecha real del pago
            "$match": {
                "historial_pagos.fecha": {
                    "$gte": fecha_inicio,
                    "$lte": fecha_fin
                }
            }
        }
    ]

    async for venta in sales.aggregate(pipeline_sales, allowDiskUse=True):
        pago = venta["historial_pagos"]
        ventas_formateadas.append({
            "fecha"               : pago.get("fecha"),
            "nombre_cliente"      : venta.get("nombre_cliente", ""),
            "cedula_cliente"      : venta.get("cedula_cliente", ""),
            "email_cliente"       : venta.get("email_cliente", ""),
            "telefono_cliente"    : venta.get("telefono_cliente", ""),
            "medio_pago"          : pago.get("metodo", "").replace("_", " ").title(),
            "tipo_movimiento"     : pago.get("tipo", ""),
            "id_movimiento"       : venta.get("identificador", ""),
            "nro_comprobante"     : venta.get("numero_comprobante", ""),
            "flujo_periodo"       : pago.get("monto", 0),
            "usuario_modificacion": venta.get("facturado_por", ""),
            "notas"               : pago.get("notas", ""),
        })

    # =========================================================
    # 3. SALES MIGRADAS (sin historial_pagos, usando desglose_pagos)
    # Estas sí se buscan por fecha_pago porque no tienen historial
    # =========================================================
    ventas_migradas = await sales.find({
        "sede_id"        : sede_id,
        "fecha_pago"     : {"$gte": fecha_inicio, "$lte": fecha_fin},
        "historial_pagos": {"$exists": False},
        "desglose_pagos" : {"$exists": True}
    }).to_list(None)

    for venta in ventas_migradas:
        for metodo, monto in venta.get("desglose_pagos", {}).items():
            if metodo == "total" or not monto:
                continue
            ventas_formateadas.append({
                "fecha"               : venta.get("fecha_pago"),
                "nombre_cliente"      : venta.get("nombre_cliente", ""),
                "cedula_cliente"      : venta.get("cedula_cliente", ""),
                "email_cliente"       : venta.get("email_cliente", ""),
                "telefono_cliente"    : venta.get("telefono_cliente", ""),
                "medio_pago"          : metodo.replace("_", " ").title(),
                "tipo_movimiento"     : "Venta Migrada",
                "id_movimiento"       : venta.get("identificador", ""),
                "nro_comprobante"     : venta.get("numero_comprobante", ""),
                "flujo_periodo"       : monto,
                "usuario_modificacion": venta.get("facturado_por", ""),
                "notas"               : "",
            })

    # Ordenar por fecha real del pago
    ventas_formateadas.sort(
        key=lambda x: x["fecha"] if x["fecha"] else datetime.min
    )

    return ventas_formateadas


async def _obtener_egresos_dia_sistema(
    sede_id: str,
    fecha: str
) -> List[Dict]:
    egresos_formateados = []

    for e in await cash_expenses.find({
        "sede_id": sede_id,
        "fecha"  : _fecha_query(fecha),
        "origen" : {"$ne": "migracion"},
        "eliminado": {"$ne": True}
    }).sort("creado_en", 1).to_list(None):
        egresos_formateados.append({
            "fecha"          : e.get("creado_en", ""),
            "concepto"       : e.get("concepto", ""),
            "medio_pago"     : e.get("metodo_pago", "efectivo").replace("_", " ").title(),  # ← FIX
            "tipo_movimiento": "Egresos",
            "id_egreso"      : e.get("egreso_id", ""),
            "nro_comprobante": e.get("comprobante_numero", ""),
            "flujo_periodo"  : e.get("monto", 0),
            "notas"          : e.get("descripcion", "")
        })

    return egresos_formateados


async def _obtener_movimientos_efectivo_dia_sistema(
    sede_id: str,
    fecha: str
) -> Dict:
    apertura      = await _buscar_apertura(sede_id, fecha)
    saldo_inicial = apertura.get("efectivo_inicial", 0) if apertura else 0

    fecha_dt     = datetime.strptime(fecha, "%Y-%m-%d")
    fecha_inicio = fecha_dt.replace(hour=0,  minute=0,  second=0,  microsecond=0)
    fecha_fin    = fecha_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

    movimientos = []

    # =========================================================
    # 1. APPOINTMENTS NO FACTURADAS (efectivo)
    # ✅ Fix Bug 1: incluye citas como ZULMA que no están en sales
    # =========================================================
    pipeline_appointments = [
        {
            "$match": {
                "sede_id": sede_id,
                "historial_pagos": {"$exists": True, "$ne": []},
                "$or": [
                    {"estado_factura": {"$exists": False}},
                    {"estado_factura": {"$ne": "facturado"}}
                ]
            }
        },
        {"$unwind": "$historial_pagos"},
        {
            "$match": {
                "historial_pagos.metodo": "efectivo",
                # ✅ Fix Bug 2: re-filtrar fecha DESPUÉS del unwind
                "historial_pagos.fecha": {
                    "$gte": fecha_inicio,
                    "$lte": fecha_fin
                }
            }
        }
    ]

    async for cita in appointments.aggregate(pipeline_appointments, allowDiskUse=True):
        pago = cita["historial_pagos"]
        movimientos.append({
            "fecha"      : pago.get("fecha"),
            "tipo"       : "INGRESO",
            "descripcion": f"{cita.get('cliente_nombre', '')} - cita",
            "comprobante": cita.get("numero_comprobante", ""),
            "ingreso"    : pago.get("monto", 0),
            "egreso"     : 0,
            "saldo"      : 0
        })

    # =========================================================
    # 2. SALES CON HISTORIAL_PAGOS (incluye citas facturadas)
    # ✅ Fix Bug 2 y 3: unwind + re-filtro, solo sales (no duplicar appointments)
    # =========================================================
    pipeline_sales = [
        {
            "$match": {
                "sede_id": sede_id,
                # ✅ Sin filtro de fecha aquí — se hace después del unwind
                "historial_pagos": {"$exists": True, "$ne": []}
            }
        },
        {"$unwind": "$historial_pagos"},
        {
            "$match": {
                "historial_pagos.metodo": "efectivo",
                # ✅ Fecha real del pago, no fecha de cierre
                "historial_pagos.fecha": {
                    "$gte": fecha_inicio,
                    "$lte": fecha_fin
                }
            }
        }
    ]

    async for venta in sales.aggregate(pipeline_sales, allowDiskUse=True):
        pago = venta["historial_pagos"]
        movimientos.append({
            "fecha"      : pago.get("fecha"),
            "tipo"       : "INGRESO",
            "descripcion": f"{venta.get('nombre_cliente', '')} - {venta.get('tipo_origen', 'venta')}",
            "comprobante": venta.get("numero_comprobante", ""),
            "ingreso"    : pago.get("monto", 0),
            "egreso"     : 0,
            "saldo"      : 0
        })

    # =========================================================
    # 3. SALES MIGRADAS (sin historial_pagos)
    # Estas sí usan fecha_pago porque no tienen historial
    # =========================================================
    for venta in await sales.find({
        "sede_id"        : sede_id,
        "fecha_pago"     : {"$gte": fecha_inicio, "$lte": fecha_fin},
        "historial_pagos": {"$exists": False},
        "desglose_pagos.efectivo": {"$exists": True, "$gt": 0}
    }).to_list(None):
        movimientos.append({
            "fecha"      : venta.get("fecha_pago"),
            "tipo"       : "INGRESO",
            "descripcion": f"{venta.get('nombre_cliente', '')} - venta migrada",
            "comprobante": venta.get("numero_comprobante", ""),
            "ingreso"    : venta.get("desglose_pagos", {}).get("efectivo", 0),
            "egreso"     : 0,
            "saldo"      : 0
        })

    # =========================================================
    # 4. INGRESOS MANUALES EN EFECTIVO
    # =========================================================
    ingresos_manuales = await _ingresos_manuales_docs(sede_id, fecha)
    for ingreso in ingresos_manuales:
        if _normalizar_metodo(ingreso.get("metodo_pago", "")) != "efectivo":
            continue
        monto = float(ingreso.get("monto", 0) or 0)
        if monto <= 0:
            continue
        movimientos.append({
            "fecha"      : _fecha_para_manual(ingreso, fecha),
            "tipo"       : "INGRESO",
            "descripcion": f"Ingreso manual - {ingreso.get('motivo', '')}".strip(" -"),
            "comprobante": ingreso.get("comprobante_numero", ""),
            "ingreso"    : monto,
            "egreso"     : 0,
            "saldo"      : 0,
        })

    # =========================================================
    # 5. EGRESOS (sin cambios)
    # =========================================================
    for e in await cash_expenses.find({
        "sede_id": sede_id,
        "fecha"  : _fecha_query(fecha),
        "origen" : {"$ne": "migracion"},
        "eliminado": {"$ne": True}
    }).sort("creado_en", 1).to_list(None):
        metodo = _normalizar_metodo(e.get("metodo_pago", "efectivo"))
        if metodo != "efectivo":
            continue   # ← transferencias, tarjetas, etc. NO tocan la caja física
        movimientos.append({
            "fecha"      : e.get("creado_en"),
            "tipo"       : "EGRESO",
            "descripcion": f"{e.get('concepto', '')} - {e.get('descripcion', '')}",
            "comprobante": e.get("comprobante_numero", ""),
            "ingreso"    : 0,
            "egreso"     : e.get("monto", 0),
            "saldo"      : 0
        })

    # Ordenar y calcular saldo corrido
    movimientos.sort(key=lambda x: x["fecha"] if x["fecha"] else datetime.min)
    saldo = saldo_inicial
    for mov in movimientos:
        saldo       += mov["ingreso"]
        saldo       -= mov["egreso"]
        mov["saldo"] = saldo

    return {
        "saldo_inicial": saldo_inicial,
        "movimientos"  : movimientos,
        "saldo_final"  : saldo  # ✅ Debería dar 49,100
    }


# ============================================================
# ── FUNCIONES PÚBLICAS HÍBRIDAS ─────────────────────────────
# Estas son las que llaman el resto de la app.
# Primero verifican si hay data migrada y despachan al handler
# correcto de forma transparente.
# ============================================================

async def calcular_resumen_dia(
    sede_id: str,
    fecha: str
) -> Dict:
    """
    Resumen completo del día.
    Si existe data migrada en cash_expenses → usa rama migrada.
    Si no → usa appointments + sales (flujo normal).
    """
    sede            = await locales.find_one({"sede_id": sede_id})
    sede_nombre     = sede.get("nombre") if sede else "Sede desconocida"
    moneda          = sede.get("moneda", "COP") if sede else "COP"

    apertura         = await _buscar_apertura(sede_id, fecha)
    efectivo_inicial = apertura.get("efectivo_inicial", 0) if apertura else 0
    

    migrado = await _tiene_data_migrada(sede_id, fecha)

    if migrado:
        # ── Rama migrada ──────────────────────────────────────
        ingresos_efectivo    = await _ingresos_efectivo_migrado(sede_id, fecha)
        ingresos_discriminados = await _ingresos_por_metodo_migrado(sede_id, fecha)
        egresos              = await _egresos_efectivo_migrado(sede_id, fecha)

        total_ingresos_efectivo = ingresos_efectivo["total"]

        ingresos_info = {
            "appointments_no_facturadas": 0,
            "sales_facturadas"          : total_ingresos_efectivo,
            "total"                     : total_ingresos_efectivo,
            "fuente"                    : "migracion"
        }

    else:
        # ── Rama normal ───────────────────────────────────────
        ingresos_appointments  = await calcular_ingresos_efectivo_appointments(sede_id, fecha)
        ingresos_sales         = await calcular_ingresos_efectivo_sales(sede_id, fecha)
        ingresos_discriminados = await calcular_ingresos_por_metodo_pago(sede_id, fecha)
        egresos                = await calcular_egresos_efectivo(sede_id, fecha)

        total_ingresos_efectivo = ingresos_appointments["total"] + ingresos_sales["total"]

        ingresos_info = {
            "appointments_no_facturadas": ingresos_appointments["total"],
            "sales_facturadas"          : ingresos_sales["total"],
            "total"                     : total_ingresos_efectivo,
            "fuente"                    : "sistema"
        }

    ingresos_manuales = await _ingresos_manuales_por_metodo(sede_id, fecha)
    total_manual = float(ingresos_manuales.get("total_general", 0) or 0)
    total_manual_efectivo = float(ingresos_manuales.get("efectivo", 0) or 0)

    for metodo, monto in ingresos_manuales.items():
        if metodo == "total_general":
            continue
        ingresos_discriminados[metodo] = float(ingresos_discriminados.get(metodo, 0) or 0) + float(monto or 0)

    ingresos_discriminados["total_general"] = float(
        ingresos_discriminados.get("total_general", 0) or 0
    ) + total_manual

    total_ingresos_efectivo += total_manual_efectivo
    ingresos_info["manuales"] = total_manual
    ingresos_info["manuales_efectivo"] = total_manual_efectivo
    ingresos_info["total"] = total_ingresos_efectivo

    total_egresos_efectivo = egresos.get("total_efectivo", egresos.get("total", 0))  # fallback para datos migrados
    efectivo_esperado = efectivo_inicial + total_ingresos_efectivo - total_egresos_efectivo

    return {
        "sede_id"         : sede_id,
        "sede_nombre"     : sede_nombre,
        "fecha"           : fecha,
        "moneda"          : moneda,
        "efectivo_inicial": efectivo_inicial,
        "ingresos_efectivo": ingresos_info,
        "ingresos_otros_metodos": {
            "tarjeta_credito"      : ingresos_discriminados.get("tarjeta_credito", 0),
            "tarjeta_debito"       : ingresos_discriminados.get("tarjeta_debito",  0),
            "abonos"               : ingresos_discriminados.get("abonos_informativos", 0),
            "abono_transferencia"  : ingresos_discriminados.get("abono_transferencia", 0),  # ← nuevo
            "link_de_pago"         : (ingresos_discriminados.get("link_de_pago", 0) or 0)
                                    + (ingresos_discriminados.get("link_pago", 0) or 0),
            "giftcard"             : ingresos_discriminados.get("giftcard",        0),
            "addi"                 : ingresos_discriminados.get("addi",            0),
            "pos"                  : ingresos_discriminados.get("pos",             0),
            "transferencia"        : ingresos_discriminados.get("transferencia",   0),
            "descuento_por_nomina" : (ingresos_discriminados.get("descuento_por_nomina", 0) or 0)
                                    + (ingresos_discriminados.get("descuento_nomina", 0) or 0),
            "otros"                : ingresos_discriminados.get("otros",           0),
            "total"                : (
                ingresos_discriminados.get("total_general", 0)
                - ingresos_discriminados.get("efectivo", 0)
            )
        },
        "egresos"          : egresos,
        "egresos_por_metodo": egresos.get("por_metodo", {}),
        "efectivo_esperado": efectivo_esperado,
        "total_vendido"    : ingresos_discriminados.get("total_general", 0),
        "efectivo_contado" : None,
        "diferencia"       : None,
        "estado"           : "abierto"
    }


async def obtener_ventas_dia(
    sede_id: str,
    fecha: str
) -> List[Dict]:
    """
    Devuelve el listado de ingresos del día (Hoja 2 - Flujo de Ingresos).
    Si existe data migrada → usa cash_expenses.
    Si no → usa sales.
    """
    if await _tiene_data_migrada(sede_id, fecha):
        ventas = await _ventas_dia_migrado(sede_id, fecha)
    else:
        ventas = await _obtener_ventas_dia_sistema(sede_id, fecha)

    ingresos_manuales = await _ingresos_manuales_docs(sede_id, fecha)
    ventas.extend(_formatear_ingresos_manuales_para_flujo(ingresos_manuales, fecha))
    ventas.sort(key=lambda item: item.get("fecha") or datetime.min)
    return ventas


async def obtener_egresos_dia(
    sede_id: str,
    fecha: str
) -> List[Dict]:
    """
    Devuelve el listado de egresos del día (Hoja 3 - Flujo de Egresos).
    Si existe data migrada → usa cash_expenses con categoria=EGRESO.
    Si no → usa cash_expenses normal (ya lo hace obtener_egresos_dia).
    """
    if await _tiene_data_migrada(sede_id, fecha):
        return await _egresos_dia_migrado(sede_id, fecha)
    return await _obtener_egresos_dia_sistema(sede_id, fecha)


async def obtener_movimientos_efectivo_dia(
    sede_id: str,
    fecha: str
) -> Dict:
    """
    Devuelve movimientos en efectivo con saldo corrido (Hoja 4).
    Si existe data migrada → usa cash_expenses con categoria=EFECTIVO.
    Si no → usa sales + cash_expenses normal.
    """
    if await _tiene_data_migrada(sede_id, fecha):
        return await _movimientos_efectivo_migrado(sede_id, fecha)
    return await _obtener_movimientos_efectivo_dia_sistema(sede_id, fecha)
