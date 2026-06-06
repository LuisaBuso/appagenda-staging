from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional
from datetime import datetime
from bson import ObjectId
from app.auth.routes import get_current_user
from app.database.mongo import collection_commissions
from .models import (
    ComisionResponse, 
    ComisionDetalleResponse, 
    LiquidarComisionRequest,
    ResumenComisionPorTipo,
)

router = APIRouter(
    prefix="",
    tags=["Comisiones"]
)

# ==============================================================
# HELPERS
# ==============================================================

def verificar_permisos_liquidacion(user: dict):
    """Verifica que el usuario tenga permisos para liquidar"""
    roles_permitidos = ["super_admin", "admin_sede"]
    if user.get("rol") not in roles_permitidos:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para liquidar comisiones"
        )

def validar_object_id(comision_id: str):
    """Valida que sea un ObjectId válido"""
    if not ObjectId.is_valid(comision_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ID de comisión inválido"
        )

async def obtener_comision_por_id(comision_id: str) -> dict:
    """Busca una comisión por ID"""
    comision = await collection_commissions.find_one({"_id": ObjectId(comision_id)})
    if not comision:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comisión no encontrada"
        )
    return comision

def verificar_acceso_sede(user: dict, comision: dict):
    """Verifica que admin_sede solo acceda a su propia sede"""
    if user.get("rol") == "admin_sede":
        if comision["sede_id"] != user.get("sede_id"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para acceder a esta comisión"
            )

def puede_liquidar_comision(comision: dict) -> tuple[bool, str]:
    """
    Verifica si una comisión puede ser liquidada.
    REGLA: Una comisión NO puede abarcar más de 15 días.
    """
    servicios = comision.get("servicios_detalle", [])
    if not servicios:
        return False, "La comisión no tiene servicios"
    
    fechas = []
    for servicio in servicios:
        try:
            fecha = datetime.strptime(servicio["fecha"], "%Y-%m-%d")
            fechas.append(fecha)
        except:
            continue
    
    if not fechas:
        return False, "No se pudieron validar las fechas de los servicios"
    
    fecha_mas_antigua = min(fechas)
    fecha_mas_reciente = max(fechas)
    dias_totales = (fecha_mas_reciente - fecha_mas_antigua).days + 1
    
    if dias_totales > 15:
        return False, f"Esta comisión abarca {dias_totales} días. El máximo permitido es 15 días"
    
    return True, "Comisión lista para liquidar"

def construir_query_filtros(user: dict, filtros: Optional[dict] = None):
    """Construye el query considerando el rol del usuario"""
    query = {}
    
    # Filtro por sede según rol
    if user.get("rol") == "admin_sede":
        query["sede_id"] = user.get("sede_id")
    
    if not filtros:
        return query
    
    # Aplicar filtros
    if filtros.get("profesional_id"):
        query["profesional_id"] = filtros["profesional_id"]
    
    if filtros.get("sede_id") and user.get("rol") == "super_admin":
        query["sede_id"] = filtros["sede_id"]
    
    if filtros.get("estado"):
        if filtros["estado"] == "pendiente":
            query["$or"] = [
                {"estado": "pendiente"},
                {"estado": {"$exists": False}}
            ]
        else:
            query["estado"] = filtros["estado"]
    
    # ⭐ NUEVO: Filtrar por tipo de comisión
    if filtros.get("tipo_comision"):
        query["tipo_comision"] = filtros["tipo_comision"]
    
    # Buscar por rango de fechas en servicios_detalle
    if filtros.get("fecha_inicio") or filtros.get("fecha_fin"):
        fecha_query = {}
        if filtros.get("fecha_inicio"):
            fecha_query["$gte"] = filtros["fecha_inicio"]
        if filtros.get("fecha_fin"):
            fecha_query["$lte"] = filtros["fecha_fin"]
        
        if fecha_query:
            query["servicios_detalle.fecha"] = fecha_query
    
    return query

