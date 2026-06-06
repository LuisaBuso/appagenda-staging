# ============================================================
# utils_cash.py - Utilidades para cálculos de caja
# ============================================================

from datetime import datetime, timedelta
from typing import Dict, List, Optional
import secrets
from bson import ObjectId
from datetime import datetime

# ============================================================
# GENERADORES DE IDs
# ============================================================

def generar_cierre_id(sede_id: str, fecha: str) -> str:
    """
    Genera ID único para cierre de caja
    Formato: CC-YYYY-MM-DD-SEDEID-RANDOM
    """
    timestamp = datetime.now().strftime("%H%M%S")
    return f"CC-{fecha}-{sede_id}-{timestamp}"

def generar_egreso_id() -> str:
    """
    Genera ID único para egreso
    Formato: EG-TIMESTAMP-RANDOM
    """
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    random = secrets.token_hex(3).upper()
    return f"EG-{timestamp}-{random}"

def generar_ingreso_id() -> str:
    """
    Genera ID único para ingreso manual
    Formato: IN-TIMESTAMP-RANDOM
    """
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    random = secrets.token_hex(3).upper()
    return f"IN-{timestamp}-{random}"

def generar_apertura_id(sede_id: str, fecha: str) -> str:
    """
    Genera ID único para apertura de caja
    Formato: AP-YYYY-MM-DD-SEDEID
    """
    return f"AP-{fecha}-{sede_id}"

# ============================================================
# VALIDACIONES DE FECHAS
# ============================================================

