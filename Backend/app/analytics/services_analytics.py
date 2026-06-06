"""
VERSIÓN CON MULTI-MONEDA
🔧 Ticket promedio ahora se calcula por moneda
"""
from app.database.mongo import collection_citas, collection_clients
from datetime import timedelta, datetime
from typing import Optional, Dict, List, Set
import logging

logger = logging.getLogger(__name__)

CHURN_DAYS = 60
_cache = {}
_cache_ttl = {}
CACHE_DURATION = 300

def get_cache_key(prefix: str, **kwargs) -> str:
    params = "_".join(f"{k}={v}" for k, v in sorted(kwargs.items()) if v is not None)
    return f"{prefix}_{params}"

def get_from_cache(key: str):
    if key in _cache and key in _cache_ttl:
        if datetime.now() < _cache_ttl[key]:
            return _cache[key]
        else:
            del _cache[key]
            del _cache_ttl[key]
    return None

def set_cache(key: str, value, ttl_seconds: int = CACHE_DURATION):
    _cache[key] = value
    _cache_ttl[key] = datetime.now() + timedelta(seconds=ttl_seconds)


def datetime_to_date_string(dt: datetime) -> str:
    """Convierte datetime a string YYYY-MM-DD"""
    return dt.strftime("%Y-%m-%d")


async def get_clientes_periodo(
    start_date: datetime, 
    end_date: datetime, 
    sede_id: Optional[str] = None
) -> Set[str]:
    """Obtiene IDs únicos de clientes con citas en el período"""
    try:
        start_str = datetime_to_date_string(start_date)
        end_str = datetime_to_date_string(end_date)
        
        match_query = {
            "fecha": {"$gte": start_str, "$lte": end_str},
            "estado": {"$ne": "cancelada"},
            "cliente_id": {"$exists": True, "$ne": None}
        }
        if sede_id:
            match_query["sede_id"] = sede_id

        pipeline = [
            {"$match": match_query},
            {"$group": {"_id": "$cliente_id"}},
            {"$project": {"cliente_id": "$_id"}}
        ]

        result = await collection_citas.aggregate(pipeline).to_list(None)
        
        clientes_ids = set()
        for doc in result:
            cliente_id = doc.get("cliente_id")
            if cliente_id and isinstance(cliente_id, str):
                clientes_ids.add(cliente_id)
        
        return clientes_ids
    
    except Exception as e:
        logger.error(f"❌ Error en get_clientes_periodo: {e}", exc_info=True)
        return set()


async def get_fechas_creacion_clientes(
    clientes_ids: Set[str],
    sede_id: Optional[str] = None
) -> Dict[str, datetime]:
    """Obtiene fecha_creacion de cada cliente desde collection_clients"""
    try:
        query = {"cliente_id": {"$in": list(clientes_ids)}}
        if sede_id:
            query["sede_id"] = sede_id
        
        clientes = await collection_clients.find(
            query,
            {"cliente_id": 1, "fecha_creacion": 1}
        ).to_list(None)
        
        fechas_creacion = {}
        for cliente in clientes:
            cliente_id = cliente.get("cliente_id")
            fecha_creacion = cliente.get("fecha_creacion")
            
            if not cliente_id:
                continue
            
            if isinstance(fecha_creacion, datetime):
                fechas_creacion[cliente_id] = fecha_creacion
            elif isinstance(fecha_creacion, str):
                try:
                    fechas_creacion[cliente_id] = datetime.fromisoformat(fecha_creacion)
                except (ValueError, TypeError):
                    logger.warning(f"⚠️ Fecha inválida para cliente {cliente_id}: {fecha_creacion}")
            else:
                logger.warning(f"⚠️ Cliente {cliente_id} sin fecha_creacion válida")
        
        logger.info(f"📅 Fechas de creación obtenidas: {len(fechas_creacion)}/{len(clientes_ids)}")
        return fechas_creacion
    
    except Exception as e:
        logger.error(f"❌ Error en get_fechas_creacion_clientes: {e}", exc_info=True)
        return {}


