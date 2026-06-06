from fastapi import APIRouter, HTTPException, Depends, status
from bson import ObjectId
from datetime import datetime

from app.admin.models import ServicioAdmin
from app.auth.routes import get_current_user
from app.database.mongo import collection_servicios, collection_locales
from app.id_generator.generator import generar_id, validar_id

router = APIRouter(prefix="/admin/servicios", tags=["Admin - Servicios"])


# ===================================================
# 🔁 Helper: convertir ObjectId a string
# ===================================================
def servicio_to_dict(s):
    s["_id"] = str(s["_id"])
    return s


async def _get_franquicia_id_de_sede(sede_id: str):
    """Obtiene franquicia_id de una sede. Retorna None si no tiene."""
    if not sede_id:
        return None
    sede = await collection_locales.find_one(
        {"sede_id": sede_id},
        {"franquicia_id": 1, "_id": 0}
    )
    return sede.get("franquicia_id") if sede else None


def _build_sede_query(sede_id: str, franquicia_id: str = None) -> dict:
    """
    Construye el filtro de acceso a servicios según contexto.

    LÓGICA HÍBRIDA:
    - Con franquicia_id → servicios globales + franquicia + sede propia
    - Sin franquicia_id → servicios globales + sede propia (comportamiento anterior)
    
    Los servicios "globales" son los que tienen sede_id: null (visibles para todos).
    """
    condiciones = [
        {"sede_id": {"$exists": False}},  # Sin campo sede_id
        {"sede_id": None},                 # sede_id explícitamente null (global)
        {"sede_id": sede_id},              # Servicios propios de la sede
    ]

    if franquicia_id:
        # ⭐ También incluir servicios marcados con esta franquicia_id
        condiciones.append({"franquicia_id": franquicia_id})

    return {"$or": condiciones}


# ===================================================
# ✅ Crear servicio
# ===================================================
@router.post("/", response_model=dict)
async def crear_servicio(
    servicio: ServicioAdmin,
    current_user: dict = Depends(get_current_user)
):
    """
    Crea un servicio.

    Alcances posibles:
    - global:     sede_id=null, sin franquicia_id   → visible para TODOS
    - franquicia: sede_id=null, con franquicia_id   → visible para toda la franquicia
    - local:      sede_id=X,   sin franquicia_id   → solo esa sede

    Permisos:
    - super_admin: puede crear en cualquier alcance
    - admin_sede:  solo crea servicios para su sede (o su franquicia si la tiene)
    """
    if current_user["rol"] not in ["super_admin", "admin_sede"]:
        raise HTTPException(403, "No autorizado para crear servicios")

    try:
        servicio_id = await generar_id(
            entidad="servicio",
            sede_id=current_user.get("sede_id"),
            metadata={
                "nombre": servicio.nombre,
                "creado_por": current_user["email"]
            }
        )
    except Exception as e:
        raise HTTPException(500, f"Error al generar ID del servicio: {str(e)}")

    data = servicio.dict()
    data["servicio_id"] = servicio_id
    data["activo"] = True
    data["creado_por"] = current_user["email"]
    data["created_at"] = datetime.now()

    if current_user["rol"] == "admin_sede":
        # admin_sede: servicio para su sede, y hereda franquicia_id si la tiene
        sede_id = current_user.get("sede_id")
        franquicia_id = await _get_franquicia_id_de_sede(sede_id)

        data["sede_id"] = sede_id
        # ⭐ Marcar con franquicia_id si la sede pertenece a una
        if franquicia_id:
            data["franquicia_id"] = franquicia_id

    elif current_user["rol"] == "super_admin":
        # super_admin: respeta lo que venga en el payload
        data["sede_id"] = servicio.sede_id  # Puede ser null (global) o una sede
        # franquicia_id puede venir en el payload o no
        # Si no viene, queda sin franquicia_id → es un servicio verdaderamente global

    result = await collection_servicios.insert_one(data)

    alcance = "global"
    if data.get("franquicia_id") and not data.get("sede_id"):
        alcance = "franquicia"
    elif data.get("sede_id"):
        alcance = "local"

    return {
        "msg": "Servicio creado exitosamente",
        "servicio_id": servicio_id,
        "_id": str(result.inserted_id),
        "sede_id": data.get("sede_id"),
        "franquicia_id": data.get("franquicia_id"),
        "alcance": alcance
    }


