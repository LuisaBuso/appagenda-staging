# ============================================================
# scheduler.py - Scheduler para cierre automático de caja
# Ubicación: app/cash/scheduler.py
# ============================================================

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
import pytz
import logging

from app.database.mongo import collection_locales as locales, db
from .accounting_logic import calcular_resumen_dia

logger = logging.getLogger(__name__)

cash_closures = db["cash_closures"]

# ============================================================
# INSTANCIA DEL SCHEDULER
# ============================================================

scheduler = AsyncIOScheduler()

# ============================================================
# FUNCIÓN DE CIERRE AUTOMÁTICO
# ============================================================

async def ejecutar_cierre_automatico_sede(sede_id: str, sede_nombre: str):
    """
    Ejecuta el cierre automático para una sede específica.
    
    CRITERIO:
    - Se ejecuta a las 23:59 hora local de la sede
    - Solo si NO existe ya un cierre para ese día
    - Registra el cierre con efectivo_contado = efectivo_esperado (estimado)
    
    Args:
        sede_id: ID de la sede
        sede_nombre: Nombre de la sede (para logs)
    """
    
    try:
        # Obtener fecha actual en zona horaria de la sede
        sede = await locales.find_one({"sede_id": sede_id})
        if not sede:
            logger.error(f"Sede {sede_id} no encontrada para cierre automático")
            return
        
        zona_horaria = sede.get("zona_horaria", "UTC")
        tz = pytz.timezone(zona_horaria)
        ahora = datetime.now(tz)
        fecha = ahora.strftime("%Y-%m-%d")
        
        # Verificar si ya existe un cierre para hoy
        cierre_existente = await cash_closures.find_one({
            "sede_id": sede_id,
            "fecha": fecha,
            "tipo": "cierre"
        })
        
        if cierre_existente:
            logger.info(f"Cierre automático OMITIDO: Ya existe cierre para {sede_nombre} ({sede_id}) el {fecha}")
            return
        
        # Calcular resumen del día
        resumen = await calcular_resumen_dia(sede_id, fecha)
        
        # Crear documento de cierre automático
        cierre_doc = {
            "cierre_id": f"CC-AUTO-{fecha}-{sede_id}-{int(ahora.timestamp())}",
            "tipo": "cierre",
            "sede_id": sede_id,
            "sede_nombre": sede_nombre,
            "fecha": fecha,
            "moneda": resumen["moneda"],
            
            # Efectivo
            "efectivo_inicial": resumen["efectivo_inicial"],
            "total_ingresos": resumen["total_vendido"],
            "total_ingresos_efectivo": resumen["ingresos_efectivo"]["total"],
            "total_egresos": resumen["egresos"]["total"],
            "efectivo_esperado": resumen["efectivo_esperado"],
            "efectivo_contado": resumen["efectivo_esperado"],  # Estimado automático
            "diferencia": 0,  # Asumimos que es correcto
            
            # Desglose
            "ingresos_detalle": resumen["ingresos_efectivo"],
            "egresos_detalle": resumen["egresos"],
            
            # Estado
            "estado": "cerrado_automatico",
            "diferencia_aceptable": True,
            "mensaje_validacion": "Cierre automático - efectivo estimado",
            
            # Observaciones
            "observaciones": f"Cierre automático ejecutado a las {ahora.strftime('%H:%M:%S')} ({zona_horaria})",
            
            # Auditoría
            "cerrado_por": "sistema_automatico",
            "cerrado_por_nombre": "Sistema Automático",
            "cerrado_por_rol": "sistema",
            "creado_en": ahora,
            "aprobado_por": None,
            "aprobado_en": None,
            
            # Metadata adicional
            "es_automatico": True,
            "requiere_revision": True  # El admin debe revisar después
        }
        
        # Insertar cierre
        resultado = await cash_closures.insert_one(cierre_doc)
        
        if resultado.inserted_id:
            logger.info(f"✅ Cierre automático EXITOSO: {sede_nombre} ({sede_id}) el {fecha} - Efectivo: {resumen['efectivo_esperado']}")
        else:
            logger.error(f"❌ Cierre automático FALLIDO: {sede_nombre} ({sede_id}) el {fecha}")
            
    except Exception as e:
        logger.error(f"❌ ERROR en cierre automático de {sede_nombre} ({sede_id}): {str(e)}", exc_info=True)