def normalizar_fecha(fecha: str) -> str:
    """
    Acepta DD-MM-YYYY o YYYY-MM-DD y siempre devuelve YYYY-MM-DD
    """
    for fmt in ("%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(fecha, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ValueError(f"Formato de fecha inválido: '{fecha}'. Use DD-MM-YYYY o YYYY-MM-DD")

def validar_fecha_formato(fecha: str) -> bool:
    """Valida que la fecha esté en formato YYYY-MM-DD"""
    try:
        normalizar_fecha(fecha)
        return True
    except ValueError:
        return False

def obtener_rango_fecha(fecha: str) -> tuple:
    """
    Obtiene el rango de inicio y fin para un día completo
    Returns: (datetime_inicio, datetime_fin)
    """
    fecha_dt = datetime.strptime(normalizar_fecha(fecha), "%Y-%m-%d")
    fecha_inicio = fecha_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    fecha_fin = fecha_dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return (fecha_inicio, fecha_fin)

def fecha_a_datetime(fecha: str) -> datetime:
    """Convierte string YYYY-MM-DD a datetime"""
    return datetime.strptime(normalizar_fecha(fecha), "%Y-%m-%d") 

# ============================================================
# FORMATEADORES
# ============================================================

def formatear_monto(monto: float, moneda: str = "USD") -> str:
    """
    Formatea un monto según la moneda
    """
    simbolos = {
        "USD": "$",
        "COP": "$",
        "EUR": "€",
        "MXN": "$"
    }
    
    simbolo = simbolos.get(moneda, "$")
    
    if moneda == "COP":
        # Sin decimales para pesos colombianos
        return f"{simbolo}{monto:,.0f}"
    else:
        return f"{simbolo}{monto:,.2f}"

def formatear_diferencia(diferencia: float) -> str:
    """
    Formatea la diferencia con signo
    Positivo = Sobrante, Negativo = Faltante
    """
    if diferencia > 0:
        return f"+{diferencia:.2f} (Sobrante)"
    elif diferencia < 0:
        return f"{diferencia:.2f} (Faltante)"
    else:
        return "0.00 (Exacto)"

# ============================================================
# CÁLCULOS DE TOTALES
# ============================================================

def calcular_total_desglose(desglose: List[Dict]) -> float:
    """
    Calcula el total de un desglose físico de billetes/monedas
    """
    if not desglose:
        return 0.0
    
    total = sum(item.get("subtotal", 0) for item in desglose)
    return round(total, 2)

def calcular_diferencia(esperado: float, contado: float) -> float:
    """
    Calcula la diferencia entre efectivo esperado y contado
    Positivo = Sobrante, Negativo = Faltante
    """
    return round(contado - esperado, 2)

# ============================================================
# AGRUPADORES
# ============================================================

def agrupar_por_metodo_pago(pagos: List[Dict]) -> Dict[str, float]:
    """
    Agrupa pagos por método y suma totales
    """
    totales = {}
    for pago in pagos:
        metodo = pago.get("metodo", "efectivo")
        monto = pago.get("monto", 0)
        totales[metodo] = totales.get(metodo, 0) + monto
    
    return totales

def agrupar_egresos_por_tipo(egresos: List[Dict]) -> Dict[str, Dict]:
    """
    Agrupa egresos por tipo y calcula totales
    """
    agrupados = {
        "compras_internas": {"total": 0, "cantidad": 0},
        "gastos_operativos": {"total": 0, "cantidad": 0},
        "retiros_caja": {"total": 0, "cantidad": 0},
        "otros": {"total": 0, "cantidad": 0}
    }
    
    for egreso in egresos:
        tipo = egreso.get("tipo", "otro")
        monto = egreso.get("monto", 0)
        
        if tipo in agrupados:
            agrupados[tipo]["total"] += monto
            agrupados[tipo]["cantidad"] += 1
        else:
            agrupados["otros"]["total"] += monto
            agrupados["otros"]["cantidad"] += 1
    
    return agrupados

# ============================================================
# VALIDACIONES DE NEGOCIO
# ============================================================

def validar_monto_positivo(monto: float, campo: str = "monto") -> None:
    """Valida que un monto sea positivo"""
    if monto < 0:
        raise ValueError(f"El {campo} no puede ser negativo")
    if monto == 0:
        raise ValueError(f"El {campo} debe ser mayor a cero")

def validar_diferencia_aceptable(diferencia: float, tolerancia: float = 10.0) -> tuple:
    """
    Valida si la diferencia está dentro de la tolerancia
    Returns: (es_aceptable, mensaje)
    """
    diferencia_abs = abs(diferencia)
    
    if diferencia_abs == 0:
        return (True, "Cierre exacto ✓")
    elif diferencia_abs <= tolerancia:
        tipo = "Sobrante" if diferencia > 0 else "Faltante"
        return (True, f"{tipo} dentro de tolerancia ({formatear_monto(diferencia_abs)})")
    else:
        tipo = "Sobrante" if diferencia > 0 else "Faltante"
        return (False, f"⚠️ {tipo} excede tolerancia ({formatear_monto(diferencia_abs)})")

# ============================================================
# HELPERS DE CONSULTAS
# ============================================================

def construir_filtro_fecha(fecha: Optional[str] = None, 
                          fecha_inicio: Optional[str] = None,
                          fecha_fin: Optional[str] = None) -> Dict:
    """
    Construye filtro de fecha para queries MongoDB
    """
    if fecha:
        # Fecha específica
        return {"fecha": fecha}
    
    elif fecha_inicio and fecha_fin:
        # Rango de fechas
        return {
            "fecha": {
                "$gte": fecha_inicio,
                "$lte": fecha_fin
            }
        }
    
    elif fecha_inicio:
        # Desde fecha_inicio hasta hoy
        hoy = datetime.now().strftime("%Y-%m-%d")
        return {
            "fecha": {
                "$gte": fecha_inicio,
                "$lte": hoy
            }
        }
    
    else:
        # Hoy por defecto
        hoy = datetime.now().strftime("%Y-%m-%d")
        return {"fecha": hoy}

def construir_pipeline_ingresos_citas(sede_id: str, fecha: str) -> List[Dict]:
    """
    Construye pipeline de agregación para calcular ingresos de citas
    """
    return [
        {
            "$match": {
                "sede_id": sede_id,
                "fecha": fecha,
                "estado_pago": "pagado",
                "$or": [
                    {"metodo_pago_actual": "efectivo"},
                    {"metodo_pago_inicial": "efectivo"}
                ]
            }
        },
        {
            "$group": {
                "_id": None,
                "total": {"$sum": "$valor_total"},
                "cantidad": {"$sum": 1},
                "citas": {
                    "$push": {
                        "cita_id": {"$toString": "$_id"},
                        "cliente": "$cliente_nombre",
                        "monto": "$valor_total"
                    }
                }
            }
        }
    ]

def construir_pipeline_productos_citas(sede_id: str, fecha: str) -> List[Dict]:
    """
    Construye pipeline para calcular productos vendidos en citas
    """
    return [
        {
            "$match": {
                "sede_id": sede_id,
                "fecha": fecha,
                "$or": [
                    {"metodo_pago_actual": "efectivo"},
                    {"metodo_pago_inicial": "efectivo"}
                ],
                "productos": {"$exists": True, "$ne": []}
            }
        },
        {
            "$unwind": "$productos"
        },
        {
            "$group": {
                "_id": None,
                "total": {"$sum": "$productos.subtotal"},
                "cantidad": {"$sum": 1}
            }
        }
    ]

# ============================================================
# CONVERSIONES
# ============================================================

def convertir_moneda(monto: float, de: str, a: str, tasas: Dict[str, float]) -> float:
    """
    Convierte monto entre monedas
    tasas: diccionario con tasas de cambio base USD
    """
    if de == a:
        return monto
    
    # Convertir a USD primero si no es USD
    if de != "USD":
        monto_usd = monto / tasas.get(de, 1)
    else:
        monto_usd = monto
    
    # Convertir de USD a moneda destino
    if a != "USD":
        return monto_usd * tasas.get(a, 1)
    else:
        return monto_usd

# ============================================================
# HELPER PARA SERIALIZACIÓN JSON
# ============================================================

def convertir_mongo_a_json(doc):
    """
    Convierte un documento de MongoDB a formato JSON serializable.
    - ObjectId → string
    - datetime → ISO string
    """
    if doc is None:
        return None
    
    if isinstance(doc, list):
        return [convertir_mongo_a_json(item) for item in doc]
    
    if isinstance(doc, dict):
        result = {}
        for key, value in doc.items():
            if isinstance(value, ObjectId):
                result[key] = str(value)
            elif isinstance(value, datetime):
                result[key] = value.isoformat()
            elif isinstance(value, dict):
                result[key] = convertir_mongo_a_json(value)
            elif isinstance(value, list):
                result[key] = [convertir_mongo_a_json(item) for item in value]
            else:
                result[key] = value
        return result
    
    if isinstance(doc, ObjectId):
        return str(doc)
    
    if isinstance(doc, datetime):
        return doc.isoformat()
    
    return doc
