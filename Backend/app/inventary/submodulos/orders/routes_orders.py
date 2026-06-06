from fastapi import APIRouter, HTTPException, Depends
from app.inventary.submodulos.orders.models import Pedido
from app.database.mongo import collection_pedidos, collection_productos, collection_inventarios
from app.auth.routes import get_current_user
from datetime import datetime
from typing import List
from bson import ObjectId

router = APIRouter(prefix="/pedidos")


# =========================================================
# 🧩 Helper para convertir ObjectId
# =========================================================
def pedido_to_dict(p):
    p["_id"] = str(p["_id"])
    return p


# =========================================================
# 🆕 Helper: Crear registro en inventarios si no existe
# =========================================================
async def asegurar_inventario(nombre: str,producto_id: str, sede_id: str, creado_por: str):
    """
    Crea un registro en inventarios si no existe.
    Se llama automáticamente al crear el primer pedido de un producto.
    """
    inventario_existente = await collection_inventarios.find_one({
        "producto_id": producto_id,
        "sede_id": sede_id

    })
    
    if not inventario_existente:
        nuevo_inventario = {
            "nombre": nombre, # Se puede actualizar luego
            "producto_id": producto_id,
            "sede_id": sede_id,
            "stock_actual": 0,
            "stock_minimo": 5,  # Default
            "fecha_creacion": datetime.now(),
            "fecha_ultima_actualizacion": datetime.now(),
            "creado_por": creado_por
        }
        result = await collection_inventarios.insert_one(nuevo_inventario)
        print(f"✅ Inventario auto-creado: {sede_id} - producto {producto_id}")
        return str(result.inserted_id)
    
    return str(inventario_existente["_id"])


