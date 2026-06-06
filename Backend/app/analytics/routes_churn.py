"""
VERSIÓN CORREGIDA de routes_churn.py
✅ FIX: TypeError al sumar string + timedelta (línea 270)
"""
from fastapi import APIRouter, Response, Query, HTTPException
from datetime import datetime, timedelta
from typing import Optional, Dict, List
import pandas as pd
from io import BytesIO
import logging

from app.database.mongo import collection_clients, collection_citas

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["Analytics"])

CHURN_DAYS = 60


# === HELPER PARA CONVERSIÓN DE FECHAS ===

def datetime_to_date_string(dt: datetime) -> str:
    """
    🔧 Convierte datetime a string YYYY-MM-DD
    Necesario porque MongoDB almacena fechas como string
    """
    return dt.strftime("%Y-%m-%d")


# === FUNCIONES HELPER OPTIMIZADAS ===

async def get_clientes_activos_periodo(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    sede_id: Optional[str] = None
) -> List[str]:
    """
    ✅ FIXED: Convierte datetime a string para comparación
    """
    try:
        match_query = {
            "estado": {"$ne": "cancelada"},
            "cliente_id": {"$exists": True, "$ne": None}
        }
        
        if sede_id:
            match_query["sede_id"] = sede_id
        
        # 🔧 Convertir datetime a string
        if start_date and end_date:
            start_str = datetime_to_date_string(start_date)
            end_str = datetime_to_date_string(end_date)
            match_query["fecha"] = {"$gte": start_str, "$lte": end_str}
        
        pipeline = [
            {"$match": match_query},
            {"$group": {"_id": "$cliente_id"}},
            {"$project": {"cliente_id": "$_id"}}
        ]
        
        result = await collection_citas.aggregate(pipeline).to_list(None)
        
        clientes_ids = []
        for doc in result:
            cliente_id = doc.get("cliente_id")
            if cliente_id and isinstance(cliente_id, str):
                clientes_ids.append(cliente_id)
        
        return clientes_ids
    
    except Exception as e:
        logger.error(f"Error en get_clientes_activos_periodo: {e}")
        return []


async def get_ultima_visita_clientes(
    clientes_ids: List[str],
    sede_id: Optional[str] = None
) -> Dict[str, datetime]:
    """
    ✅ FIXED: Convierte fecha string a datetime en el resultado
    🔧 CRÍTICO: Ahora retorna datetime, NO string
    """
    try:
        match_query = {
            "cliente_id": {"$in": clientes_ids},
            "estado": {"$ne": "cancelada"}
        }
        if sede_id:
            match_query["sede_id"] = sede_id
        
        pipeline = [
            {"$match": match_query},
            {"$sort": {"fecha": -1}},
            {"$group": {
                "_id": "$cliente_id",
                "ultima_visita": {"$first": "$fecha"}
            }}
        ]
        
        result = await collection_citas.aggregate(pipeline).to_list(None)
        
        # 🔧 CRÍTICO: Convertir string a datetime
        ultimas_visitas = {}
        for doc in result:
            cliente_id = doc["_id"]
            fecha_str = doc["ultima_visita"]
            
            try:
                # Convertir "2025-10-01" a datetime
                fecha_dt = datetime.fromisoformat(fecha_str)
                ultimas_visitas[cliente_id] = fecha_dt
            except (ValueError, TypeError) as e:
                logger.warning(
                    f"⚠️ Fecha inválida para cliente {cliente_id}: {fecha_str} - {e}"
                )
                continue
        
        logger.info(f"📅 Últimas visitas obtenidas: {len(ultimas_visitas)}/{len(clientes_ids)}")
        return ultimas_visitas
    
    except Exception as e:
        logger.error(f"❌ Error en get_ultima_visita_clientes: {e}", exc_info=True)
        return {}


async def verificar_visitas_futuras(
    clientes_ids: List[str],
    fecha_corte: datetime,
    sede_id: Optional[str] = None
) -> Dict[str, bool]:
    """
    ✅ FIXED: Convierte datetime a string para comparación
    """
    try:
        # 🔧 Convertir datetime a string
        fecha_corte_str = datetime_to_date_string(fecha_corte)
        
        match_query = {
            "cliente_id": {"$in": clientes_ids},
            "fecha": {"$gt": fecha_corte_str},
            "estado": {"$ne": "cancelada"}
        }
        if sede_id:
            match_query["sede_id"] = sede_id
        
        pipeline = [
            {"$match": match_query},
            {"$group": {"_id": "$cliente_id"}},
            {"$project": {"cliente_id": "$_id"}}
        ]
        
        result = await collection_citas.aggregate(pipeline).to_list(None)
        
        clientes_con_visitas = set(doc["cliente_id"] for doc in result)
        
        return {cid: cid in clientes_con_visitas for cid in clientes_ids}
    
    except Exception as e:
        logger.error(f"❌ Error en verificar_visitas_futuras: {e}")
        return {cid: False for cid in clientes_ids}


