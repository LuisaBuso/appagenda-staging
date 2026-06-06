from fastapi import APIRouter, HTTPException, Depends, Query
from app.inventary.submodulos.entrances.models import Entrada
from app.database.mongo import (
    collection_inventarios,
    collection_productos,
    collection_inventory_reports,
    collection_locales,
)
from app.auth.routes import get_current_user
from app.utils.timezone import today
from app.utils.fecha_parser import resolver_rango
from typing import List, Optional
from bson import ObjectId

router = APIRouter(prefix="/entradas")


def entrada_to_dict(e: dict) -> dict:
    e["_id"] = str(e["_id"])
    return e


# =========================================================
# 📥 Crear entrada de stock (SUMA AL INVENTARIO)
# =========================================================
@router.post("/", response_model=dict)
async def crear_entrada(
    entrada: Entrada,
    current_user: dict = Depends(get_current_user),
):
    """
    Registra una entrada de stock (compra, devolución, ajuste, etc.).
    Suma al inventario de la sede y guarda en inventory_reports.
    """
    rol = current_user["rol"]
    if rol not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado para registrar entradas")

    data = entrada.dict()

    # 🔐 Sede
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

    items_procesados = []

    for item in entrada.items:
        if item.cantidad <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"La cantidad debe ser positiva para el producto {item.producto_id}",
            )

        producto = await collection_productos.find_one({"id": item.producto_id})
        if not producto:
            raise HTTPException(
                status_code=404,
                detail=f"Producto {item.producto_id} no encontrado en catálogo",
            )

        inventario = await collection_inventarios.find_one(
            {"producto_id": item.producto_id, "sede_id": data["sede_id"]}
        )
        if not inventario:
            raise HTTPException(
                status_code=404,
                detail=f"No existe inventario para '{producto['nombre']}' en esta sede. Créalo primero.",
            )

        stock_anterior = inventario["stock_actual"]
        stock_nuevo = stock_anterior + item.cantidad

        await collection_inventarios.update_one(
            {"_id": inventario["_id"]},
            {"$set": {"stock_actual": stock_nuevo, "fecha_ultima_actualizacion": fecha_actual}},
        )

        items_procesados.append({
            "producto_id": item.producto_id,
            "nombre_producto": producto["nombre"],
            "cantidad": item.cantidad,
            "stock_anterior": stock_anterior,
            "stock_nuevo": stock_nuevo,
        })

        print(f"📈 ENTRADA: {data['sede_id']} - {producto['nombre']}: +{item.cantidad} ({stock_anterior}→{stock_nuevo})")

    # 📋 Guardar en inventory_reports
    reporte = {
        "tipo": "entrada",
        "sede_id": data["sede_id"],
        "motivo": data["motivo"],
        "observaciones": data.get("observaciones"),
        "items": items_procesados,
        "fecha": fecha_actual,
        "creado_por": current_user["email"],
    }
    result = await collection_inventory_reports.insert_one(reporte)
    reporte["_id"] = str(result.inserted_id)

    print(f"🟢 EVENTO: entrada.created -> {reporte['_id']} (motivo: {data['motivo']}, sede: {data['sede_id']})")

    return {"msg": "Entrada registrada exitosamente", "reporte_id": reporte["_id"], "items": items_procesados}


# =========================================================
# 📥 Listar entradas
# =========================================================
@router.get("/", response_model=List[dict])
async def listar_entradas(
    sede_id: Optional[str] = None,
    dias: Optional[int] = Query(7, description="Últimos N días. Ignorado si viene fecha_desde/fecha_hasta"),
    fecha_desde: Optional[str] = Query(None, description="Inicio del rango. Formatos: YYYY-MM-DD o DD-MM-YYYY"),
    fecha_hasta: Optional[str] = Query(None, description="Fin del rango. Formatos: YYYY-MM-DD o DD-MM-YYYY"),
    current_user: dict = Depends(get_current_user),
):
    rol = current_user["rol"]
    if rol not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    inicio, fin = resolver_rango(dias, fecha_desde, fecha_hasta)

    query: dict = {
        "tipo": "entrada",
        "fecha": {"$gte": inicio, "$lte": fin},
    }
    if rol == "admin_sede":
        query["sede_id"] = current_user.get("sede_id")
    elif sede_id:
        query["sede_id"] = sede_id

    entradas = await collection_inventory_reports.find(query).sort("fecha", -1).to_list(None)
    return [entrada_to_dict(e) for e in entradas]