# ===================================================
# 📋 Listar servicios
# ===================================================
@router.get("/", response_model=list)
async def listar_servicios(
    activo: bool = None,
    sede_id: str = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Lista servicios según rol y contexto de franquicia.

    admin_sede con franquicia_id → globales + franquicia + su sede
    admin_sede sin franquicia_id → globales + su sede
    super_admin                  → todos
    """
    if current_user["rol"] in ["super_admin", "admin_sede", "call_center", "recepcionista"]:
        sede_id = current_user.get("sede_id")
        sede_activa = sede_id or current_user.get("sede_id")
        # ⭐ Intentar obtener franquicia_id (primero del token, luego de la sede)
        franquicia_id = current_user.get("franquicia_id") or await _get_franquicia_id_de_sede(sede_id)

        query = _build_sede_query(sede_id, franquicia_id)

        if activo is not None:
            query = {"$and": [query, {"activo": activo}]}

    else:  # super_admin
        query = {}
        if activo is not None:
            query["activo"] = activo

    servicios = await collection_servicios.find(query).to_list(None)
    return [servicio_to_dict(s) for s in servicios]


# ===================================================
# 🔍 Obtener servicio por ID
# ===================================================
@router.get("/{servicio_id}", response_model=dict)
async def obtener_servicio(
    servicio_id: str,
    current_user: dict = Depends(get_current_user)
):
    servicio = await collection_servicios.find_one({"servicio_id": servicio_id})

    if not servicio:
        try:
            servicio = await collection_servicios.find_one({"_id": ObjectId(servicio_id)})
        except Exception:
            pass

    if not servicio:
        raise HTTPException(404, f"Servicio no encontrado con ID: {servicio_id}")

    return servicio_to_dict(servicio)


# ===================================================
# ✏️ Actualizar servicio
# ===================================================
@router.put("/{servicio_id}", response_model=dict)
async def actualizar_servicio(
    servicio_id: str,
    servicio_data: ServicioAdmin,
    current_user: dict = Depends(get_current_user)
):
    if current_user["rol"] not in ["super_admin", "admin_sede"]:
        raise HTTPException(403, "No autorizado para editar servicios")

    servicio_actual = await collection_servicios.find_one({"servicio_id": servicio_id})
    if not servicio_actual:
        try:
            servicio_actual = await collection_servicios.find_one({"_id": ObjectId(servicio_id)})
        except Exception:
            pass

    if not servicio_actual:
        raise HTTPException(404, f"Servicio no encontrado con ID: {servicio_id}")

    if current_user["rol"] == "admin_sede":
        sede_id = current_user.get("sede_id")
        franquicia_id = current_user.get("franquicia_id") or await _get_franquicia_id_de_sede(sede_id)

        servicio_sede = servicio_actual.get("sede_id")
        servicio_franquicia = servicio_actual.get("franquicia_id")

        # Puede editar si el servicio es de su sede
        # No puede editar servicios globales ni de otras franquicias
        puede_editar = servicio_sede == sede_id

        if not puede_editar:
            raise HTTPException(
                403,
                "Solo puedes editar servicios de tu propia sede"
            )

    update_data = {k: v for k, v in servicio_data.dict().items() if v is not None}
    update_data.pop("servicio_id", None)
    update_data.pop("sede_id", None)        # La sede no se puede cambiar
    update_data.pop("franquicia_id", None)  # La franquicia no se puede cambiar
    update_data["updated_at"] = datetime.now()
    update_data["updated_by"] = current_user["email"]

    filter_query = (
        {"servicio_id": servicio_id}
        if "servicio_id" in servicio_actual
        else {"_id": ObjectId(servicio_id)}
    )

    result = await collection_servicios.update_one(filter_query, {"$set": update_data})

    if result.matched_count == 0:
        raise HTTPException(404, f"Servicio no encontrado con ID: {servicio_id}")

    return {"msg": "Servicio actualizado correctamente", "servicio_id": servicio_id}


# ===================================================
# ❌ Eliminar servicio (SOFT DELETE)
# ===================================================
@router.delete("/{servicio_id}", response_model=dict)
async def eliminar_servicio(
    servicio_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user["rol"] not in ["super_admin", "admin_sede"]:
        raise HTTPException(403, "No autorizado para eliminar servicios")

    servicio_actual = await collection_servicios.find_one({"servicio_id": servicio_id})
    if not servicio_actual:
        try:
            servicio_actual = await collection_servicios.find_one({"_id": ObjectId(servicio_id)})
        except Exception:
            pass

    if not servicio_actual:
        raise HTTPException(404, f"Servicio no encontrado con ID: {servicio_id}")

    if current_user["rol"] == "admin_sede":
        # Solo puede eliminar servicios de su propia sede
        if servicio_actual.get("sede_id") != current_user.get("sede_id"):
            raise HTTPException(
                403,
                "Solo puedes eliminar servicios de tu propia sede"
            )

    filter_query = (
        {"servicio_id": servicio_id}
        if "servicio_id" in servicio_actual
        else {"_id": ObjectId(servicio_id)}
    )

    result = await collection_servicios.update_one(
        filter_query,
        {"$set": {
            "activo": False,
            "deleted_at": datetime.now(),
            "deleted_by": current_user["email"]
        }}
    )

    if result.matched_count == 0:
        raise HTTPException(404, f"Servicio no encontrado con ID: {servicio_id}")

    return {"msg": "Servicio eliminado correctamente", "servicio_id": servicio_id}


# ===================================================
# 🔍 VALIDAR ID
# ===================================================
@router.get("/validar/{servicio_id}", response_model=dict)
async def validar_servicio_id(
    servicio_id: str,
    current_user: dict = Depends(get_current_user)
):
    es_valido_formato = await validar_id(servicio_id, entidad="servicio")

    if not es_valido_formato:
        raise HTTPException(400, "Formato de ID inválido. Debe ser: SV-[números]")

    servicio = await collection_servicios.find_one({
        "servicio_id": servicio_id,
        "activo": True
    })

    if not servicio:
        raise HTTPException(404, f"No existe servicio activo con ID: {servicio_id}")

    alcance = "global"
    if servicio.get("franquicia_id") and not servicio.get("sede_id"):
        alcance = "franquicia"
    elif servicio.get("sede_id"):
        alcance = "local"

    return {
        "valido": True,
        "servicio_id": servicio_id,
        "nombre": servicio.get("nombre"),
        "duracion_minutos": servicio.get("duracion_minutos"),
        "precios": servicio.get("precios"),
        "alcance": alcance
    }


# ===================================================
# 📊 Listar servicios por categoría
# ===================================================
@router.get("/categoria/{categoria}", response_model=list)
async def listar_servicios_por_categoria(
    categoria: str,
    current_user: dict = Depends(get_current_user)
):
    query = {"categoria": categoria, "activo": True}

    if current_user["rol"] == ["admin_sede", "call_center", "recepcionista"]:
        sede_id = current_user.get("sede_id")
        franquicia_id = current_user.get("franquicia_id") or await _get_franquicia_id_de_sede(sede_id)

        filtro_acceso = _build_sede_query(sede_id, franquicia_id)
        query = {"$and": [query, filtro_acceso]}

    servicios = await collection_servicios.find(query).to_list(None)
    return [servicio_to_dict(s) for s in servicios]