"""
Routes para Dashboard de Ventas (Financiero)
💰 MÉTRICAS REALES: Basadas únicamente en ventas pagadas
💱 MULTI-MONEDA: Soporte dinámico para COP, USD, MXN
"""
from fastapi import APIRouter, Query, HTTPException, Depends
from datetime import datetime, timedelta
from typing import Optional, Dict, List
import logging

from app.database.mongo import collection_sales 
from app.auth.routes import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ventas", tags=["Dashboard de Ventas"])


from zoneinfo import ZoneInfo

def get_date_range(
    period: str,
    start_date_custom: Optional[str] = None,
    end_date_custom: Optional[str] = None,
    zona_horaria: str = "America/Bogota"  # 👈 NUEVO
) -> tuple[datetime, datetime]:
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(zona_horaria)
    now = datetime.now(tz)  # 👈 USA TZ DE LA SEDE, NO UTC

    today_start = now.replace(hour=0,  minute=0,  second=0,  microsecond=0)
    today       = now.replace(hour=23, minute=59, second=59, microsecond=999999)

    if period == "custom":
        if not start_date_custom or not end_date_custom:
            raise ValueError(
                "Para período 'custom' debe proporcionar 'start_date' y 'end_date' "
                "en formato DD-MM-YYYY"
            )
        try:
            start = datetime.strptime(start_date_custom, "%d-%m-%Y").replace(
                hour=0, minute=0, second=0, microsecond=0, tzinfo=tz  # 👈 AGREGA tzinfo=tz
            )
            end = datetime.strptime(end_date_custom, "%d-%m-%Y").replace(
                hour=23, minute=59, second=59, microsecond=999999, tzinfo=tz  # 👈 AGREGA tzinfo=tz
            )

            if start > end:
                raise ValueError("La fecha de inicio no puede ser posterior a la fecha de fin")

            dias = (end - start).days + 1
            if dias > 365:
                raise ValueError("El rango personalizado no puede superar 365 días")

            return start, end

        except ValueError as e:
            if "does not match format" in str(e):
                raise ValueError("Formato de fecha inválido. Use DD-MM-YYYY (ej: 01-12-2024)")
            raise

    if period == "today":
        return today_start, today

    if period == "last_7_days":
        return today_start - timedelta(days=6), today

    if period == "last_30_days":
        return today_start - timedelta(days=29), today

    if period == "month":
        return today_start.replace(day=1), today

    raise ValueError(
        f"Período no soportado: {period}. "
        f"Use: 'today', 'last_7_days', 'last_30_days', 'month', 'custom'"
    )


async def get_ventas_periodo(
    start_date: datetime,
    end_date: datetime,
    sede_id: Optional[str] = None
) -> List[Dict]:
    try:
        # Ampliar rango para cubrir documentos guardados sin timezone (naive UTC)
        # El peor caso es UTC+14, así que restamos 14h al inicio
        # y sumamos 14h al fin para no perder ningún documento
        from datetime import timezone, timedelta
        buffer = timedelta(hours=14)
        start_utc = (start_date.astimezone(timezone.utc) - buffer).replace(tzinfo=None)
        end_utc = (end_date.astimezone(timezone.utc) + buffer).replace(tzinfo=None)

        query = {
            "fecha_pago": {
                "$gte": start_utc,
                "$lte": end_utc
            }
        }
        if sede_id:
            query["sede_id"] = sede_id

        ventas = await collection_sales.find(query).to_list(None)
        logger.info(f"💰 Ventas encontradas: {len(ventas)} (sede: {sede_id or 'TODAS'})")
        return ventas

    except Exception as e:
        logger.error(f"❌ Error en get_ventas_periodo: {e}", exc_info=True)
        return []