async def get_datos_clientes_batch(clientes_ids: List[str]) -> Dict[str, Dict]:
    """
    ✅ Busca por cliente_id (string) con fallback a _id
    """
    try:
        clientes = await collection_clients.find(
            {"cliente_id": {"$in": clientes_ids}}
        ).to_list(None)
        
        return {c["cliente_id"]: c for c in clientes if c.get("cliente_id")}
    
    except Exception as e:
        logger.error(f"❌ Error en get_datos_clientes_batch: {e}")
        
        # ⚠️ FALLBACK: Intentar buscar por _id (compatibilidad con datos antiguos)
        try:
            logger.warning("Intentando fallback con búsqueda por _id...")
            from bson import ObjectId
            
            object_ids = []
            for cid in clientes_ids:
                try:
                    if len(cid) == 24:
                        object_ids.append(ObjectId(cid))
                except:
                    pass
            
            if object_ids:
                clientes = await collection_clients.find(
                    {"_id": {"$in": object_ids}}
                ).to_list(None)
                
                result = {}
                for c in clientes:
                    key = c.get("cliente_id") or str(c.get("_id"))
                    result[key] = c
                
                return result
        except Exception as fallback_error:
            logger.error(f"❌ Error en fallback: {fallback_error}")
        
        return {}


# === ENDPOINT PRINCIPAL ===

