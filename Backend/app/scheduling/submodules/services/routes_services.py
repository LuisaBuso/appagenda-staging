from fastapi import APIRouter, HTTPException, Depends
from app.scheduling.models import Servicio
from app.database.mongo import collection_servicios
from app.auth.routes import get_current_user
from typing import List
from bson import ObjectId
from datetime import datetime
import random

router = APIRouter()


# =========================================================
# 🧩 Helper para convertir ObjectId a string
# =========================================================
def servicio_to_dict(s):
    s["_id"] = str(s["_id"])
    return s

def generar_servicio_id():
    return f"SV-{random.randint(10000, 99999)}"


# =========================================================
# 🔹 Listar servicios (acceso público)
# =========================================================
@router.get("/", response_model=List[dict])
async def listar_servicios(
    sede_id: str = None
):
    query = {}
    if sede_id:
        query["sede_id"] = sede_id

    servicios = await collection_servicios.find(query).to_list(None)
    return [servicio_to_dict(s) for s in servicios]


@router.post("/", response_model=dict)
async def crear_servicio(
    servicio: Servicio,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user["rol"]

    if rol not in ["admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado para crear servicios")

    # Convertimos a diccionario base
    data = servicio.dict()

    # Campos adicionales obligatorios
    data["comision_estilista"] = data.get("comision_estilista", 0)
    data["categoria"] = data.get("categoria", "")
    data["requiere_producto"] = data.get("requiere_producto", False)
    data["activo"] = True

    ahora = datetime.now()

    data["creado_por"] = current_user["email"]
    data["created_at"] = ahora
    data["updated_at"] = ahora

    # Generar servicio_id tipo SV-43024
    data["servicio_id"] = generar_servicio_id()

    # Insertar en Mongo
    result = await collection_servicios.insert_one(data)
    data["_id"] = str(result.inserted_id)

    return {
        "msg": "Servicio creado exitosamente",
        "servicio": data
    }


# =========================================================
# 🔹 Editar servicio (solo admin_sede o super_admin)
# =========================================================
@router.put("/{servicio_id}", response_model=dict)
async def editar_servicio(
    servicio_id: str,
    servicio_data: Servicio,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user["rol"]

    if rol not in ["admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado para editar servicios")

    update_data = {k: v for k, v in servicio_data.dict().items() if v is not None}

    result = await collection_servicios.update_one(
        {"_id": ObjectId(servicio_id)},
        {"$set": update_data}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    return {"msg": "Servicio actualizado correctamente"}


# =========================================================
# 🔹 Eliminar servicio (solo admin_sede o super_admin)
# =========================================================
@router.delete("/{servicio_id}", response_model=dict)
async def eliminar_servicio(
    servicio_id: str,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user["rol"]

    if rol not in ["admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado para eliminar servicios")

    result = await collection_servicios.delete_one({"_id": ObjectId(servicio_id)})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")

    return {"msg": "Servicio eliminado correctamente"}