def calcular_metricas_financieras(ventas: List[Dict]) -> Dict:
    """
    Calcula métricas financieras correctas por moneda.
    
    💱 MULTI-MONEDA: 
    - Detecta automáticamente COP, USD, MXN
    - Solo muestra monedas con datos
    
    🎯 FUENTES:
    - ventas → Total vendido, servicios vs productos, métodos de pago
    
    Métricas:
    - ventas_totales: Sum de desglose_pagos.total
    - cantidad_ventas: Count de ventas
    - ticket_promedio: ventas_totales / cantidad_ventas
    - ventas_servicios: Sum de items tipo "servicio"
    - ventas_productos: Sum de items tipo "producto"
    - metodos_pago: Por método desde desglose_pagos
    """
    metricas_por_moneda = {}
    #organizar abonos seria tomar historial_pagos.tipo = abono_inicial 
    
    # ========= PROCESAR VENTAS =========
    for venta in ventas:
        moneda = venta.get("moneda", "COP")
        
        # Inicializar moneda si no existe
        if moneda not in metricas_por_moneda:
            metricas_por_moneda[moneda] = {
                "ventas_totales": 0,
                "cantidad_ventas": 0,
                "ventas_servicios": 0,
                "ventas_productos": 0,
                "abonos": 0,
                "metodos_pago": {
                    "efectivo": 0,
                    "transferencia": 0,
                    "tarjeta": 0,
                    "sin_pago": 0,
                    "otros": 0,
                    "addi": 0,
                    "giftcard": 0,
                    "link_pago": 0,
                    "link_de_pago": 0,
                    "tarjeta_credito": 0,
                    "tarjeta_debito": 0,
                    "descuento_nomina": 0,
                    "descuento_por_nomina": 0,
                    "abono_transferencia": 0,
                    "abonos": 0
                }
            }
        
        # Total de la venta (desde desglose_pagos)
        desglose_pagos = venta.get("desglose_pagos", {})
        total_venta = desglose_pagos.get("total", 0)
        
        metricas_por_moneda[moneda]["ventas_totales"] += total_venta
        metricas_por_moneda[moneda]["cantidad_ventas"] += 1

        # ✅ Solo tipo = "abono_inicial", sin importar el método usado
        historial_pagos = venta.get("historial_pagos", [])
        for pago in historial_pagos:
            if pago.get("tipo") == "abono_inicial":
                metricas_por_moneda[moneda]["abonos"] += pago.get("monto", 0)
        
        # Separar servicios vs productos (desde items)
        items = venta.get("items", [])
        for item in items:
            tipo = item.get("tipo", "servicio")
            subtotal = item.get("subtotal", 0)
            
            if tipo == "servicio":
                metricas_por_moneda[moneda]["ventas_servicios"] += subtotal
            elif tipo == "producto":
                metricas_por_moneda[moneda]["ventas_productos"] += subtotal
        
        # Métodos de pago desde desglose_pagos
        for metodo in ["efectivo", "transferencia","tarjeta", "tarjeta_credito", "tarjeta_debito", "link_pago","link_de_pago", "giftcard", "addi", "abonos","abono_transferencia", "descuento_nomina","descuento_por_nomina", "otros"]:
            valor = desglose_pagos.get(metodo, 0)
            if valor > 0:
                metricas_por_moneda[moneda]["metodos_pago"][metodo] += valor
    
    # ========= CALCULAR PROMEDIOS Y REDONDEAR =========
    for moneda, datos in metricas_por_moneda.items():
        cantidad = datos["cantidad_ventas"]
        
        # Ticket promedio
        if cantidad > 0:
            datos["ticket_promedio"] = round(datos["ventas_totales"] / cantidad, 2)
        else:
            datos["ticket_promedio"] = 0
        
        # Redondear totales
        datos["ventas_totales"] = round(datos["ventas_totales"], 2)
        datos["ventas_servicios"] = round(datos["ventas_servicios"], 2)
        datos["ventas_productos"] = round(datos["ventas_productos"], 2)
        datos["abonos"] = round(datos["abonos"], 2)
        
        # Redondear métodos de pago
        for metodo in datos["metodos_pago"]:
            datos["metodos_pago"][metodo] = round(datos["metodos_pago"][metodo], 2)
        
        # Limpiar sin_pago si no se usa
        if datos["metodos_pago"]["sin_pago"] == 0:
            del datos["metodos_pago"]["sin_pago"]
    
    return metricas_por_moneda


def calcular_crecimiento(
    metricas_actuales: Dict,
    metricas_anteriores: Dict
) -> Dict:
    """
    Calcula % de crecimiento vs período anterior por moneda.
    """
    crecimientos = {}
    
    for moneda, datos_actuales in metricas_actuales.items():
        datos_anteriores = metricas_anteriores.get(moneda, {})
        
        ventas_actual = datos_actuales["ventas_totales"]
        ventas_anterior = datos_anteriores.get("ventas_totales", 0)
        
        if ventas_anterior > 0:
            crecimiento = ((ventas_actual - ventas_anterior) / ventas_anterior) * 100
        else:
            crecimiento = 100.0 if ventas_actual > 0 else 0.0
        
        crecimientos[moneda] = {
            "ventas": round(crecimiento, 1),
            "prefijo": "+" if crecimiento >= 0 else ""
        }
    
    return crecimientos


