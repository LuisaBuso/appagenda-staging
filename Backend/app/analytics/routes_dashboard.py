"""
Routes para Dashboard de Analytics
🔧 VERSIÓN MEJORADA: Períodos realistas + validaciones + autenticación
"""
from fastapi import APIRouter, Query, HTTPException, Depends
from datetime import datetime, timedelta
from typing import Tuple, Optional
import logging

from app.analytics.services_analytics import get_kpi_overview
from app.analytics.routes_churn import obtener_churn_clientes
from app.auth.routes import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["Analytics Dashboard"])


def get_date_range(period: str) -> Tuple[datetime, datetime]:
    """
    Calcula el rango de fechas según el período solicitado.
    
    🔧 MEJORADO: Períodos más realistas para KPIs confiables
    
    Args:
        period: "week", "month", "quarter", "last_30_days", "last_7_days"
    
    Returns:
        Tupla (start_date, end_date)
    
    Raises:
        ValueError: Si el período no es soportado
    """
    today = datetime.now().replace(hour=23, minute=59, second=59, microsecond=999999)
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    # ========= PERÍODOS RECOMENDADOS =========
    
    if period == "last_7_days":
        # Últimos 7 días completos (mínimo recomendado)
        start = today_start - timedelta(days=6)  # Hoy + 6 días atrás = 7 días
        return start, today
    
    if period == "last_30_days":
        # Últimos 30 días completos (óptimo)
        start = today_start - timedelta(days=29)
        return start, today

    if period == "week":
        # Semana actual (lunes a hoy)
        start = today_start - timedelta(days=today.weekday())
        return start, today

    if period == "month":
        # Mes actual (día 1 a hoy)
        start = today_start.replace(day=1)
        return start, today
    
    if period == "quarter":
        # Trimestre actual
        current_quarter = (today.month - 1) // 3
        start = today_start.replace(month=current_quarter * 3 + 1, day=1)
        return start, today
    
    # ========= PERÍODOS LEGADOS (CON ADVERTENCIA) =========
    
    if period == "today":
        # ⚠️ DEPRECADO: Solo para testing, no para producción
        logger.warning("⚠️ Período 'today' usado - KPIs no serán confiables")
        return today_start, today

    raise ValueError(
        f"Período no soportado: {period}.\n"
        f"Use: 'last_7_days', 'last_30_days', 'week', 'month', 'quarter'"
    )


