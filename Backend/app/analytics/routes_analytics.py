"""
Routes principales para Analytics
🔧 VERSIÓN MEJORADA: Con validaciones de período mínimo
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime
from typing import Optional
import logging

from app.analytics.services_analytics import get_kpi_overview
from app.auth.routes import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["Analytics"])

# ========= CONFIGURACIÓN =========
MIN_PERIOD_DAYS = 7
RECOMMENDED_PERIOD_DAYS = 30
MAX_PERIOD_DAYS = 365


@router.get("/overview")
async def analytics_overview(
    start_date: str = Query(..., description="Fecha inicio (formato: YYYY-MM-DD)"),
    end_date: str = Query(..., description="Fecha fin (formato: YYYY-MM-DD)"),
    sede_id: Optional[str] = Query(None, description="Filtrar por sede específica"),
    allow_short_period: bool = Query(False, description="Permitir períodos menores a 7 días (no recomendado)"),
    current_user: dict = Depends(get_current_user)
):
    """
    Obtiene KPIs generales para un rango de fechas personalizado.
    
    🔧 MEJORADO: Ahora valida períodos mínimos
    
    Requiere autenticación y uno de los siguientes roles:
    - admin_sede: Puede ver KPIs de su sede
    - super_admin: Puede ver KPIs de todo el sistema
    
    Parámetros:
    - start_date: Fecha de inicio en formato YYYY-MM-DD (ej: 2024-03-01)
    - end_date: Fecha de fin en formato YYYY-MM-DD (ej: 2024-03-07)
    - sede_id: Opcional. ID de la sede para filtrar resultados
    - allow_short_period: Si True, permite análisis de 1-6 días (no recomendado)
    
    ⚠️ ADVERTENCIAS:
    - Períodos menores a 7 días: Alta variabilidad, KPIs poco confiables
    - Períodos de 1 día: Comparaciones sin sentido (100% de crecimiento)
    - Recomendado: Mínimo 30 días para análisis estables
    
    Respuesta incluye:
    - nuevos_clientes: Cantidad de clientes registrados en el período
    - tasa_recurrencia: % de clientes que ya existían antes
    - tasa_churn: % de clientes que abandonaron (>60 días sin visitar)
    - ticket_promedio: Valor promedio por cita
    - advertencias: Alertas sobre calidad de datos (si aplica)
    
    Cada KPI incluye su valor actual y % de crecimiento vs período anterior.
    """
    try:
        # ========= VALIDACIÓN DE PERMISOS =========
        allowed_roles = ["admin_sede", "admin_franquicia", "super_admin"]
        
        if current_user.get("rol") not in allowed_roles:
            logger.warning(
                f"Usuario {current_user.get('username', 'unknown')} "
                f"con rol {current_user.get('rol')} intentó acceder a analytics"
            )
            raise HTTPException(
                status_code=403,
                detail="No autorizado. Se requiere rol de administrador."
            )
        
        # ========= VALIDACIÓN DE FECHAS =========
        try:
            start = datetime.fromisoformat(start_date)
            end = datetime.fromisoformat(end_date)
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Formato de fecha inválido. Use YYYY-MM-DD. Error: {str(e)}"
            )
        
        if start > end:
            raise HTTPException(
                status_code=400,
                detail="La fecha de inicio debe ser anterior o igual a la fecha de fin"
            )
        
        # ========= VALIDACIÓN DE PERÍODO MÍNIMO =========
        dias_diferencia = (end - start).days + 1
        advertencias = []
        
        # 🔴 CRÍTICO: Período muy corto
        if dias_diferencia < MIN_PERIOD_DAYS:
            mensaje = (
                f"⚠️ ADVERTENCIA: Período muy corto ({dias_diferencia} día{'s' if dias_diferencia > 1 else ''}).\n\n"
                f"Los KPIs de períodos cortos tienen alta variabilidad y no son representativos.\n"
                f"Problemas comunes:\n"
                f"- Crecimientos de +100% o -100% sin significado real\n"
                f"- Tasas de recurrencia/churn distorsionadas\n"
                f"- Comparaciones período actual vs anterior sin sentido\n\n"
                f"Se requieren MÍNIMO {MIN_PERIOD_DAYS} días para KPIs confiables.\n"
                f"Recomendado: {RECOMMENDED_PERIOD_DAYS}+ días para análisis estables."
            )
            
            if not allow_short_period:
                logger.warning(f"Período rechazado: {dias_diferencia} días < {MIN_PERIOD_DAYS}")
                raise HTTPException(
                    status_code=400,
                    detail=mensaje + "\n\nPara forzar el análisis (no recomendado), use allow_short_period=true"
                )
            else:
                logger.warning(f"⚠️ Análisis forzado de período corto: {dias_diferencia} días")
                advertencias.append({
                    "tipo": "PERÍODO_MUY_CORTO",
                    "severidad": "ALTA",
                    "mensaje": "Los datos de este período NO son confiables",
                    "detalle": mensaje
                })
        
        # 🟡 ADVERTENCIA: Período sub-óptimo
        elif dias_diferencia < RECOMMENDED_PERIOD_DAYS:
            advertencias.append({
                "tipo": "PERÍODO_SUBÓPTIMO",
                "severidad": "MEDIA",
                "mensaje": f"Período de {dias_diferencia} días es válido pero sub-óptimo",
                "recomendacion": f"Para análisis más estables, use {RECOMMENDED_PERIOD_DAYS}+ días"
            })
        
        # ⚠️ ADVERTENCIA: Período muy largo
        if dias_diferencia > MAX_PERIOD_DAYS:
            logger.warning(
                f"Usuario {current_user.get('username')} solicitó rango de {dias_diferencia} días"
            )
            advertencias.append({
                "tipo": "PERÍODO_MUY_LARGO",
                "severidad": "BAJA",
                "mensaje": f"Período muy largo ({dias_diferencia} días = {dias_diferencia/365:.1f} años)",
                "recomendacion": "Considere dividir en períodos trimestrales"
            })
        
        # ========= VALIDACIÓN DE SEDE (para admin_sede) =========
        if current_user.get("rol") == "admin_sede":
            user_sede_id = current_user.get("sede_id")
            
            if sede_id and sede_id != user_sede_id:
                raise HTTPException(
                    status_code=403,
                    detail="No tiene permisos para ver KPIs de otra sede"
                )
            
            sede_id = user_sede_id
        
        # ========= LOGGING =========
        logger.info(
            f"📊 Analytics overview - User: {current_user.get('username')}, "
            f"Role: {current_user.get('rol')}, "
            f"Sede: {sede_id or 'TODAS'}, "
            f"Range: {start_date} to {end_date} ({dias_diferencia} días)"
        )
        
        # ========= OBTENER KPIs =========
        kpis = await get_kpi_overview(start, end, sede_id)
        
        # ========= VALIDAR DATOS SUFICIENTES =========
        debug_info = kpis.get("debug_info", {})
        total_citas = debug_info.get("total_citas", 0)
        total_clientes = debug_info.get("total_clientes", 0)
        
        if total_citas < 10:
            advertencias.append({
                "tipo": "DATOS_INSUFICIENTES_CITAS",
                "severidad": "ALTA",
                "mensaje": f"Solo {total_citas} citas en el período",
                "recomendacion": "Se requieren al menos 10 citas para KPIs confiables"
            })
        
        if total_clientes < 5:
            advertencias.append({
                "tipo": "DATOS_INSUFICIENTES_CLIENTES",
                "severidad": "ALTA",
                "mensaje": f"Solo {total_clientes} clientes únicos",
                "recomendacion": "Se requieren al menos 5 clientes para análisis válido"
            })
        
        citas_por_dia = total_citas / max(1, dias_diferencia)
        if citas_por_dia < 1.0 and dias_diferencia >= MIN_PERIOD_DAYS:
            advertencias.append({
                "tipo": "BAJA_DENSIDAD_DATOS",
                "severidad": "MEDIA",
                "mensaje": f"Solo {citas_por_dia:.1f} citas por día en promedio",
                "recomendacion": "Considere ampliar el período o verificar operación"
            })
        
        # ========= CONSTRUIR RESPUESTA =========
        response = {
            "success": True,
            "usuario": {
                "username": current_user.get("username"),
                "rol": current_user.get("rol")
            },
            "periodo": {
                "inicio": start_date,
                "fin": end_date,
                "dias": dias_diferencia
            },
            "sede_id": sede_id,
            "kpis": kpis
        }
        
        # Agregar advertencias si existen
        if advertencias:
            response["advertencias"] = advertencias
            response["calidad_datos"] = "BAJA" if any(
                a["severidad"] == "ALTA" for a in advertencias
            ) else "MEDIA" if any(
                a["severidad"] == "MEDIA" for a in advertencias
            ) else "BUENA"
        else:
            response["calidad_datos"] = "BUENA"
        
        return response
    
    except HTTPException:
        raise
    
    except Exception as e:
        logger.error(
            f"❌ Error inesperado en analytics_overview: {str(e)}",
            exc_info=True
        )
        raise HTTPException(
            status_code=500,
            detail=f"Error interno al obtener KPIs. Por favor contacte al administrador."
        )
    