def obtener_info_monedas(monedas_detectadas: List[str], metricas: Dict) -> List[Dict]:
    """
    Genera información detallada de las monedas detectadas.
    
    💱 Soportadas: COP, USD, MXN
    """
    info_monedas_catalogo = {
        "COP": {
            "nombre": "Peso Colombiano",
            "nombre_corto": "Pesos COP",
            "simbolo": "$",
            "codigo": "COP",
            "pais": "Colombia",
            "bandera": "🇨🇴"
        },
        "USD": {
            "nombre": "Dólar Estadounidense",
            "nombre_corto": "Dólares",
            "simbolo": "$",
            "codigo": "USD",
            "pais": "Estados Unidos",
            "bandera": "🇺🇸"
        },
        "MXN": {
            "nombre": "Peso Mexicano",
            "nombre_corto": "Pesos MXN",
            "simbolo": "$",
            "codigo": "MXN",
            "pais": "México",
            "bandera": "🇲🇽"
        }
    }
    
    monedas_info = []
    for moneda in monedas_detectadas:
        info_base = info_monedas_catalogo.get(
            moneda,
            {
                "nombre": moneda,
                "nombre_corto": moneda,
                "simbolo": "",
                "codigo": moneda,
                "pais": "Desconocido",
                "bandera": "🏳️"
            }
        )
        
        metricas_moneda = metricas.get(moneda, {})
        
        monedas_info.append({
            **info_base,
            "ventas_totales": metricas_moneda.get("ventas_totales", 0),
            "cantidad_ventas": metricas_moneda.get("cantidad_ventas", 0),
            "ticket_promedio": metricas_moneda.get("ticket_promedio", 0),
            "crecimiento": metricas_moneda.get("crecimiento_ventas", "0%")
        })
    
    return monedas_info