def formatear_comision_response(comision: dict) -> ComisionResponse:
    return ComisionResponse(
        id=str(comision["_id"]),
        profesional_id=comision["profesional_id"],
        profesional_nombre=comision["profesional_nombre"],

        sede_id=comision["sede_id"],
        sede_nombre=comision.get("sede_nombre", ""),  # ⭐ AQUÍ

        moneda=comision.get("moneda"),
        tipo_comision=comision.get("tipo_comision", "servicios"),
        total_servicios=comision["total_servicios"],
        total_comisiones=comision["total_comisiones"],
        periodo_inicio=comision.get("periodo_inicio", ""),
        periodo_fin=comision.get("periodo_fin", ""),
        estado=comision.get("estado", "pendiente"),
        creado_en=comision["creado_en"],
        liquidada_por=comision.get("liquidada_por"),
        liquidada_en=comision.get("liquidada_en")
    )


# ⭐ NUEVA FUNCIÓN: Calcular totales desglosados por tipo
def _valor_comision_producto_detalle(item: dict) -> float:
    for campo in ("valor_comision_productos", "valor_comision", "comision", "comision_valor"):
        if item.get(campo) is not None:
            try:
                return float(item.get(campo) or 0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def calcular_totales_por_tipo(servicios_detalle: list, productos_detalle: list | None = None) -> dict:
    """
    Calcula totales de comisiones desglosados por tipo
    """
    total_servicios = 0
    total_productos = 0
    
    for servicio in servicios_detalle:
        total_servicios += servicio.get("valor_comision_servicio", 0)
        total_productos += servicio.get("valor_comision_productos", 0)

    for producto in productos_detalle or []:
        total_productos += _valor_comision_producto_detalle(producto)
    
    total_general = total_servicios + total_productos
    
    return {
        "total_comisiones_servicios": total_servicios,
        "total_comisiones_productos": total_productos,
        "total_comisiones": total_general,
        "porcentaje_servicios": (total_servicios / total_general * 100) if total_general > 0 else 0,
        "porcentaje_productos": (total_productos / total_general * 100) if total_general > 0 else 0
    }

# ==============================================================
# ENDPOINTS
# ==============================================================

@router.get("/", response_model=List[ComisionResponse])
async def obtener_comisiones(
    profesional_id: Optional[str] = Query(None),
    sede_id: Optional[str] = Query(None),
    estado: Optional[str] = Query(None),
    tipo_comision: Optional[str] = Query(None, description="servicios | productos | mixto"),  # ⭐ NUEVO
    fecha_inicio: Optional[str] = Query(None, description="Filtrar desde esta fecha (YYYY-MM-DD)"),
    fecha_fin: Optional[str] = Query(None, description="Filtrar hasta esta fecha (YYYY-MM-DD)"),
    user: dict = Depends(get_current_user)
):
    """
    Obtiene el listado de comisiones según el rol:
    - superadmin: ve todas las comisiones
    - admin_sede: solo ve comisiones de su sede
    """
    try:
        filtros = {
            "profesional_id": profesional_id,
            "sede_id": sede_id,
            "estado": estado,
            "tipo_comision": tipo_comision,  # ⭐ NUEVO
            "fecha_inicio": fecha_inicio,
            "fecha_fin": fecha_fin
        }
        
        query = construir_query_filtros(user, filtros)
        comisiones = await collection_commissions.find(query).sort("creado_en", -1).to_list(1000)
        
        return [formatear_comision_response(c) for c in comisiones]
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al obtener comisiones: {str(e)}"
        )