# =========================================================
# 📦 Crear pedido (AUTO-CREA INVENTARIO)
# =========================================================
@router.post("/", response_model=dict)
async def crear_pedido(
    pedido: Pedido,
    current_user: dict = Depends(get_current_user)
):
    """
    Crea un pedido y auto-crea registros en inventarios si no existen.
    admin_sede: Solo puede crear pedidos para SU sede (filtro automático)
    super_admin: Puede crear pedidos para cualquier sede
    """
    rol = current_user.get("rol")

    if rol not in ["admin_sede", "admin_franquicia", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado para crear pedidos")

    data = pedido.dict()
    
    # 🔐 Filtro automático: admin_sede solo puede crear pedidos para su sede
    if rol == "admin_sede":
        user_sede_id = current_user.get("sede_id")
        if not user_sede_id:
            raise HTTPException(status_code=403, detail="Usuario sin sede asignada")
        data["sede_id"] = user_sede_id  # Forzar sede del usuario
    elif not data.get("sede_id"):
        raise HTTPException(status_code=400, detail="Debe especificar sede_id")
    
    data["fecha_creacion"] = datetime.now()
    data["creado_por"] = current_user["email"]

    # ✅ Auto-crear inventarios si no existen
    for item in pedido.items:
        # Validar que el producto existe usando el campo 'id' personalizado
        producto = await collection_productos.find_one({"id": item.producto_id})
        if not producto:
            raise HTTPException(
                status_code=404, 
                detail=f"Producto no encontrado ({item.producto_id})"
            )
        
        # Crear inventario si no existe
        await asegurar_inventario(
            producto_id=item.producto_id,
            sede_id=data["sede_id"],
            creado_por=current_user["email"],
            nombre=item.nombre
        )

    result = await collection_pedidos.insert_one(data)
    data["_id"] = str(result.inserted_id)

    print(f"🟢 EVENTO: pedido.created -> {data['_id']} (sede: {data['sede_id']})")

    return {"msg": "Pedido creado exitosamente", "pedido": data}


# =========================================================
# 📦 Listar pedidos (FILTRO AUTOMÁTICO POR SEDE)
# =========================================================
@router.get("/", response_model=List[dict])
async def listar_pedidos(
    sede_id: str = None,
    franquicia_id: str = None,
    estado: str = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Lista pedidos:
    - admin_sede: Solo ve pedidos de SU sede (filtro automático)
    - super_admin: Ve todos los pedidos o filtra por sede_id/franquicia_id
    """
    rol = current_user.get("rol")

    if rol not in ["admin_sede", "admin_franquicia", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado para listar pedidos")

    query = {}
    
    # 🔐 Filtro automático por sede para admin_sede
    if rol == "admin_sede":
        user_sede_id = current_user.get("sede_id")
        if not user_sede_id:
            raise HTTPException(status_code=403, detail="Usuario sin sede asignada")
        query["sede_id"] = user_sede_id
    else:
        # super_admin puede filtrar manualmente
        if sede_id:
            query["sede_id"] = sede_id
        if franquicia_id:
            query["franquicia_id"] = franquicia_id
    
    if estado:
        query["estado"] = estado

    pedidos = await collection_pedidos.find(query).to_list(None)
    return [pedido_to_dict(p) for p in pedidos]


# =========================================================
# 📦 Obtener pedido por ID
# =========================================================
@router.get("/{pedido_id}", response_model=dict)
async def obtener_pedido(
    pedido_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Obtiene un pedido específico.
    admin_sede: Solo puede ver pedidos de su sede
    """
    rol = current_user.get("rol")
    
    pedido = await collection_pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    
    # 🔐 Validar que admin_sede solo vea pedidos de su sede
    if rol == "admin_sede":
        user_sede_id = current_user.get("sede_id")
        if pedido.get("sede_id") != user_sede_id:
            raise HTTPException(status_code=403, detail="No autorizado para ver este pedido")

    return pedido_to_dict(pedido)


# =========================================================
# 📦 Actualizar estado de pedido (ACTUALIZA INVENTARIOS)
# =========================================================
@router.patch("/{pedido_id}/estado", response_model=dict)
async def actualizar_estado_pedido(
    pedido_id: str,
    nuevo_estado: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Actualiza el estado de un pedido.
    Cuando se marca como 'recibido', suma stock al inventario de la sede.
    """
    rol = current_user.get("rol")

    if rol not in ["admin_sede", "admin_franquicia", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado para actualizar pedidos")

    pedido = await collection_pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    
    # 🔐 Validar que admin_sede solo actualice pedidos de su sede
    if rol == "admin_sede":
        user_sede_id = current_user.get("sede_id")
        if pedido.get("sede_id") != user_sede_id:
            raise HTTPException(status_code=403, detail="No autorizado para actualizar este pedido")

    if nuevo_estado not in ["pendiente", "recibido", "cancelado"]:
        raise HTTPException(status_code=400, detail="Estado inválido")

    await collection_pedidos.update_one(
        {"_id": ObjectId(pedido_id)},
        {"$set": {"estado": nuevo_estado}}
    )

    # 🟡 Evento: pedido.received → Actualizar INVENTARIOS (no productos)
    if nuevo_estado == "recibido":
        for item in pedido["items"]:
            # Buscar inventario de la sede
            inventario = await collection_inventarios.find_one({
                "producto_id": item["producto_id"],
                "sede_id": pedido["sede_id"]
            })
            
            if inventario:
                nuevo_stock = inventario["stock_actual"] + item["cantidad"]
                await collection_inventarios.update_one(
                    {"_id": inventario["_id"]},
                    {
                        "$set": {
                            "stock_actual": nuevo_stock,
                            "fecha_ultima_actualizacion": datetime.now()
                        }
                    }
                )
                
                # Obtener nombre del producto para log usando 'id'
                producto = await collection_productos.find_one({"id": item["producto_id"]})
                producto_nombre = producto.get("nombre", "N/A") if producto else "N/A"
                
                print(f"📦 Stock actualizado en inventario -> {pedido['sede_id']} - {producto_nombre}: +{item['cantidad']} unidades")
            else:
                print(f"⚠️ Inventario no encontrado para producto {item['producto_id']} en sede {pedido['sede_id']}")
        
        print(f"🟡 EVENTO: pedido.received -> {pedido_id}")

    return {"msg": f"Pedido actualizado a estado '{nuevo_estado}'"}


# =========================================================
# 📦 Eliminar pedido
# =========================================================
@router.delete("/{pedido_id}", response_model=dict)
async def eliminar_pedido(
    pedido_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Elimina un pedido.
    admin_sede: Solo puede eliminar pedidos de su sede
    """
    rol = current_user.get("rol")

    if rol not in ["admin_sede", "admin_franquicia", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado para eliminar pedidos")
    
    pedido = await collection_pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    
    # 🔐 Validar que admin_sede solo elimine pedidos de su sede
    if rol == "admin_sede":
        user_sede_id = current_user.get("sede_id")
        if pedido.get("sede_id") != user_sede_id:
            raise HTTPException(status_code=403, detail="No autorizado para eliminar este pedido")

    result = await collection_pedidos.delete_one({"_id": ObjectId(pedido_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    return {"msg": "Pedido eliminado correctamente"}