@router.get("/dashboard")
async def ventas_dashboard(
    period: str = Query(
        "last_7_days",
        enum=["today", "last_7_days", "last_30_days", "month", "custom"],
        description="Período financiero"
    ),
    start_date: Optional[str] = Query(
        None,
        description="Fecha inicio para período 'custom' (DD-MM-YYYY)",
        regex="^\\d{2}-\\d{2}-\\d{4}$"
    ),
    end_date: Optional[str] = Query(
        None,
        description="Fecha fin para período 'custom' (DD-MM-YYYY)",
        regex="^\\d{2}-\\d{2}-\\d{4}$"
    ),
    sede_id: Optional[str] = Query(None, description="Filtrar por sede"),
    current_user: dict = Depends(get_current_user)
):
    """
    Dashboard de ventas (financiero) con métricas REALES.
    
    🔒 REQUIERE AUTENTICACIÓN
    
    💱 MULTI-MONEDA:
    - Separa automáticamente COP, USD, MXN
    - Solo muestra monedas con ventas
    - Métricas independientes por moneda
    
    🎯 FUENTE DE DATOS:
    - collection_sales → Total vendido (desglose_pagos.total)
    
    Períodos disponibles:
    - last_7_days: Tendencia confiable (DEFAULT) ✅
    - last_30_days: Análisis estratégico ✅
    - month: Seguimiento de metas ✅
    - today: Caja diaria ⚠️
    - custom: Rango personalizado (requiere start_date y end_date) 🔧
    
    Ejemplo de uso con rango personalizado:
    - GET /ventas/dashboard?period=custom&start_date=2024-12-01&end_date=2024-12-15
    
    Métricas por moneda:
    - ventas_totales: Dinero real ingresado (desglose_pagos.total)
    - cantidad_ventas: Número de ventas registradas
    - ticket_promedio: ventas_totales / cantidad_ventas
    - ventas_servicios: Total de servicios (suma items tipo servicio)
    - ventas_productos: Total de productos (suma items tipo producto)
    - metodos_pago: Efectivo, transferencia, tarjeta (desde desglose_pagos)
    - crecimiento_ventas: % vs período anterior
    """
    try:
        # ========= VALIDACIÓN DE PERMISOS =========
        allowed_roles = ["admin_sede", "admin_franquicia", "super_admin", "recepcionista", "call_center"]
        
        if current_user.get("rol") not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail="No autorizado. Se requiere rol de administrador."
            )
        
        # ========= VALIDACIÓN DE SEDE (admin_sede) =========
        if current_user.get("rol") == "admin_sede":
            user_sede_id = current_user.get("sede_id")
            
            if not user_sede_id:
                raise HTTPException(
                    status_code=403,
                    detail="Usuario admin_sede sin sede asignada."
                )
            
            # ========= VALIDACIÓN DE SEDE (admin_sede) =========
            if current_user.get("rol") == "admin_sede":
                user_sede_id = current_user.get("sede_id")
                sedes_permitidas = current_user.get("sedes_permitidas", [])

                if not user_sede_id:
                    raise HTTPException(
                        status_code=403,
                        detail="Usuario admin_sede sin sede asignada."
                    )

                # ✅ Construir lista completa de sedes autorizadas
                sedes_autorizadas = list(set([user_sede_id] + sedes_permitidas))

                if sede_id and sede_id not in sedes_autorizadas:
                    raise HTTPException(
                        status_code=403,
                        detail=f"No tiene acceso a esta sede. Sedes permitidas: {sedes_autorizadas}"
                    )

                # Si no mandó sede_id, usar la sede activa del header (X-Sede-Id) o la principal
                if not sede_id:
                    sede_id = user_sede_id
        
        # ========= CALCULAR RANGOS =========
        # Obtener zona horaria de la sede
        zona_horaria = "America/Bogota"  # default
        if sede_id:
            from app.database.mongo import collection_locales# ajusta si tu import es diferente
            sede_doc = await collection_locales.find_one({"_id": sede_id})
            if sede_doc:
                zona_horaria = sede_doc.get("zona_horaria", "America/Bogota")
        try:
            start_date_dt, end_date_dt = get_date_range(period, start_date, end_date, zona_horaria) # 👈 PASA ZONA HORARIA
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        
        dias_periodo = (end_date_dt - start_date_dt).days + 1
        
        # Período anterior (para comparación)
        start_anterior = start_date_dt - timedelta(days=dias_periodo)
        end_anterior = start_date_dt - timedelta(days=1)
        
        logger.info(
            f"💰 Dashboard ventas - Period: {period} ({dias_periodo} días), "
            f"Sede: {sede_id or 'TODAS'}, "
            f"Range: {start_date_dt.date()} to {end_date_dt.date()}"
        )
        
        # ========= OBTENER DATOS =========
        # Período actual
        ventas_actuales = await get_ventas_periodo(start_date_dt, end_date_dt, sede_id)
        
        # Período anterior
        ventas_anteriores = await get_ventas_periodo(start_anterior, end_anterior, sede_id)
        
        # ========= CALCULAR MÉTRICAS =========
        metricas_actuales = calcular_metricas_financieras(ventas_actuales)
        metricas_anteriores = calcular_metricas_financieras(ventas_anteriores)
        
        crecimientos = calcular_crecimiento(metricas_actuales, metricas_anteriores)
        
        # ========= AGREGAR CRECIMIENTOS =========
        for moneda, datos in metricas_actuales.items():
            crecimiento_info = crecimientos.get(moneda, {"ventas": 0, "prefijo": ""})
            datos["crecimiento_ventas"] = (
                f"{crecimiento_info['prefijo']}{crecimiento_info['ventas']}%"
            )
        
        # ========= VALIDACIONES =========
        advertencias = []
        
        # Sin ventas
        if not ventas_actuales:
            advertencias.append({
                "tipo": "SIN_VENTAS",
                "severidad": "CRÍTICA",
                "mensaje": "No hay ventas registradas en este período",
                "recomendacion": "Verifique que las ventas se estén registrando correctamente"
            })
        
        # Pocas ventas
        elif len(ventas_actuales) < 5:
            advertencias.append({
                "tipo": "POCAS_VENTAS",
                "severidad": "ALTA",
                "mensaje": f"Solo {len(ventas_actuales)} ventas en el período",
                "recomendacion": "Amplíe el período para análisis más estable"
            })
        
        # Período muy corto
        if dias_periodo == 1:
            advertencias.append({
                "tipo": "PERÍODO_CORTO",
                "severidad": "MEDIA",
                "mensaje": "Métricas de un día tienen alta variabilidad",
                "recomendacion": "Use 'last_7_days' para tendencias confiables"
            })
        
        # Período muy largo (custom)
        if dias_periodo > 90:
            advertencias.append({
                "tipo": "PERÍODO_LARGO",
                "severidad": "BAJA",
                "mensaje": f"Período de {dias_periodo} días puede ocultar tendencias",
                "recomendacion": "Considere dividir en períodos más cortos para mejor análisis"
            })
        
        # ========= CALIDAD DE DATOS =========
        severidades = [a["severidad"] for a in advertencias]
        
        if "CRÍTICA" in severidades:
            calidad_datos = "SIN_DATOS"
        elif "ALTA" in severidades:
            calidad_datos = "BAJA"
        elif "MEDIA" in severidades:
            calidad_datos = "MEDIA"
        else:
            calidad_datos = "BUENA"
        
        # ========= INFORMACIÓN DE MONEDAS =========
        monedas_detectadas = list(metricas_actuales.keys())
        monedas_info = obtener_info_monedas(monedas_detectadas, metricas_actuales)
        
        # ========= RESPUESTA =========
        response = {
            "success": True,
            "tipo_dashboard": "financiero_multimoneda",
            "descripcion": "Métricas basadas únicamente en ventas pagadas, separadas por moneda",
            "fuentes": {
                "ventas": "collection_sales (desglose_pagos.total)"
            },
            "usuario": {
                "username": current_user.get("username"),
                "rol": current_user.get("rol"),
                "sede_asignada": current_user.get("sede_id") if current_user.get("rol") == "admin_sede" else None
            },
            "period": period,
            "range": {
                "start": start_date_dt.isoformat(),
                "end": end_date_dt.isoformat(),
                "dias": dias_periodo
            },
            "sede_id": sede_id,
            "monedas": {
                "detectadas": monedas_detectadas,
                "cantidad": len(monedas_detectadas),
                "resumen": monedas_info,
                "nota": "Solo se muestran monedas con ventas en el período"
            },
            "metricas_por_moneda": metricas_actuales,
            "debug_info": {
                "ventas_registradas": len(ventas_actuales),
                "monedas_en_ventas": monedas_detectadas
            },
            "calidad_datos": calidad_datos
        }
        
        if advertencias:
            response["advertencias"] = advertencias
        
        logger.info(
            f"✅ Dashboard ventas generado - "
            f"Período: {dias_periodo} días, "
            f"Ventas: {len(ventas_actuales)}, "
            f"Monedas: {', '.join(monedas_detectadas)}, "
            f"Calidad: {calidad_datos}"
        )
        
        return response
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error en ventas_dashboard: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error al generar dashboard de ventas: {str(e)}"
        )