@router.get("/{comision_id}", response_model=ComisionDetalleResponse)
async def obtener_comision_detalle(
    comision_id: str,
    user: dict = Depends(get_current_user)
):
    """Obtiene el detalle completo de una comisión incluyendo todos los servicios"""
    try:
        validar_object_id(comision_id)
        comision = await obtener_comision_por_id(comision_id)
        verificar_acceso_sede(user, comision)
        
        # ⭐ CALCULAR TOTALES DESGLOSADOS
        totales = calcular_totales_por_tipo(
            comision.get("servicios_detalle", []),
            comision.get("productos_detalle", []),
        )
        
        return ComisionDetalleResponse(
            id=str(comision["_id"]),
            profesional_id=comision["profesional_id"],
            profesional_nombre=comision["profesional_nombre"],
            sede_id=comision["sede_id"],
            moneda=comision.get("moneda"),
            tipo_comision=comision.get("tipo_comision", "servicios"),  # ⭐ NUEVO
            total_servicios=comision["total_servicios"],
            total_comisiones=comision["total_comisiones"],
            total_comisiones_servicios=totales["total_comisiones_servicios"],  # ⭐ NUEVO
            total_comisiones_productos=totales["total_comisiones_productos"],  # ⭐ NUEVO
            servicios_detalle=comision["servicios_detalle"],
            productos_detalle=comision.get("productos_detalle", []),
            periodo_inicio=comision.get("periodo_inicio", ""),
            periodo_fin=comision.get("periodo_fin", ""),
            estado=comision.get("estado", "pendiente"),
            creado_en=comision["creado_en"],
            liquidada_por=comision.get("liquidada_por"),
            liquidada_en=comision.get("liquidada_en")
        )
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al obtener detalle de comisión: {str(e)}"
        )

@router.post("/{comision_id}/liquidar")
async def liquidar_comision(
    comision_id: str,
    request: LiquidarComisionRequest,
    user: dict = Depends(get_current_user)
):
    """
    Liquida una comisión pendiente.
    REGLA: Solo se pueden liquidar comisiones que NO abarquen más de 15 días.
    """
    try:
        verificar_permisos_liquidacion(user)
        validar_object_id(comision_id)
        comision = await obtener_comision_por_id(comision_id)
        verificar_acceso_sede(user, comision)
        
        # Verificar que esté pendiente
        estado_actual = comision.get("estado", "pendiente")
        if estado_actual != "pendiente":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Esta comisión ya está {estado_actual}"
            )
        
        # Validar regla de 15 días
        puede_liquidar, mensaje = puede_liquidar_comision(comision)
        if not puede_liquidar:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=mensaje
            )
        
        # Actualizar estado
        update_data = {
            "estado": "liquidada",
            "liquidada_por": user.get("email"),
            "liquidada_en": datetime.now()
        }
        
        if request.notas:
            update_data["notas_liquidacion"] = request.notas
        
        resultado = await collection_commissions.update_one(
            {"_id": ObjectId(comision_id)},
            {"$set": update_data}
        )
        
        if resultado.modified_count == 0:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error al liquidar la comisión"
            )
        
        return {
            "message": "Comisión liquidada exitosamente",
            "comision_id": comision_id,
            "liquidada_por": user.get("email"),
            "liquidada_en": update_data["liquidada_en"]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al liquidar comisión: {str(e)}"
        )

