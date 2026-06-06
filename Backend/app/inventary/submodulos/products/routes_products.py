from fastapi import APIRouter, HTTPException, Depends, Query
from app.inventary.submodulos.products.models import Producto
from app.database.mongo import collection_productos, collection_inventarios, collection_contadores
from app.auth.routes import get_current_user
from datetime import datetime
from typing import List, Optional, Dict
from bson import ObjectId
import re

router = APIRouter(prefix="/productos")


# =========================================================
# 🧩 Helper para convertir ObjectId
# =========================================================
def producto_to_dict(p):
    p["_id"] = str(p["_id"])
    return p


# =========================================================
# 🧩 Obtener precio según moneda
# =========================================================
def get_precio_moneda(producto: dict, moneda: str = "COP") -> float:
    precios = producto.get("precios", {})
    if precios and isinstance(precios, dict):
        return precios.get(moneda, 0)
    return 0


# =========================================================
# ⭐ Helper: generar ID secuencial atómico
# =========================================================
async def generar_id_producto() -> str:
    """
    Incrementa atómicamente el contador y retorna un ID tipo P001, P002...
    Usa find_one_and_update con $inc para garantizar que dos requests
    simultáneos nunca obtengan el mismo número (operación atómica en MongoDB).
    """
    resultado = await collection_contadores.find_one_and_update(
        {"_id": "productos"},
        {"$inc": {"secuencia": 1}},
        upsert=True,
        return_document=True
    )
    numero = resultado["secuencia"]
    # P001...P999 y luego P1000, P1001 sin truncar
    return f"P{numero:03d}" if numero < 1000 else f"P{numero}"


# =========================================================
# ⭐ Helper: resolver comisión con fallback sede → global
# =========================================================
async def resolver_comision_producto(producto_id: str, sede_id: Optional[str] = None) -> float:
    """
    Prioridad:
      1. comision del inventario de la sede  (override)
      2. comision global del producto        (fallback)
      3. 0 si no hay nada definido
    """
    if sede_id:
        inventario = await collection_inventarios.find_one(
            {"producto_id": producto_id, "sede_id": sede_id}
        )
        if inventario and inventario.get("comision") is not None:
            return float(inventario["comision"])

    producto = await collection_productos.find_one({"id": producto_id})
    if not producto:
        try:
            producto = await collection_productos.find_one({"_id": ObjectId(producto_id)})
        except Exception:
            pass

    if producto:
        return float(producto.get("comision", 0))

    return 0.0


# =========================================================
# 🔹 Crear producto (SOLO SUPER_ADMIN)
# =========================================================
@router.post("/", response_model=dict)
async def crear_producto(
    producto: Producto,
    current_user: dict = Depends(get_current_user)
):
    """
    Crea un producto global con precios en múltiples monedas.
    Solo super_admin puede crear productos.
    ⭐ Genera automáticamente un ID secuencial tipo P007, P008...
       partiendo del máximo encontrado en la BD (inicializado por el script).
    """
    rol = current_user.get("rol")
    if rol != "super_admin":
        raise HTTPException(status_code=403, detail="Solo super_admin puede crear productos")

    filtro = {"nombre": producto.nombre}
    if producto.codigo:
        filtro["codigo"] = producto.codigo

    existente = await collection_productos.find_one(filtro)
    if existente:
        raise HTTPException(status_code=400, detail="Ya existe un producto con ese nombre o código")

    data = producto.dict(exclude_none=True)

    # ⭐ Generar ID atómico — nunca habrá colisiones
    data["id"] = await generar_id_producto()

    data["fecha_creacion"] = datetime.now()
    data["creado_por"] = current_user["email"]

    if "comision" not in data or data["comision"] is None:
        data["comision"] = 0

    result = await collection_productos.insert_one(data)
    data["_id"] = str(result.inserted_id)

    return {"msg": "Producto creado exitosamente", "producto": data}