@router.get("/churn-clientes")
async def obtener_churn_clientes(
    export: bool = False,
    sede_id: Optional[str] = Query(None, description="Filtrar por sede específica"),
    start_date: Optional[str] = Query(None, description="Fecha inicio para análisis (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Fecha fin para análisis (YYYY-MM-DD)")
):
    """
    ✅ FIXED: TypeError corregido - ahora suma datetime + timedelta correctamente
    
    Obtiene lista de clientes en riesgo de abandono (churn).
    
    Un cliente está en churn si:
    - Su última visita fue hace más de CHURN_DAYS (60 días)
    - No tiene citas programadas a futuro
    """
    
    try:
        hoy = datetime.now()
        
        start = None
        end = None
        
        if start_date and end_date:
            try:
                start = datetime.fromisoformat(start_date)
                end = datetime.fromisoformat(end_date)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail="Formato de fecha inválido. Use YYYY-MM-DD"
                )
            
            if start > end:
                raise HTTPException(
                    status_code=400,
                    detail="La fecha de inicio debe ser menor o igual a la fecha fin"
                )
        
        # ✅ PASO 1: Obtener clientes únicos del período
        clientes_ids = await get_clientes_activos_periodo(start, end, sede_id)
        
        if not clientes_ids:
            return {
                "total_churn": 0,
                "clientes": [],
                "parametros": {
                    "sede_id": sede_id,
                    "rango_fechas": f"{start_date} a {end_date}" if start_date and end_date else "Todos los registros",
                    "dias_churn": CHURN_DAYS
                },
                "mensaje": "No hay clientes en el rango especificado"
            }
        
        logger.info(f"📊 Analizando churn de {len(clientes_ids)} clientes...")
        
        # ✅ PASO 2: Obtener última visita de todos los clientes
        # 🔧 CRÍTICO: Esta función ahora retorna datetime, NO string
        ultimas_visitas = await get_ultima_visita_clientes(clientes_ids, sede_id)
        
        # ✅ PASO 3: Filtrar clientes que superaron el límite de churn
        clientes_candidatos_churn = []
        
        for cliente_id, ultima_visita in ultimas_visitas.items():
            # 🔧 FIX: Ahora ultima_visita es datetime, NO string
            # Por lo tanto, esta suma funciona correctamente
            fecha_limite = ultima_visita + timedelta(days=CHURN_DAYS)
            
            if fecha_limite >= hoy:
                continue
            
            clientes_candidatos_churn.append(cliente_id)
        
        if not clientes_candidatos_churn:
            return {
                "total_churn": 0,
                "clientes": [],
                "parametros": {
                    "sede_id": sede_id,
                    "rango_fechas": f"{start_date} a {end_date}" if start_date and end_date else "Todos los registros",
                    "dias_churn": CHURN_DAYS
                },
                "mensaje": "No hay clientes en churn"
            }
        
        logger.info(f"⚠️ {len(clientes_candidatos_churn)} clientes candidatos a churn")
        
        # ✅ PASO 4: Verificar si tienen visitas futuras
        tienen_visitas_futuras = {}
        for cliente_id in clientes_candidatos_churn:
            ultima = ultimas_visitas[cliente_id]  # Ahora es datetime
            
            # 🔧 Convertir datetime a string para la query
            ultima_str = datetime_to_date_string(ultima)
            
            match_query = {
                "cliente_id": cliente_id,
                "fecha": {"$gt": ultima_str},
                "estado": {"$ne": "cancelada"}
            }
            if sede_id:
                match_query["sede_id"] = sede_id
            
            visita_futura = await collection_citas.find_one(match_query)
            tienen_visitas_futuras[cliente_id] = visita_futura is not None
        
        clientes_en_churn = [
            cid for cid in clientes_candidatos_churn 
            if not tienen_visitas_futuras.get(cid, False)
        ]
        
        if not clientes_en_churn:
            return {
                "total_churn": 0,
                "clientes": [],
                "parametros": {
                    "sede_id": sede_id,
                    "rango_fechas": f"{start_date} a {end_date}" if start_date and end_date else "Todos los registros",
                    "dias_churn": CHURN_DAYS
                },
                "mensaje": "Todos los clientes tienen visitas futuras programadas"
            }
        
        logger.info(f"🔴 {len(clientes_en_churn)} clientes en churn real")
        
        # ✅ PASO 5: Obtener datos de clientes en batch
        clientes_data_map = await get_datos_clientes_batch(clientes_en_churn)
        
        # ✅ PASO 6: Construir resultado
        clientes_perdidos = []
        
        for cliente_id in clientes_en_churn:
            cliente_data = clientes_data_map.get(cliente_id)
            
            if not cliente_data:
                logger.warning(f"⚠️ Cliente {cliente_id} no encontrado en BD de clientes")
                clientes_perdidos.append({
                    "cliente_id": cliente_id,
                    "nombre": "Desconocido",
                    "correo": "N/A",
                    "telefono": "N/A",
                    "sede_id": sede_id or "N/A",
                    "ultima_visita": ultimas_visitas[cliente_id].strftime("%Y-%m-%d"),
                    "dias_inactivo": (hoy - ultimas_visitas[cliente_id]).days,
                    "nota": "Cliente no encontrado en base de datos"
                })
                continue
            
            ultima_visita = ultimas_visitas[cliente_id]  # datetime
            dias_inactivo = (hoy - ultima_visita).days
            
            clientes_perdidos.append({
                "cliente_id": cliente_id,
                "nombre": cliente_data.get("nombre", "N/A"),
                "correo": cliente_data.get("correo", "N/A"),
                "telefono": cliente_data.get("telefono", "N/A"),
                "sede_id": cliente_data.get("sede_id", "N/A"),
                "ultima_visita": ultima_visita.strftime("%Y-%m-%d"),
                "dias_inactivo": dias_inactivo
            })
        
        clientes_perdidos.sort(key=lambda x: x["dias_inactivo"], reverse=True)
        
        logger.info(f"✅ Análisis de churn completado: {len(clientes_perdidos)} clientes en riesgo")
        
        # ✅ PASO 7: Exportar a Excel si se solicita
        if export:
            if not clientes_perdidos:
                df = pd.DataFrame(columns=[
                    "cliente_id", "nombre", "correo", "telefono",
                    "sede_id", "ultima_visita", "dias_inactivo"
                ])
            else:
                df = pd.DataFrame(clientes_perdidos)
            
            output = BytesIO()
            with pd.ExcelWriter(output, engine='openpyxl') as writer:
                df.to_excel(writer, index=False, sheet_name='Clientes en Churn')
            
            output.seek(0)
            
            return Response(
                content=output.read(),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": "attachment; filename=clientes_churn.xlsx"}
            )
        
        # ✅ Devolver JSON
        return {
            "total_churn": len(clientes_perdidos),
            "parametros": {
                "sede_id": sede_id,
                "rango_fechas": f"{start_date} a {end_date}" if start_date and end_date else "Todos los registros",
                "dias_churn": CHURN_DAYS
            },
            "clientes": clientes_perdidos
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error en obtener_churn_clientes: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error al obtener clientes en churn: {str(e)}"
        )
    