@router.get("/pendientes/resumen")
async def obtener_resumen_pendientes(
    user: dict = Depends(get_current_user)
):
    """
    Obtiene un resumen de las comisiones pendientes:
    - Total de comisiones pendientes
    - Monto total pendiente
    - Por profesional
    - ⭐ NUEVO: Desglose por tipo (servicios/productos)
    """
    try:
        # Buscar pendientes (sin estado o con estado pendiente)
        query = {
            "$or": [
                {"estado": "pendiente"},
                {"estado": {"$exists": False}}
            ]
        }
        
        # Si es admin_sede, solo su sede
        if user.get("rol") == "admin_sede":
            query["sede_id"] = user.get("sede_id")
        
        comisiones_pendientes = await collection_commissions.find(query).to_list(1000)
        
        # Calcular resumen
        total_comisiones = len(comisiones_pendientes)
        monto_total = sum(c["total_comisiones"] for c in comisiones_pendientes)
        
        # ⭐ NUEVO: Calcular totales por tipo
        total_comisiones_servicios = 0
        total_comisiones_productos = 0
        
        for comision in comisiones_pendientes:
            servicios = comision.get("servicios_detalle", [])
            for servicio in servicios:
                total_comisiones_servicios += servicio.get("valor_comision_servicio", 0)
                total_comisiones_productos += servicio.get("valor_comision_productos", 0)
            for producto in comision.get("productos_detalle", []):
                total_comisiones_productos += _valor_comision_producto_detalle(producto)
        
        # Obtener moneda (puede ser null para comisiones viejas)
        moneda = comisiones_pendientes[0].get("moneda") if comisiones_pendientes else None
        
        # Agrupar por profesional
        por_profesional = {}
        for comision in comisiones_pendientes:
            prof_id = comision["profesional_id"]
            if prof_id not in por_profesional:
                por_profesional[prof_id] = {
                    "profesional_id": prof_id,
                    "profesional_nombre": comision["profesional_nombre"],
                    "cantidad_periodos": 0,
                    "total_comisiones": 0,
                    "total_comisiones_servicios": 0,  # ⭐ NUEVO
                    "total_comisiones_productos": 0,  # ⭐ NUEVO
                    "moneda": comision.get("moneda"),
                    "tipo_comision": comision.get("tipo_comision", "servicios")  # ⭐ NUEVO
                }
            
            por_profesional[prof_id]["cantidad_periodos"] += 1
            por_profesional[prof_id]["total_comisiones"] += comision["total_comisiones"]
            
            # ⭐ SUMAR TOTALES POR TIPO
            servicios = comision.get("servicios_detalle", [])
            for servicio in servicios:
                por_profesional[prof_id]["total_comisiones_servicios"] += servicio.get("valor_comision_servicio", 0)
                por_profesional[prof_id]["total_comisiones_productos"] += servicio.get("valor_comision_productos", 0)
            for producto in comision.get("productos_detalle", []):
                por_profesional[prof_id]["total_comisiones_productos"] += _valor_comision_producto_detalle(producto)
        
        return {
            "total_comisiones_pendientes": total_comisiones,
            "monto_total_pendiente": monto_total,
            "total_comisiones_servicios": total_comisiones_servicios,  # ⭐ NUEVO
            "total_comisiones_productos": total_comisiones_productos,  # ⭐ NUEVO
            "moneda": moneda,
            "por_profesional": list(por_profesional.values())
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al obtener resumen: {str(e)}"
        )

