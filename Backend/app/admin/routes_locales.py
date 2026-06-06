"""
Routes para gestión de Locales (Sedes)
IDs cortos NO secuenciales: SD-00247
Con reglas_comision por sede
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from bson import ObjectId
from datetime import datetime
from typing import Optional
import logging

from app.admin.models import Local
from app.database.mongo import collection_locales
from app.auth.routes import get_current_user
from app.id_generator.generator import generar_id, validar_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/locales", tags=["Admin - Locales"])


# ================================================
# Helper: Convertir ObjectId a string y formatear
# ================================================
def local_to_dict(local: dict) -> dict:
    """Convierte local de MongoDB a dict serializable"""
    local["_id"] = str(local["_id"])
    
    # Fallback para locales sin sede_id
    if "sede_id" not in local or not local["sede_id"]:
        local["sede_id"] = str(local["_id"])
    
    # Fallback para reglas_comision si no existe
    if "reglas_comision" not in local:
        local["reglas_comision"] = {"tipo": "servicios"}
    
    return local


# ================================================
# ✅ Crear Local (Sede) — con sede_id tipo SD-XXXXX
# ================================================
@router.post("/", response_model=dict)
async def crear_local(
    local: Local,
    current_user: dict = Depends(get_current_user)
):
    # 🔐 Validar permisos
    if current_user["rol"] not in ["super_admin", "admin_franquicia"]:
        raise HTTPException(status_code=403, detail="No autorizado para crear sedes")

    # 🆔 Generar sede_id tipo SD-XXXXX
    import random
    random_number = random.randint(10000, 99999)
    sede_id = f"SD-{random_number}"

    # ⏳ Fecha actual
    fecha_actual = datetime.now()

    # 📦 Construir documento a insertar
    data = {
        "nombre": local.nombre,
        "direccion": local.direccion,
        "informacion_adicional": local.informacion_adicional,
        "zona_horaria": local.zona_horaria,
        "pais": local.pais,
        "moneda": local.moneda,
        "reglas_comision": local.reglas_comision or {"tipo": "servicios"},  # ✅ NUEVO
        "telefono": local.telefono,
        "email": local.email,
        "sede_id": sede_id,
        "fecha_creacion": fecha_actual,
        "creado_por": current_user["email"],
        "activa": True,
    }

    # 💾 Insertar en Mongo
    result = await collection_locales.insert_one(data)

    return {
        "msg": "✅ Local creado exitosamente",
        "mongo_id": str(result.inserted_id),
        "sede_id": sede_id,
        "pais": local.pais,
        "moneda": local.moneda,
        "reglas_comision": data["reglas_comision"]  # ✅ NUEVO
    }


# ================================================
# 📋 List Locales
# ================================================
@router.get("/", response_model=list)
async def listar_locales(
    activa: Optional[bool] = Query(None, description="Filtrar por estado"),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista todos los locales (sedes).
    
    Permisos:
    - super_admin: Ve todas las sedes
    - admin_sede: Ve solo su sede asignada
    """
    try:
        # ========= CONSTRUIR QUERY =========
        query = {}
        
        # ✅ Filtro por rol: admin_sede solo ve su sede
        if current_user.get("rol") == "admin_sede":
            sede_id = current_user.get("sede_id")
            if not sede_id:
                logger.warning(
                    f"⚠️ admin_sede {current_user.get('email')} sin sede_id asignada"
                )
                raise HTTPException(
                    status_code=403,
                    detail="Usuario sin sede asignada"
                )
            query["sede_id"] = sede_id
            logger.info(
                f"🔐 Filtrando por sede_id: {sede_id} para {current_user.get('email')}"
            )
        
        # Filtro de estado
        if activa is not None:
            query["activa"] = activa
        
        # ========= OBTENER SEDES =========
        sedes = await collection_locales.find(query).to_list(None)
        
        logger.info(
            f"📋 Listado de {len(sedes)} locales por {current_user.get('email')} (rol: {current_user.get('rol')})"
        )
        
        return [local_to_dict(s) for s in sedes]
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error al listar locales: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Error al listar locales"
        )


# ================================================
# 🔍 Get Local by sede_id
# ================================================
@router.get("/{sede_id}", response_model=dict)
async def get_local(sede_id: str, current_user: dict = Depends(get_current_user)):
    local = await collection_locales.find_one({"sede_id": sede_id})
    if not local:
        raise HTTPException(status_code=404, detail="Local not found")
    return local_to_dict(local)


# ================================================
# ✏️ Update Local by sede_id
# ================================================
@router.put("/{sede_id}", response_model=dict)
async def update_local(
    sede_id: str,
    data: Local,
    current_user: dict = Depends(get_current_user)
):
    if current_user["rol"] not in ["super_admin", "admin_franquicia"]:
        raise HTTPException(status_code=403, detail="Not authorized to update branches")

    # Construir datos a actualizar (solo campos proporcionados)
    update_data = {k: v for k, v in data.dict().items() if v is not None}

    result = await collection_locales.update_one(
        {"sede_id": sede_id},
        {"$set": update_data}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Local not found")

    # 🔍 Obtener el local actualizado
    updated_local = await collection_locales.find_one({"sede_id": sede_id})

    return {
        "msg": "✅ Local updated successfully",
        "local": local_to_dict(updated_local)
    }


# ================================================
# ❌ Delete Local by sede_id
# ================================================
@router.delete("/{sede_id}", response_model=dict)
async def delete_local(sede_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["rol"] != "super_admin":
        raise HTTPException(status_code=403, detail="Only super_admin can delete branches")

    result = await collection_locales.delete_one({"sede_id": sede_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Local not found")

    return {"msg": "🗑️ Local deleted successfully"}