from fastapi import APIRouter, HTTPException, Depends, Query
from app.inventary.submodulos.exits.models import Salida
from app.database.mongo import (
    collection_salidas,
    collection_productos,
    collection_inventarios,
    collection_inventory_reports,
    collection_locales,
)
from app.auth.routes import get_current_user
from app.utils.timezone import today
from app.utils.fecha_parser import resolver_rango
from typing import List, Optional
from bson import ObjectId

router = APIRouter()


def salida_to_dict(s: dict) -> dict:
    s["_id"] = str(s["_id"])
    return s


# =========================================================
# 📤 Crear salida de stock
# =========================================================
@router.post("/", response_model=dict)
async def crear_salida(
    salida: Salida,
    current_user: dict = Depends(get_current_user),
):
    rol = current_user["rol"]
    if rol not in ["admin_sede", "admin_franquicia", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado para registrar salidas")

    data = salida.dict()

    if rol == "admin_sede":
        user_sede_id = current_user.get("sede_id")
        if not user_sede_id:
            raise HTTPException(status_code=403, detail="Usuario sin sede asignada")
        data["sede_id"] = user_sede_id
    elif not data.get("sede_id"):
        raise HTTPException(status_code=400, detail="Debe especificar sede_id")

    # ⏰ Timezone de la sede
    sede = await collection_locales.find_one({"id": data["sede_id"]})
    fecha_actual = today(sede).replace(tzinfo=None) if sede else __import__("datetime").datetime.now()

    data["fecha_creacion"] = fecha_actual
    data["creado_por"] = current_user["email"]

    items_procesados = []

    for item in salida.items:
        if item.cantidad <= 0:
            raise HTTPException(status_code=400, detail=f"Cantidad debe ser positiva para {item.producto_id}")

        inventario = await collection_inventarios.find_one(
            {"producto_id": item.producto_id, "sede_id": data["sede_id"]}
        )
        if not inventario:
            raise HTTPException(
                status_code=404,
                detail=f"No existe inventario para {item.producto_id} en esta sede.",
            )

        stock_anterior = inventario["stock_actual"]
        stock_nuevo = stock_anterior - item.cantidad

        if stock_nuevo < 0:
            nombre = inventario.get("nombre", item.producto_id)
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuficiente para '{nombre}' (disponible: {stock_anterior})",
            )

        await collection_inventarios.update_one(
            {"_id": inventario["_id"]},
            {"$set": {"stock_actual": stock_nuevo, "fecha_ultima_actualizacion": fecha_actual}},
        )

        items_procesados.append({
            "producto_id": item.producto_id,
            "nombre_producto": inventario.get("nombre", item.producto_id),
            "cantidad": item.cantidad,
            "stock_anterior": stock_anterior,
            "stock_nuevo": stock_nuevo,
        })

        print(f"📉 SALIDA: {data['sede_id']} - {inventario.get('nombre')}: -{item.cantidad} ({stock_anterior}→{stock_nuevo})")

    # 📋 Guardar en inventory_reports
    reporte = {
        "tipo": "salida",
        "sede_id": data["sede_id"],
        "motivo": data["motivo"],
        "observaciones": data.get("observaciones"),
        "items": items_procesados,
        "fecha": fecha_actual,
        "creado_por": current_user["email"],
    }
    await collection_inventory_reports.insert_one(reporte)

    # También guardar en collection_salidas (histórico anterior)
    result = await collection_salidas.insert_one(data)
    data["_id"] = str(result.inserted_id)

    print(f"🔴 EVENTO: salida.created -> {data['_id']} (motivo: {data['motivo']}, sede: {data['sede_id']})")
    return {"msg": "Salida registrada exitosamente", "salida": data}


# =========================================================
# 📤 Listar salidas
# =========================================================
@router.get("/", response_model=List[dict])
async def listar_salidas(
    sede_id: Optional[str] = None,
    dias: Optional[int] = Query(7, description="Últimos N días. Ignorado si viene fecha_desde/fecha_hasta"),
    fecha_desde: Optional[str] = Query(None, description="Inicio del rango. Formatos: YYYY-MM-DD o DD-MM-YYYY"),
    fecha_hasta: Optional[str] = Query(None, description="Fin del rango. Formatos: YYYY-MM-DD o DD-MM-YYYY"),
    current_user: dict = Depends(get_current_user),
):
    rol = current_user["rol"]
    if rol not in ["admin_sede", "admin_franquicia", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado para listar salidas")

    inicio, fin = resolver_rango(dias, fecha_desde, fecha_hasta)

    query: dict = {
        "fecha_creacion": {"$gte": inicio, "$lte": fin},
    }
    if rol == "admin_sede":
        query["sede_id"] = current_user.get("sede_id")
    elif sede_id:
        query["sede_id"] = sede_id

    salidas = await collection_salidas.find(query).sort("fecha_creacion", -1).to_list(None)
    return [salida_to_dict(s) for s in salidas]

# =========================================================
# 📤 Obtener salida por ID
# =========================================================
@router.get("/{salida_id}", response_model=dict)
async def obtener_salida(salida_id: str, current_user: dict = Depends(get_current_user)):
    salida = await collection_salidas.find_one({"_id": ObjectId(salida_id)})
    if not salida:
        raise HTTPException(status_code=404, detail="Salida no encontrada")

    if current_user.get("rol") == "admin_sede":
        if salida.get("sede_id") != current_user.get("sede_id"):
            raise HTTPException(status_code=403, detail="No autorizado")

    return salida_to_dict(salida)


# =========================================================
# 🗑️ Eliminar salida (SOLO SUPER_ADMIN)
# =========================================================
@router.delete("/{salida_id}", response_model=dict)
async def eliminar_salida(salida_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["rol"] != "super_admin":
        raise HTTPException(status_code=403, detail="Solo super_admin puede eliminar salidas")

    result = await collection_salidas.delete_one({"_id": ObjectId(salida_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Salida no encontrada")

    return {"msg": "Salida eliminada (stock NO revertido automáticamente)"}