async def get_ultimas_citas_clientes(
    clientes_ids: Set[str],
    sede_id: Optional[str] = None
) -> Dict[str, datetime]:
    """Obtiene la última cita de cada cliente"""
    try:
        match_query = {
            "cliente_id": {"$in": list(clientes_ids)},
            "estado": {"$ne": "cancelada"}
        }
        if sede_id:
            match_query["sede_id"] = sede_id

        pipeline = [
            {"$match": match_query},
            {"$sort": {"fecha": -1}},
            {"$group": {
                "_id": "$cliente_id",
                "ultima_cita": {"$first": "$fecha"}
            }}
        ]

        result = await collection_citas.aggregate(pipeline).to_list(None)
        
        ultimas_citas = {}
        for doc in result:
            fecha_str = doc["ultima_cita"]
            fecha_dt = datetime.fromisoformat(fecha_str)
            ultimas_citas[doc["_id"]] = fecha_dt
        
        return ultimas_citas
    
    except Exception as e:
        logger.error(f"❌ Error en get_ultimas_citas_clientes: {e}", exc_info=True)
        return {}


async def calcular_nuevos_clientes(
    clientes_actuales: Set[str],
    start_date: datetime,
    end_date: datetime,
    sede_id: Optional[str] = None
) -> List[str]:
    """Un cliente es NUEVO si su fecha_creacion está en el período"""
    try:
        fechas_creacion = await get_fechas_creacion_clientes(clientes_actuales, sede_id)
        
        nuevos = [
            cliente_id for cliente_id, fecha_creacion in fechas_creacion.items()
            if start_date.date() <= fecha_creacion.date() <= end_date.date()
        ]
        
        clientes_sin_fecha = clientes_actuales - set(fechas_creacion.keys())
        if clientes_sin_fecha:
            logger.warning(
                f"⚠️ {len(clientes_sin_fecha)} clientes sin fecha_creacion válida. "
                f"Se asumen como NO nuevos."
            )
        
        logger.info(
            f"👤 Nuevos clientes: {len(nuevos)}/{len(clientes_actuales)} "
            f"(registrados entre {start_date.date()} y {end_date.date()})"
        )
        return nuevos
    
    except Exception as e:
        logger.error(f"❌ Error en calcular_nuevos_clientes: {e}")
        return []


async def get_citas_periodo(
    start_date: datetime,
    end_date: datetime,
    sede_id: Optional[str] = None
) -> List[Dict]:
    """Obtiene todas las citas del período"""
    try:
        start_str = datetime_to_date_string(start_date)
        end_str = datetime_to_date_string(end_date)
        
        query = {
            "fecha": {"$gte": start_str, "$lte": end_str},
            "estado": {"$ne": "cancelada"}
        }
        if sede_id:
            query["sede_id"] = sede_id

        citas = await collection_citas.find(query).to_list(None)
        
        logger.info(f"📋 Citas encontradas: {len(citas)}")
        return citas
    
    except Exception as e:
        logger.error(f"❌ Error en get_citas_periodo: {e}", exc_info=True)
        return []


async def calcular_churn_real(
    clientes_ids: Set[str],
    fecha_referencia: datetime,
    sede_id: Optional[str] = None
) -> int:
    """Calcula churn real"""
    try:
        ultimas_citas = await get_ultimas_citas_clientes(clientes_ids, sede_id)
        
        clientes_perdidos = 0
        
        for cliente_id, ultima_fecha in ultimas_citas.items():
            fecha_limite = ultima_fecha + timedelta(days=CHURN_DAYS)
            
            if fecha_limite < fecha_referencia:
                ultima_str = datetime_to_date_string(ultima_fecha)
                
                match_query = {
                    "cliente_id": cliente_id,
                    "fecha": {"$gt": ultima_str},
                    "estado": {"$ne": "cancelada"}
                }
                if sede_id:
                    match_query["sede_id"] = sede_id
                
                visita_futura = await collection_citas.find_one(match_query)
                
                if not visita_futura:
                    clientes_perdidos += 1
        
        return clientes_perdidos
    
    except Exception as e:
        logger.error(f"❌ Error en calcular_churn_real: {e}")
        return 0


