from fastapi import APIRouter, HTTPException, Depends
from app.admin.models import Franquicia, FranquiciaUpdate, AsignarSede
from app.database.mongo import collection_franquicia, collection_locales, collection_clients, collection_auth
from app.auth.routes import get_current_user
from app.id_generator.generator import generar_id
from datetime import datetime
from typing import List, Optional
from bson import ObjectId
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


def franquicia_to_dict(f: dict) -> dict:
    f["_id"] = str(f["_id"])
    return f


# ============================================================
# CREAR FRANQUICIA
# ============================================================
@router.post("/", response_model=dict)
async def crear_franquicia(
    franquicia: Franquicia,
    current_user: dict = Depends(get_current_user)
):
    try:
        if current_user.get("rol") != "super_admin":
            raise HTTPException(403, "Solo super_admin puede crear franquicias")

        franquicia_id = await generar_id("franquicia")

        data = franquicia.dict(exclude_none=True)
        data["franquicia_id"] = franquicia_id
        data["fecha_creacion"] = datetime.now()
        data["creado_por"] = current_user.get("email")
        data["sedes"] = []

        result = await collection_franquicia.insert_one(data)
        data["_id"] = str(result.inserted_id)

        return {"success": True, "franquicia": data}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error al crear franquicia: {e}", exc_info=True)
        raise HTTPException(500, "Error al crear franquicia")


# ============================================================
# LISTAR FRANQUICIAS
# ============================================================
@router.get("/", response_model=List[dict])
async def listar_franquicias(
    current_user: dict = Depends(get_current_user)
):
    try:
        if current_user.get("rol") != "super_admin":
            raise HTTPException(403, "No autorizado")

        franquicias = await collection_franquicia.find().to_list(None)
        return [franquicia_to_dict(f) for f in franquicias]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listando franquicias: {e}", exc_info=True)
        raise HTTPException(500, "Error al listar franquicias")