# ============================================================
# REGISTRAR TAREAS PARA TODAS LAS SEDES
# ============================================================

async def registrar_cierres_automaticos():
    """
    Registra tareas de cierre automático para todas las sedes activas.
    
    Se ejecuta al iniciar la aplicación.
    Crea un job para cada sede a las 23:59 de su zona horaria.
    """
    
    try:
        # Obtener todas las sedes activas
        sedes = await locales.find({"activa": True}).to_list(None)
        
        logger.info(f"📋 Registrando cierres automáticos para {len(sedes)} sedes...")
        
        for sede in sedes:
            sede_id = sede.get("sede_id")
            sede_nombre = sede.get("nombre")
            zona_horaria = sede.get("zona_horaria", "UTC")
            
            try:
                # Crear timezone
                tz = pytz.timezone(zona_horaria)
                
                # Registrar job para las 23:59 en la zona horaria de la sede
                scheduler.add_job(
                    ejecutar_cierre_automatico_sede,
                    trigger=CronTrigger(hour=23, minute=59, timezone=tz),
                    args=[sede_id, sede_nombre],
                    id=f"cierre_auto_{sede_id}",
                    name=f"Cierre automático {sede_nombre}",
                    replace_existing=True
                )
                
                logger.info(f"✅ Job registrado: {sede_nombre} ({sede_id}) a las 23:59 {zona_horaria}")
                
            except Exception as e:
                logger.error(f"❌ Error registrando job para {sede_nombre} ({sede_id}): {str(e)}")
                continue
        
        logger.info(f"✅ Cierres automáticos configurados para {len(sedes)} sedes")
        
    except Exception as e:
        logger.error(f"❌ Error registrando cierres automáticos: {str(e)}", exc_info=True)

# ============================================================
# INICIAR Y DETENER SCHEDULER
# ============================================================

async def iniciar_scheduler():
    """
    Inicia el scheduler y registra las tareas de cierre automático.
    Llamar desde main.py al iniciar la app.
    """
    try:
        if not scheduler.running:
            # Registrar tareas
            await registrar_cierres_automaticos()
            
            # Iniciar scheduler
            scheduler.start()
            logger.info("✅ Scheduler de cierres automáticos INICIADO")
        else:
            logger.warning("⚠️ Scheduler ya estaba iniciado")
            
    except Exception as e:
        logger.error(f"❌ Error iniciando scheduler: {str(e)}", exc_info=True)

def detener_scheduler():
    """
    Detiene el scheduler.
    Llamar al cerrar la aplicación.
    """
    try:
        if scheduler.running:
            scheduler.shutdown()
            logger.info("✅ Scheduler de cierres automáticos DETENIDO")
    except Exception as e:
        logger.error(f"❌ Error deteniendo scheduler: {str(e)}", exc_info=True)

# ============================================================
# FUNCIÓN PARA EJECUTAR MANUALMENTE (DEBUGGING)
# ============================================================

async def ejecutar_cierre_manual_todas_sedes():
    """
    Ejecuta el cierre automático para TODAS las sedes AHORA.
    Útil para testing o ejecución manual.
    """
    sedes = await locales.find({"activa": True}).to_list(None)
    
    for sede in sedes:
        sede_id = sede.get("sede_id")
        sede_nombre = sede.get("nombre")
        await ejecutar_cierre_automatico_sede(sede_id, sede_nombre)

# ============================================================
# INTEGRACIÓN CON MAIN.PY
# ============================================================

"""
# En app/main.py:

from fastapi import FastAPI
from contextlib import asynccontextmanager
from app.cash.scheduler import iniciar_scheduler, detener_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await iniciar_scheduler()
    yield
    # Shutdown
    detener_scheduler()

app = FastAPI(lifespan=lifespan)
"""