# =========================================================
# 🔹 Listar productos
# =========================================================
@router.get("/", response_model=List[dict])
async def listar_productos(
    sede_id: Optional[str] = None,
    franquicia_id: Optional[str] = None,
    moneda: Optional[str] = Query(None, description="Moneda para mostrar precio (COP, USD, MXN)"),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista productos disponibles.
    ⭐ Si se pasa sede_id, el campo 'comision' refleja el % de esa sede.
    """
    rol = current_user.get("rol")
    if rol not in ["admin_sede", "admin_franquicia", "super_admin", "estilista", "call_center", "recepcionista"]:
        raise HTTPException(status_code=403, detail="No autorizado para listar productos")

    query = {}
    if franquicia_id:
        query["franquicia_id"] = franquicia_id

    productos = await collection_productos.find(query).to_list(None)

    inventarios_sede: dict[str, dict] = {}
    if sede_id:
        inventarios = await collection_inventarios.find({"sede_id": sede_id}).to_list(None)
        inventarios_sede = {inv["producto_id"]: inv for inv in inventarios}

    resultado = []
    for p in productos:
        p_dict = producto_to_dict(p)
        producto_id = p_dict.get("id") or p_dict.get("_id")

        comision_global = float(p_dict.get("comision", 0))
        if sede_id and producto_id in inventarios_sede:
            inv = inventarios_sede[producto_id]
            comision_sede = inv.get("comision")
            p_dict["comision"] = float(comision_sede) if comision_sede is not None else comision_global
            p_dict["comision_override_sede"] = comision_sede is not None
        else:
            p_dict["comision"] = comision_global
            p_dict["comision_override_sede"] = False

        p_dict["comision_global"] = comision_global

        if moneda:
            p_dict["precio_local"] = get_precio_moneda(p, moneda)
            p_dict["moneda_local"] = moneda

        resultado.append(p_dict)

    return resultado


# =========================================================
# 🔹 Obtener producto por ID
# =========================================================
@router.get("/{producto_id}", response_model=dict)
async def obtener_producto(
    producto_id: str,
    moneda: Optional[str] = Query(None),
    sede_id: Optional[str] = Query(None, description="Para resolver comisión por sede"),
    current_user: dict = Depends(get_current_user)
):
    """
    Obtiene un producto específico.
    Busca primero por campo 'id' (P001...) y luego por _id de MongoDB como fallback.
    ⭐ Si se pasa sede_id, 'comision' refleja el % de esa sede.
    """
    # Intentar por campo id legible (P001, P002...) primero
    producto = await collection_productos.find_one({"id": producto_id})

    # Fallback: intentar como ObjectId de MongoDB
    if not producto:
        try:
            producto = await collection_productos.find_one({"_id": ObjectId(producto_id)})
        except Exception:
            pass

    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    p_dict = producto_to_dict(producto)
    producto_id_campo = p_dict.get("id") or producto_id
    comision_global = float(p_dict.get("comision", 0))

    if sede_id:
        inventario = await collection_inventarios.find_one(
            {"producto_id": producto_id_campo, "sede_id": sede_id}
        )
        comision_sede = inventario.get("comision") if inventario else None
        p_dict["comision"] = float(comision_sede) if comision_sede is not None else comision_global
        p_dict["comision_override_sede"] = comision_sede is not None
    else:
        p_dict["comision"] = comision_global
        p_dict["comision_override_sede"] = False

    p_dict["comision_global"] = comision_global

    if moneda:
        p_dict["precio_local"] = get_precio_moneda(producto, moneda)
        p_dict["moneda_local"] = moneda

    return p_dict


# =========================================================
# 🔹 Editar producto (SOLO SUPER_ADMIN)
# =========================================================
@router.put("/{producto_id}", response_model=dict)
async def editar_producto(
    producto_id: str,
    producto_data: Producto,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol")
    if rol != "super_admin":
        raise HTTPException(status_code=403, detail="Solo super_admin puede editar productos")

    update_data = {k: v for k, v in producto_data.dict(exclude_none=True).items() if v is not None}
    # Proteger el campo id para que nunca se sobreescriba en un PUT
    update_data.pop("id", None)

    result = await collection_productos.update_one(
        {"_id": ObjectId(producto_id)},
        {"$set": update_data}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    return {"msg": "Producto actualizado correctamente"}


# =========================================================
# 🔹 Eliminar producto (SOLO SUPER_ADMIN)
# =========================================================
@router.delete("/{producto_id}", response_model=dict)
async def eliminar_producto(
    producto_id: str,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol")
    if rol != "super_admin":
        raise HTTPException(status_code=403, detail="Solo super_admin puede eliminar productos")

    result = await collection_productos.delete_one({"_id": ObjectId(producto_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    return {"msg": "Producto eliminado correctamente"}


"""# =========================================================
# 🔹 Productos con stock bajo
# =========================================================
@router.get("/alertas/stock-bajo", response_model=List[dict])
async def productos_stock_bajo(
    moneda: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol")
    if rol not in ["admin_sede", "admin_franquicia", "super_admin", "estilista", "call_center", "recepcionista"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    productos = await collection_productos.find({
        "$expr": {"$lt": ["$stock_actual", "$stock_minimo"]}
    }).to_list(None)

    resultado = []
    for p in productos:
        p_dict = producto_to_dict(p)
        if "comision" not in p_dict:
            p_dict["comision"] = 0
        if moneda:
            p_dict["precio_local"] = get_precio_moneda(p, moneda)
            p_dict["moneda_local"] = moneda
        print(f"⚠️ ALERTA: {p['nombre']} - Stock: {p['stock_actual']}/{p['stock_minimo']}")
        resultado.append(p_dict)

    return resultado"""


# =========================================================
# 🔹 Actualizar precios (SUPER_ADMIN)
# =========================================================
@router.patch("/{producto_id}/precios", response_model=dict)
async def actualizar_precios(
    producto_id: str,
    precios: Dict[str, float],
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol")
    if rol != "super_admin":
        raise HTTPException(status_code=403, detail="Solo super_admin puede actualizar precios")

    producto = await collection_productos.find_one({"_id": ObjectId(producto_id)})
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    precios_actuales = producto.get("precios", {}) or {}
    precios_actuales.update(precios)

    await collection_productos.update_one(
        {"_id": ObjectId(producto_id)},
        {"$set": {"precios": precios_actuales}}
    )

    return {"msg": "Precios actualizados correctamente", "precios": precios_actuales}


# =========================================================
# ⭐ Actualizar comisión GLOBAL del producto (SUPER_ADMIN)
# =========================================================
@router.patch("/{producto_id}/comision", response_model=dict)
async def actualizar_comision_global(
    producto_id: str,
    comision: float = Query(..., ge=0, le=100, description="Porcentaje global (0-100)"),
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol")
    if rol != "super_admin":
        raise HTTPException(status_code=403, detail="Solo super_admin puede actualizar comisiones")

    producto = await collection_productos.find_one({"_id": ObjectId(producto_id)})
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    await collection_productos.update_one(
        {"_id": ObjectId(producto_id)},
        {"$set": {"comision": comision}}
    )

    return {
        "msg": "Comisión global actualizada. Las sedes con override propio no se ven afectadas.",
        "producto": producto.get("nombre"),
        "comision_anterior": producto.get("comision", 0),
        "comision_nueva": comision,
    }


# =========================================================
# ⭐ Comisión por sede — vista para super_admin
# =========================================================
@router.get("/{producto_id}/comision/sedes", response_model=dict)
async def ver_comisiones_por_sede(
    producto_id: str,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol")
    if rol != "super_admin":
        raise HTTPException(status_code=403, detail="Solo super_admin puede ver esto")

    producto = await collection_productos.find_one({"_id": ObjectId(producto_id)})
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    producto_id_campo = producto.get("id") or str(producto["_id"])
    comision_global = float(producto.get("comision", 0))

    inventarios = await collection_inventarios.find(
        {"producto_id": producto_id_campo}
    ).to_list(None)

    sedes_detalle = []
    for inv in inventarios:
        comision_override = inv.get("comision")
        sedes_detalle.append({
            "sede_id": inv.get("sede_id"),
            "comision_efectiva": float(comision_override) if comision_override is not None else comision_global,
            "tiene_override": comision_override is not None,
            "comision_override": float(comision_override) if comision_override is not None else None,
            "comision_global": comision_global,
        })

    return {
        "producto": producto.get("nombre"),
        "producto_id": producto_id_campo,
        "comision_global": comision_global,
        "sedes": sedes_detalle,
    }