# ⭐ NUEVO ENDPOINT: Resumen desglosado por tipo
@router.get("/resumen/por-tipo", response_model=List[ResumenComisionPorTipo])
async def obtener_resumen_por_tipo(
    sede_id: Optional[str] = Query(None),
    profesional_id: Optional[str] = Query(None),
    estado: str = Query("pendiente", description="pendiente | liquidada | todas"),
    user: dict = Depends(get_current_user)
):
    """
    Obtiene un resumen detallado de comisiones desglosadas por tipo
    (servicios vs productos) para análisis.
    """
    try:
        # Construir query base
        query = {}
        
        if estado == "pendiente":
            query["$or"] = [
                {"estado": "pendiente"},
                {"estado": {"$exists": False}}
            ]
        elif estado != "todas":
            query["estado"] = estado
        
        # Filtros adicionales
        if user.get("rol") == "admin_sede":
            query["sede_id"] = user.get("sede_id")
        elif sede_id:
            query["sede_id"] = sede_id
        
        if profesional_id:
            query["profesional_id"] = profesional_id
        
        # Obtener comisiones
        comisiones = await collection_commissions.find(query).to_list(1000)
        
        # Agrupar por profesional + sede
        resumen_por_profesional = {}
        
        for comision in comisiones:
            key = f"{comision['profesional_id']}_{comision['sede_id']}"
            
            if key not in resumen_por_profesional:
                resumen_por_profesional[key] = {
                    "profesional_id": comision["profesional_id"],
                    "profesional_nombre": comision["profesional_nombre"],
                    "sede_id": comision["sede_id"],
                    "moneda": comision.get("moneda", "COP"),
                    "tipo_comision_sede": comision.get("tipo_comision", "servicios"),
                    "total_servicios": 0,
                    "total_comisiones": 0,
                    "comisiones_por_servicios": 0,
                    "comisiones_por_productos": 0,
                    "estado": estado,
                    "periodo_inicio": "",
                    "periodo_fin": ""
                }
            
            # Sumar totales
            resumen_por_profesional[key]["total_servicios"] += comision["total_servicios"]
            resumen_por_profesional[key]["total_comisiones"] += comision["total_comisiones"]
            
            # Calcular desglose por tipo
            servicios = comision.get("servicios_detalle", [])
            for servicio in servicios:
                resumen_por_profesional[key]["comisiones_por_servicios"] += servicio.get("valor_comision_servicio", 0)
                resumen_por_profesional[key]["comisiones_por_productos"] += servicio.get("valor_comision_productos", 0)
            for producto in comision.get("productos_detalle", []):
                resumen_por_profesional[key]["comisiones_por_productos"] += _valor_comision_producto_detalle(producto)
        
        # Calcular porcentajes
        resultado = []
        for datos in resumen_por_profesional.values():
            total = datos["total_comisiones"]
            datos["porcentaje_servicios"] = (datos["comisiones_por_servicios"] / total * 100) if total > 0 else 0
            datos["porcentaje_productos"] = (datos["comisiones_por_productos"] / total * 100) if total > 0 else 0
            resultado.append(ResumenComisionPorTipo(**datos))
        
        return resultado
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al obtener resumen por tipo: {str(e)}"
        )

@router.post("/liquidar-multiple")
async def liquidar_multiples_comisiones(
    comisiones_ids: List[str],
    notas: Optional[str] = None,
    user: dict = Depends(get_current_user)
):
    """
    Liquida múltiples comisiones a la vez.
    REGLA: Solo liquida las que NO superen 15 días de rango.
    """
    try:
        verificar_permisos_liquidacion(user)
        
        # Validar IDs
        object_ids = []
        for cid in comisiones_ids:
            validar_object_id(cid)
            object_ids.append(ObjectId(cid))
        
        # Construir query - buscar pendientes (con o sin campo estado)
        query = {
            "_id": {"$in": object_ids},
            "$or": [
                {"estado": "pendiente"},
                {"estado": {"$exists": False}}
            ]
        }
        
        # Si es admin_sede, solo su sede
        if user.get("rol") == "admin_sede":
            query["sede_id"] = user.get("sede_id")
        
        comisiones = await collection_commissions.find(query).to_list(1000)
        
        liquidadas = []
        rechazadas = []
        
        # Validar cada comisión
        for comision in comisiones:
            puede_liquidar_flag, mensaje = puede_liquidar_comision(comision)
            
            if puede_liquidar_flag:
                liquidadas.append(comision["_id"])
            else:
                rechazadas.append({
                    "comision_id": str(comision["_id"]),
                    "profesional": comision["profesional_nombre"],
                    "motivo": mensaje
                })
        
        # Liquidar las que cumplieron
        if liquidadas:
            update_data = {
                "estado": "liquidada",
                "liquidada_por": user.get("email"),
                "liquidada_en": datetime.now()
            }
            
            if notas:
                update_data["notas_liquidacion"] = notas
            
            await collection_commissions.update_many(
                {"_id": {"$in": liquidadas}},
                {"$set": update_data}
            )
        
        return {
            "message": "Proceso de liquidación completado",
            "liquidadas": len(liquidadas),
            "rechazadas": len(rechazadas),
            "detalle_rechazadas": rechazadas,
            "liquidada_por": user.get("email")
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al liquidar comisiones: {str(e)}"
        )