# ============================================================
# OBTENER FRANQUICIA
# ============================================================
@router.get("/{franquicia_id}", response_model=dict)
async def obtener_franquicia(
    franquicia_id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        if current_user.get("rol") != "super_admin":
            raise HTTPException(403, "No autorizado")

        franquicia = await collection_franquicia.find_one({"franquicia_id": franquicia_id})
        if not franquicia:
            raise HTTPException(404, "Franquicia no encontrada")

        # Enriquecer con info de sedes
        sedes_ids = franquicia.get("sedes", [])
        sedes_info = []
        if sedes_ids:
            sedes_cursor = collection_locales.find(
                {"sede_id": {"$in": sedes_ids}},
                {"sede_id": 1, "nombre_sede": 1, "nombre": 1, "local": 1, "pais": 1, "_id": 0}
            )
            sedes_info = await sedes_cursor.to_list(None)

        result = franquicia_to_dict(franquicia)
        result["sedes_detalle"] = sedes_info
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error obteniendo franquicia {franquicia_id}: {e}", exc_info=True)
        raise HTTPException(500, "Error al obtener franquicia")


# ============================================================
# EDITAR FRANQUICIA
# ============================================================
@router.put("/{franquicia_id}", response_model=dict)
async def editar_franquicia(
    franquicia_id: str,
    data_update: FranquiciaUpdate,
    current_user: dict = Depends(get_current_user)
):
    try:
        if current_user.get("rol") != "super_admin":
            raise HTTPException(403, "Solo super_admin puede editar franquicias")

        franquicia = await collection_franquicia.find_one({"franquicia_id": franquicia_id})
        if not franquicia:
            raise HTTPException(404, "Franquicia no encontrada")

        update_data = data_update.dict(exclude_none=True)
        update_data["modificado_por"] = current_user.get("email")
        update_data["fecha_modificacion"] = datetime.now()

        await collection_franquicia.update_one(
            {"franquicia_id": franquicia_id},
            {"$set": update_data}
        )

        return {"success": True, "msg": "Franquicia actualizada"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error editando franquicia: {e}", exc_info=True)
        raise HTTPException(500, "Error al editar franquicia")


# ============================================================
# ELIMINAR FRANQUICIA
# ============================================================
@router.delete("/{franquicia_id}", response_model=dict)
async def eliminar_franquicia(
    franquicia_id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        if current_user.get("rol") != "super_admin":
            raise HTTPException(403, "Solo super_admin puede eliminar franquicias")

        franquicia = await collection_franquicia.find_one({"franquicia_id": franquicia_id})
        if not franquicia:
            raise HTTPException(404, "Franquicia no encontrada")

        # Verificar que no tenga sedes activas
        sedes_activas = len(franquicia.get("sedes", []))
        if sedes_activas > 0:
            raise HTTPException(
                400,
                f"No se puede eliminar: la franquicia tiene {sedes_activas} sede(s) asignada(s). "
                "Desasígnalas primero."
            )

        await collection_franquicia.delete_one({"franquicia_id": franquicia_id})

        return {"success": True, "msg": "Franquicia eliminada"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error eliminando franquicia: {e}", exc_info=True)
        raise HTTPException(500, "Error al eliminar franquicia")


# ============================================================
# ASIGNAR SEDE A FRANQUICIA
# ============================================================
@router.post("/{franquicia_id}/sedes", response_model=dict)
async def asignar_sede(
    franquicia_id: str,
    body: AsignarSede,
    current_user: dict = Depends(get_current_user)
):
    """
    Asigna una sede a una franquicia.
    Actualiza:
    - collection_franquicia: agrega sede_id al array sedes[]
    - collection_locales: marca la sede con franquicia_id
    - collection_auth: marca todos los usuarios de esa sede con franquicia_id
    """
    try:
        if current_user.get("rol") != "super_admin":
            raise HTTPException(403, "Solo super_admin puede asignar sedes")

        # Verificar franquicia
        franquicia = await collection_franquicia.find_one({"franquicia_id": franquicia_id})
        if not franquicia:
            raise HTTPException(404, "Franquicia no encontrada")

        # Verificar sede
        sede = await collection_locales.find_one({"sede_id": body.sede_id})
        if not sede:
            raise HTTPException(404, f"Sede no encontrada: {body.sede_id}")

        # Verificar que la sede no esté ya en otra franquicia
        sede_franquicia_actual = sede.get("franquicia_id")
        if sede_franquicia_actual and sede_franquicia_actual != franquicia_id:
            raise HTTPException(
                400,
                f"La sede ya pertenece a la franquicia '{sede_franquicia_actual}'. "
                "Desasígnala primero."
            )

        # 1️⃣ Agregar sede al array de la franquicia (evitar duplicados)
        await collection_franquicia.update_one(
            {"franquicia_id": franquicia_id},
            {"$addToSet": {"sedes": body.sede_id}}
        )

        # 2️⃣ Marcar la sede con franquicia_id
        await collection_locales.update_one(
            {"sede_id": body.sede_id},
            {"$set": {"franquicia_id": franquicia_id}}
        )

        # 3️⃣ Propagar franquicia_id a todos los usuarios de esa sede
        usuarios_actualizados = await collection_auth.update_many(
            {"sede_id": body.sede_id},
            {"$set": {"franquicia_id": franquicia_id}}
        )

        return {
            "success": True,
            "msg": f"Sede '{body.sede_id}' asignada a franquicia '{franquicia_id}'",
            "usuarios_actualizados": usuarios_actualizados.modified_count
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error asignando sede a franquicia: {e}", exc_info=True)
        raise HTTPException(500, "Error al asignar sede")


# ============================================================
# QUITAR SEDE DE FRANQUICIA
# ============================================================
@router.delete("/{franquicia_id}/sedes/{sede_id}", response_model=dict)
async def quitar_sede(
    franquicia_id: str,
    sede_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Desasigna una sede de una franquicia.
    Limpia franquicia_id en la sede y sus usuarios.
    """
    try:
        if current_user.get("rol") != "super_admin":
            raise HTTPException(403, "Solo super_admin puede desasignar sedes")

        franquicia = await collection_franquicia.find_one({"franquicia_id": franquicia_id})
        if not franquicia:
            raise HTTPException(404, "Franquicia no encontrada")

        if sede_id not in franquicia.get("sedes", []):
            raise HTTPException(400, f"La sede '{sede_id}' no pertenece a esta franquicia")

        # 1️⃣ Quitar sede del array
        await collection_franquicia.update_one(
            {"franquicia_id": franquicia_id},
            {"$pull": {"sedes": sede_id}}
        )

        # 2️⃣ Limpiar franquicia_id de la sede
        await collection_locales.update_one(
            {"sede_id": sede_id},
            {"$unset": {"franquicia_id": ""}}
        )

        # 3️⃣ Limpiar franquicia_id de los usuarios de esa sede
        usuarios_actualizados = await collection_auth.update_many(
            {"sede_id": sede_id},
            {"$unset": {"franquicia_id": ""}}
        )

        return {
            "success": True,
            "msg": f"Sede '{sede_id}' desasignada de franquicia '{franquicia_id}'",
            "usuarios_actualizados": usuarios_actualizados.modified_count
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error quitando sede de franquicia: {e}", exc_info=True)
        raise HTTPException(500, "Error al quitar sede")