def calcular_crecimiento(valor_anterior: float, valor_actual: float) -> float:
    """Calcula porcentaje de crecimiento"""
    if valor_anterior == 0:
        return 100.0 if valor_actual > 0 else 0.0
    return round(((valor_actual - valor_anterior) / valor_anterior) * 100, 1)


def calcular_ticket_por_moneda(citas: List[Dict]) -> Dict:
    """
    ⭐ NUEVO: Calcula ticket promedio separado por moneda
    """
    tickets_por_moneda = {}
    
    for cita in citas:
        moneda = cita.get("moneda", "COP")  # Default COP para citas viejas
        valor = cita.get("valor_total", 0)
        
        if moneda not in tickets_por_moneda:
            tickets_por_moneda[moneda] = {
                "total": 0,
                "cantidad": 0
            }
        
        tickets_por_moneda[moneda]["total"] += valor
        tickets_por_moneda[moneda]["cantidad"] += 1
    
    # Calcular promedios
    resultado = {}
    for moneda, datos in tickets_por_moneda.items():
        if datos["cantidad"] > 0:
            promedio = datos["total"] / datos["cantidad"]
            resultado[moneda] = {
                "valor": round(promedio, 2),
                "citas": datos["cantidad"],
                "total": round(datos["total"], 2)
            }
    
    return resultado