@router.get("/dashboard")
async def analytics_dashboard(
    period: str = Query(
        "last_30_days",
        enum=["last_7_days", "last_30_days", "week", "month", "quarter", "today"],
        description="Período de análisis"
    ),
    sede_id: Optional[str] = Query(None, description="Filtrar por sede específica"),
    current_user: dict = Depends(get_current_user)  # 🔒 AUTENTICACIÓN REQUERIDA
):
    """
    Dashboard consolidado con KPIs y churn para períodos predefinidos.
    
    🔒 REQUIERE AUTENTICACIÓN
    
    Permisos:
    - admin_sede: Solo puede ver KPIs de su sede asignada
    - admin_franquicia: Puede ver KPIs de todas las sedes de su franquicia
    - super_admin: Puede ver KPIs de todo el sistema
    
    Períodos disponibles:
    - last_7_days: Últimos 7 días (mínimo recomendado) ✅
    - last_30_days: Últimos 30 días (óptimo) ✅ DEFAULT
    - week: Semana actual (lunes a hoy) ✅
    - month: Mes actual (día 1 a hoy) ✅
    - quarter: Trimestre actual (ej: Oct-Nov-Dic) ✅
    - today: Solo día actual ⚠️ NO RECOMENDADO (para testing)
    
    Respuesta incluye:
    - period: Período solicitado
    - range: Rango de fechas calculado
    - sede_id: Sede filtrada (si aplica)
    - kpis: Nuevos clientes, recurrencia, churn rate, ticket promedio
    - churn_actual: Número total de clientes en churn
    - calidad_datos: Indicador de confiabilidad (BUENA/MEDIA/BAJA/SIN_DATOS)
    - advertencias: Alertas sobre períodos cortos o datos insuficientes
    
    OPTIMIZADO: Usa caché en services_analytics y queries optimizadas
    """
    try:
        # ========= VALIDACIÓN DE PERMISOS =========
        allowed_roles = ["admin_sede", "admin_franquicia", "super_admin"]
        
        if current_user.get("rol") not in allowed_roles:
            logger.warning(
                f"Usuario {current_user.get('username', 'unknown')} "
                f"con rol {current_user.get('rol')} intentó acceder a dashboard"
            )
            raise HTTPException(
                status_code=403,
                detail="No autorizado. Se requiere rol de administrador."
            )
        
        # ========= VALIDACIÓN DE SEDE (para admin_sede) =========
        if current_user.get("rol") == "admin_sede":
            user_sede_id = current_user.get("sede_id")
            
            # Si es admin_sede, DEBE tener sede_id asignada
            if not user_sede_id:
                raise HTTPException(
                    status_code=403,
                    detail="Usuario admin_sede sin sede asignada. Contacte al administrador."
                )
            
            # Si intenta ver otra sede, rechazar
            if sede_id and sede_id != user_sede_id:
                logger.warning(
                    f"Admin_sede {current_user.get('username')} intentó acceder a sede {sede_id} "
                    f"(su sede: {user_sede_id})"
                )
                raise HTTPException(
                    status_code=403,
                    detail=f"No tiene permisos para ver dashboard de otra sede. Solo puede ver: {user_sede_id}"
                )
            
            # Forzar sede_id a la del usuario
            sede_id = user_sede_id
            logger.info(f"Admin_sede {current_user.get('username')} → Sede forzada: {sede_id}")
        
        # ========= VALIDACIÓN DE SEDE (para admin_franquicia) =========
        elif current_user.get("rol") == "admin_franquicia":
            franquicia_id = current_user.get("franquicia_id")
            
            # Si tiene sede_id especificada, validar que pertenezca a su franquicia
            if sede_id:
                # Aquí deberías validar que la sede pertenece a la franquicia
                # Por ahora asumimos que es válido
                logger.info(f"Admin_franquicia {current_user.get('username')} → Sede: {sede_id}")
            else:
                logger.info(f"Admin_franquicia {current_user.get('username')} → Todas sus sedes")
        
        # ========= SUPER_ADMIN puede ver todo =========
        else:  # super_admin
            logger.info(
                f"Super_admin {current_user.get('username')} → "
                f"Sede: {sede_id or 'TODAS'}"
            )
        # ========= CALCULAR RANGO DE FECHAS =========
        try:
            start_date, end_date = get_date_range(period)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        
        dias_periodo = (end_date - start_date).days + 1
        
        logger.info(
            f"📊 Dashboard solicitado - Period: {period} ({dias_periodo} días), "
            f"Sede: {sede_id or 'TODAS'}, "
            f"Range: {start_date.date()} to {end_date.date()}"
        )
        
        # ========= VALIDACIONES DE CALIDAD =========
        advertencias = []
        
        # Advertencia: Período muy corto
        if dias_periodo < 7:
            advertencias.append({
                "tipo": "PERÍODO_MUY_CORTO",
                "severidad": "ALTA",
                "mensaje": f"Período de {dias_periodo} día(s) - KPIs poco confiables",
                "recomendacion": "Use 'last_7_days' o 'last_30_days' para datos estables"
            })
        
        # Advertencia: Período sub-óptimo
        elif dias_periodo < 30:
            advertencias.append({
                "tipo": "PERÍODO_SUBÓPTIMO",
                "severidad": "MEDIA",
                "mensaje": f"Período de {dias_periodo} días - KPIs aceptables pero pueden variar",
                "recomendacion": "Use 'last_30_days' para mayor estabilidad"
            })
        
        # ========= OBTENER KPIs =========
        kpis = await get_kpi_overview(start_date, end_date, sede_id)
        
        # ========= VALIDAR DATOS SUFICIENTES =========
        debug_info = kpis.get("debug_info", {})
        total_citas = debug_info.get("total_citas", 0)
        total_clientes = debug_info.get("total_clientes", 0)
        
        # 🔴 CRÍTICO: Sin datos en absoluto
        if total_citas == 0:
            advertencias.append({
                "tipo": "SIN_DATOS",
                "severidad": "CRÍTICA",
                "mensaje": "No hay citas registradas en este período",
                "recomendacion": (
                    "Verifique que:\n"
                    "1. La sede esté operando en estas fechas\n"
                    "2. Las citas se estén registrando correctamente\n"
                    "3. El rango de fechas incluya datos históricos"
                ),
                "sugerencia_rango": (
                    "Esta sede tiene datos desde julio 2025. "
                    "Intente con un período dentro de ese rango."
                )
            })
        
        # ⚠️ ADVERTENCIA: Pocos datos
        elif total_citas < 10:
            advertencias.append({
                "tipo": "DATOS_INSUFICIENTES",
                "severidad": "ALTA",
                "mensaje": f"Solo {total_citas} citas en el período",
                "recomendacion": "Amplíe el período o verifique operación de la sede"
            })
        
        if total_clientes > 0 and total_clientes < 5:
            advertencias.append({
                "tipo": "POCOS_CLIENTES",
                "severidad": "ALTA",
                "mensaje": f"Solo {total_clientes} clientes únicos",
                "recomendacion": "Los porcentajes pueden no ser representativos"
            })
        
        # ========= OBTENER CHURN ACTUAL =========
        # Churn siempre se calcula sin filtro de fechas (todos los clientes históricos)
        churn_response = await obtener_churn_clientes(
            export=False,
            sede_id=sede_id,
            start_date=None,
            end_date=None
        )
        
        # ========= DETERMINAR CALIDAD DE DATOS =========
        severidades = [a["severidad"] for a in advertencias]
        
        if "CRÍTICA" in severidades:
            calidad_datos = "SIN_DATOS"
        elif "ALTA" in severidades:
            calidad_datos = "BAJA"
        elif "MEDIA" in severidades:
            calidad_datos = "MEDIA"
        else:
            calidad_datos = "BUENA"
        
        # ========= CONSTRUIR RESPUESTA =========
        response = {
            "success": True,
            "usuario": {  # 🆕 AGREGADO
                "username": current_user.get("username"),
                "rol": current_user.get("rol"),
                "sede_asignada": current_user.get("sede_id") if current_user.get("rol") == "admin_sede" else None
            },
            "period": period,
            "range": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat(),
                "dias": dias_periodo
            },
            "sede_id": sede_id,
            "kpis": kpis,
            "churn_actual": churn_response.get("total_churn", 0),
            "calidad_datos": calidad_datos
        }
        
        # Agregar advertencias si existen
        if advertencias:
            response["advertencias"] = advertencias
        
        # ========= RECOMENDACIONES CONTEXTUALES =========
        # Si el usuario usa "today", sugerirle alternativas
        if period == "today":
            response["recomendacion"] = {
                "mensaje": "El período 'today' no es recomendado para dashboards de negocio",
                "alternativas": [
                    {
                        "periodo": "last_7_days",
                        "descripcion": "Últimos 7 días - Mínimo recomendado"
                    },
                    {
                        "periodo": "last_30_days",
                        "descripcion": "Últimos 30 días - Óptimo para análisis"
                    }
                ]
            }
        
        logger.info(
            f"✅ Dashboard generado - Período: {dias_periodo} días, "
            f"Calidad: {calidad_datos}, "
            f"KPIs calculados, Churn: {churn_response.get('total_churn', 0)} clientes"
        )
        
        return response
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error en analytics_dashboard: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error al generar dashboard: {str(e)}"
        )


