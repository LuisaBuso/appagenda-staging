from fastapi import APIRouter, HTTPException, Depends
from app.scheduling.models import Horario
from app.database.mongo import collection_horarios
from app.auth.routes import get_current_user
from datetime import datetime
from bson import ObjectId

router = APIRouter()

# ============================================
# 🔧 Convertir ObjectId a string
# ============================================
def horario_to_dict(h):
    h["_id"] = str(h["_id"])
    return h


# ============================================
# 🕓 Crear horario (creado_por y fecha auto)
# ============================================
@router.post("/", response_model=dict)
async def crear_horario(
    horario: Horario,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user["rol"]

    if rol not in ["admin_sede", "admin_franquicia", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado para crear horarios")

    # 🔍 Evitar duplicados por estilista
    existing = await collection_horarios.find_one({
        "profesional_id": horario.profesional_id
    })
    if existing:
        raise HTTPException(status_code=400, detail="El estilista ya tiene un horario registrado")

    # 🔢 Unique ID incremental
    last_h = await collection_horarios.find_one(sort=[("unique_id", -1)])
    if not last_h or "unique_id" not in last_h:
        unique_id = "H001"
    else:
        try:
            num = int(last_h["unique_id"][1:])
            unique_id = f"H{str(num + 1).zfill(3)}"
        except:
            unique_id = "H001"

    # 🧱 Armar documento final
    data = horario.dict()
    data["unique_id"] = unique_id
    data["creado_por"] = current_user["email"]
    data["fecha_creacion"] = datetime.now().isoformat()

    # 💾 Insertar en Mongo
    result = await collection_horarios.insert_one(data)
    data["_id"] = str(result.inserted_id)

    return {
        "msg": "Horario creado correctamente",
        "unique_id": unique_id,
        "horario": data
    }


# ============================================
# 📋 Listar horario por PROFESIONAL_ID
# ============================================
@router.get("/stylist/{profesional_id}", response_model=dict)
async def listar_horarios_estilista(
    profesional_id: str,
    current_user: dict = Depends(get_current_user)
):
    # Buscar por profesional_id (ES-36044)
    horario = await collection_horarios.find_one({"profesional_id": profesional_id})

    if not horario:
        raise HTTPException(status_code=404, detail="Horario no encontrado")

    return horario_to_dict(horario)



# ============================================
# ✏️ Actualizar horario
# ============================================
@router.put("/{horario_id}", response_model=dict)
async def actualizar_horario(
    horario_id: str,
    horario_data: Horario,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user["rol"]

    if rol not in ["admin_sede", "admin_franquicia", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    update_data = horario_data.dict()

    result = await collection_horarios.update_one(
        {"_id": ObjectId(horario_id)},
        {"$set": update_data}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Horario no encontrado")

    return {"msg": "Horario actualizado"}


# ============================================
# ❌ Eliminar horario
# ============================================
@router.delete("/{horario_id}", response_model=dict)
async def eliminar_horario(
    horario_id: str,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user["rol"]

    if rol not in ["admin_sede", "admin_franquicia", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    result = await collection_horarios.delete_one({"_id": ObjectId(horario_id)})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Horario no encontrado")

    return {"msg": "Horario eliminado correctamente"}