@router.get("/dashboard/monedas")
async def get_monedas_soportadas():
    """
    Lista de monedas soportadas por el dashboard.
    
    💱 Las métricas se calculan independientemente para cada moneda.
    """
    return {
        "monedas_soportadas": [
            {
                "codigo": "COP",
                "nombre": "Peso Colombiano",
                "nombre_corto": "Pesos COP",
                "simbolo": "$",
                "pais": "Colombia",
                "bandera": "🇨🇴",
                "activa": True
            },
            {
                "codigo": "USD",
                "nombre": "Dólar Estadounidense",
                "nombre_corto": "Dólares",
                "simbolo": "$",
                "pais": "Estados Unidos",
                "bandera": "🇺🇸",
                "activa": True
            },
            {
                "codigo": "MXN",
                "nombre": "Peso Mexicano",
                "nombre_corto": "Pesos MXN",
                "simbolo": "$",
                "pais": "México",
                "bandera": "🇲🇽",
                "activa": True
            }
        ],
        "nota": "El dashboard detecta y muestra dinámicamente solo las monedas con ventas"
    }


@router.get("/dashboard/periods")
async def get_available_periods():
    """
    Períodos disponibles para dashboard financiero.
    """
    return {
        "periods": [
            {
                "id": "last_7_days",
                "name": "Últimos 7 días",
                "description": "Tendencia confiable para decisiones",
                "recommended": True,
                "uso": "Análisis semanal, tendencias"
            },
            {
                "id": "last_30_days",
                "name": "Últimos 30 días",
                "description": "Análisis estratégico estable",
                "recommended": True,
                "uso": "Reportes, evaluación"
            },
            {
                "id": "month",
                "name": "Mes actual",
                "description": "Seguimiento contable",
                "recommended": True,
                "uso": "Metas mensuales, cierre"
            },
            {
                "id": "today",
                "name": "Hoy",
                "description": "⚠️ Solo para caja diaria",
                "recommended": False,
                "uso": "Seguimiento intradía"
            },
            {
                "id": "custom",
                "name": "Rango personalizado",
                "description": "🔧 Defina sus propias fechas",
                "recommended": True,
                "uso": "Análisis específicos, comparaciones personalizadas",
                "params_required": ["start_date", "end_date"],
                "format": "YYYY-MM-DD",
                "max_days": 365,
                "ejemplo": "?period=custom&start_date=2024-12-01&end_date=2024-12-15"
            }
        ],
        "default": "last_7_days",
        "nota": "Para período 'custom' debe proporcionar start_date y end_date en formato YYYY-MM-DD"
    }