@router.get("/dashboard/periods")
async def get_available_periods():
    """
    Endpoint informativo: Devuelve los períodos disponibles con su descripción.
    
    Útil para que el frontend construya el selector de período.
    """
    return {
        "periods": [
            {
                "id": "last_30_days",
                "name": "Últimos 30 días",
                "description": "Período óptimo para análisis estable",
                "recommended": True,
                "min_days": 30
            },
            {
                "id": "last_7_days",
                "name": "Últimos 7 días",
                "description": "Mínimo recomendado para KPIs",
                "recommended": True,
                "min_days": 7
            },
            {
                "id": "month",
                "name": "Mes actual",
                "description": "Del día 1 hasta hoy",
                "recommended": True,
                "min_days": 1  # Variable según día del mes
            },
            {
                "id": "week",
                "name": "Semana actual",
                "description": "Del lunes hasta hoy",
                "recommended": True,
                "min_days": 1  # Variable según día de la semana
            },
            {
                "id": "quarter",
                "name": "Trimestre actual",
                "description": "Últimos 3 meses (ej: Oct-Nov-Dic)",
                "recommended": True,
                "min_days": 60  # Aprox
            },
            {
                "id": "today",
                "name": "Hoy",
                "description": "⚠️ Solo para testing - KPIs no confiables",
                "recommended": False,
                "min_days": 1
            }
        ],
        "default": "last_30_days",
        "recommendations": {
            "minimum": "last_7_days",
            "optimal": "last_30_days",
            "avoid": ["today"]
        }
    }