async def get_kpi_overview(start_date: datetime, end_date: datetime, sede_id=None):
    """KPIs con soporte multi-moneda"""
    
    cache_key = get_cache_key(
        "kpi_overview",
        start=start_date.isoformat(),
        end=end_date.isoformat(),
        sede=sede_id
    )
    
    cached = get_from_cache(cache_key)
    if cached:
        logger.info(f"📦 KPIs obtenidos de caché")
        return cached

    try:
        logger.info(f"🔄 Calculando KPIs: {start_date.date()} a {end_date.date()}, sede: {sede_id}")
        
        # ========= PERÍODO ACTUAL =========
        citas_actuales = await get_citas_periodo(start_date, end_date, sede_id)
        
        clientes_actuales = set()
        for c in citas_actuales:
            cliente_id = c.get("cliente_id")
            if cliente_id and isinstance(cliente_id, str):
                clientes_actuales.add(cliente_id)
        
        logger.info(f"📊 Período actual: {len(citas_actuales)} citas, {len(clientes_actuales)} clientes únicos")
        
        # ========= PERÍODO ANTERIOR =========
        dias_diferencia = (end_date - start_date).days + 1
        start_anterior = start_date - timedelta(days=dias_diferencia)
        end_anterior = start_date - timedelta(days=1)
        
        citas_anteriores = await get_citas_periodo(start_anterior, end_anterior, sede_id)
        
        clientes_anteriores = set()
        for c in citas_anteriores:
            cliente_id = c.get("cliente_id")
            if cliente_id and isinstance(cliente_id, str):
                clientes_anteriores.add(cliente_id)
        
        logger.info(f"📊 Período anterior: {len(citas_anteriores)} citas, {len(clientes_anteriores)} clientes únicos")
        
        # ========= 1. NUEVOS CLIENTES =========
        nuevos_actuales = await calcular_nuevos_clientes(
            clientes_actuales, start_date, end_date, sede_id
        )
        nuevos_anteriores = await calcular_nuevos_clientes(
            clientes_anteriores, start_anterior, end_anterior, sede_id
        )
        
        crecimiento_nuevos = calcular_crecimiento(len(nuevos_anteriores), len(nuevos_actuales))
        
        # ========= 2. TASA DE RECURRENCIA =========
        recurrentes_actuales = len(clientes_actuales) - len(nuevos_actuales)
        tasa_recurrencia = (recurrentes_actuales / max(1, len(clientes_actuales))) * 100
        
        recurrentes_anteriores = len(clientes_anteriores) - len(nuevos_anteriores)
        tasa_recurrencia_anterior = (recurrentes_anteriores / max(1, len(clientes_anteriores))) * 100
        
        crecimiento_recurrencia = tasa_recurrencia - tasa_recurrencia_anterior
        
        logger.info(
            f"🔄 Recurrencia: {recurrentes_actuales}/{len(clientes_actuales)} "
            f"= {round(tasa_recurrencia)}%"
        )
        
        # ========= 3. CHURN RATE =========
        if clientes_actuales:
            churn_actual = await calcular_churn_real(clientes_actuales, datetime.now(), sede_id)
            churn_rate = (churn_actual / len(clientes_actuales)) * 100
        else:
            churn_rate = 0
        
        if clientes_anteriores:
            churn_anterior = await calcular_churn_real(clientes_anteriores, end_anterior, sede_id)
            churn_rate_anterior = (churn_anterior / len(clientes_anteriores)) * 100
        else:
            churn_rate_anterior = 0
        
        crecimiento_churn = churn_rate - churn_rate_anterior
        
        logger.info(f"📉 Churn: {churn_rate:.1f}% ({churn_actual if 'churn_actual' in locals() else 0} clientes)")
        
        # ========= 4. TICKET PROMEDIO POR MONEDA ⭐ =========
        tickets_actuales = calcular_ticket_por_moneda(citas_actuales)
        tickets_anteriores = calcular_ticket_por_moneda(citas_anteriores)
        
        # Calcular crecimiento por moneda
        tickets_con_crecimiento = {}
        for moneda, datos_actuales in tickets_actuales.items():
            datos_anteriores = tickets_anteriores.get(moneda, {"valor": 0})
            
            crecimiento = calcular_crecimiento(
                datos_anteriores["valor"],
                datos_actuales["valor"]
            )
            
            tickets_con_crecimiento[moneda] = {
                "valor": datos_actuales["valor"],
                "citas": datos_actuales["citas"],
                "crecimiento": f"+{crecimiento}%" if crecimiento >= 0 else f"{crecimiento}%"
            }
        
        logger.info(f"💰 Tickets promedio: {tickets_con_crecimiento}")
        
        # ========= RESULTADO =========
        result = {
            "nuevos_clientes": {
                "valor": len(nuevos_actuales),
                "crecimiento": f"+{crecimiento_nuevos}%" if crecimiento_nuevos >= 0 else f"{crecimiento_nuevos}%"
            },
            "tasa_recurrencia": {
                "valor": f"{round(tasa_recurrencia)}%",
                "crecimiento": f"+{round(crecimiento_recurrencia)}%" if crecimiento_recurrencia >= 0 else f"{round(crecimiento_recurrencia)}%"
            },
            "tasa_churn": {
                "valor": f"{round(churn_rate)}%",
                "crecimiento": f"+{round(crecimiento_churn)}%" if crecimiento_churn >= 0 else f"{round(crecimiento_churn)}%"
            },
            "ticket_promedio": tickets_con_crecimiento,  # ⭐ NUEVO: Por moneda
            "debug_info": {
                "total_clientes": len(clientes_actuales),
                "clientes_nuevos": len(nuevos_actuales),
                "clientes_recurrentes": recurrentes_actuales,
                "total_citas": len(citas_actuales)
            }
        }
        
        set_cache(cache_key, result)
        
        logger.info(f"✅ KPIs calculados exitosamente")
        
        return result
    
    except Exception as e:
        logger.error(f"❌ Error en get_kpi_overview: {e}", exc_info=True)
        return {
            "nuevos_clientes": {"valor": 0, "crecimiento": "0%"},
            "tasa_recurrencia": {"valor": "0%", "crecimiento": "0%"},
            "tasa_churn": {"valor": "0%", "crecimiento": "0%"},
            "ticket_promedio": {}
        }