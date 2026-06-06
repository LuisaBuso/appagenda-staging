from fastapi import APIRouter, HTTPException, Depends, Query
from app.inventary.submodulos.inventarios.models import AjusteInventario, Inventario
from app.database.mongo import collection_inventarios, collection_productos
from app.auth.routes import get_current_user
from datetime import datetime
from typing import List, Optional
from bson import ObjectId
from app.database.mongo import collection_inventory_reports, collection_locales
from app.utils.timezone import today

router = APIRouter(prefix="/inventarios")


# =========================================================
# 🧩 Helper para convertir ObjectId
# =========================================================
def inventario_to_dict(inv):
    inv["_id"] = str(inv["_id"])
    return inv


# =========================================================
# 📊 Listar inventario (con lógica multi-sede)
# =========================================================
@router.get("/", response_model=List[dict])
async def listar_inventario(
    sede_id: Optional[str] = Query(None, description="Filtrar por sede específica"),
    stock_bajo: Optional[bool] = Query(None, description="Solo productos con stock bajo"),
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol")
    
    if rol not in ["admin_sede", "super_admin", "call_center", "recepcionista"]:
        raise HTTPException(status_code=403, detail="No autorizado para consultar inventario")
    
    query = {}
    if rol == ["admin_sede", "call_center", "recepcionista"]:
        user_sede_id = current_user.get("sede_id")
        if not user_sede_id:
            raise HTTPException(status_code=403, detail="Usuario sin sede asignada")
        query["sede_id"] = user_sede_id
    elif sede_id:
        query["sede_id"] = sede_id
    
    if stock_bajo:
        inventarios = await collection_inventarios.find(query).to_list(None)
        inventarios = [inv for inv in inventarios if inv["stock_actual"] < inv["stock_minimo"]]
    else:
        inventarios = await collection_inventarios.find(query).to_list(None)
    
    resultado = []
    for inv in inventarios:
        inv_dict = inventario_to_dict(inv)
        
        producto = await collection_productos.find_one({"id": inv["producto_id"]})
        if producto:
            inv_dict["producto_nombre"] = producto.get("nombre")
            inv_dict["producto_codigo"] = producto.get("tipo_codigo")
            inv_dict["categoria"] = producto.get("categoria")
            # ⭐ Mostrar comisión efectiva: override de sede si existe, global como fallback
            comision_global = float(producto.get("comision", 0))
            comision_override = inv_dict.get("comision")
            inv_dict["comision_efectiva"] = float(comision_override) if comision_override is not None else comision_global
            inv_dict["comision_global"] = comision_global
            inv_dict["tiene_comision_override"] = comision_override is not None
        
        resultado.append(inv_dict)
    
    return resultado


# =========================================================
# 📊 Ver inventario consolidado (SOLO SUPER_ADMIN)
# =========================================================
@router.get("/consolidado", response_model=List[dict])
async def inventario_consolidado(
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol")
    if rol != "super_admin":
        raise HTTPException(status_code=403, detail="Solo super_admin puede ver inventario consolidado")
    
    pipeline = [
        {
            "$group": {
                "_id": "$producto_id",
                "stock_total": {"$sum": "$stock_actual"},
                "stock_minimo_promedio": {"$avg": "$stock_minimo"},
                "sedes": {"$addToSet": "$sede_id"}
            }
        }
    ]
    
    resultado = await collection_inventarios.aggregate(pipeline).to_list(None)
    
    consolidado = []
    for item in resultado:
        producto = await collection_productos.find_one({"id": item["_id"]})
        if producto:
            consolidado.append({
                "producto_id": item["_id"],
                "producto_nombre": producto.get("nombre"),
                "producto_codigo": producto.get("tipo_codigo"),
                "stock_total": item["stock_total"],
                "stock_minimo_promedio": round(item["stock_minimo_promedio"], 2),
                "numero_sedes": len(item["sedes"]),
                "sedes": item["sedes"]
            })
    
    return consolidado


# =========================================================
# ➕ Crear inventario inicial (admin_sede y super_admin)
# =========================================================
@router.post("/", response_model=dict)
async def crear_inventario(
    inventario: Inventario,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol")
    
    if rol not in ["admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado para crear inventario")
    
    data = inventario.dict()
    
    if rol == "admin_sede":
        user_sede_id = current_user.get("sede_id")
        if not user_sede_id:
            raise HTTPException(status_code=403, detail="Usuario sin sede asignada")
        data["sede_id"] = user_sede_id
    elif not data.get("sede_id"):
        raise HTTPException(status_code=400, detail="Debe especificar sede_id")
    
    producto = await collection_productos.find_one({"id": data["producto_id"]})
    if not producto:
        raise HTTPException(status_code=404, detail=f"Producto {data['producto_id']} no encontrado")
    
    existe = await collection_inventarios.find_one({
        "producto_id": data["producto_id"],
        "sede_id": data["sede_id"]
    })
    if existe:
        raise HTTPException(
            status_code=400, 
            detail=f"Ya existe inventario para {producto['nombre']} en la sede {data['sede_id']}. Use el endpoint de ajuste para modificar el stock."
        )
    
    documento = {
        "nombre": producto["nombre"],
        "producto_id": data["producto_id"],
        "sede_id": data["sede_id"],
        "stock_actual": data["stock_actual"],
        "stock_minimo": data["stock_minimo"],
        # ⭐ comision: None por defecto → usará el global del producto
        # Se puede configurar después con PATCH /{sede_id}/{producto_id}/comision
        "comision": None,
        "fecha_creacion": datetime.now(),
        "fecha_ultima_actualizacion": datetime.now(),
        "creado_por": current_user["email"]
    }
    
    result = await collection_inventarios.insert_one(documento)
    documento["_id"] = str(result.inserted_id)
    
    print(f"✅ Inventario creado: {producto['nombre']} - Sede {documento['sede_id']} - Stock inicial: {documento['stock_actual']}")
    
    return {"msg": "Inventario creado exitosamente", "inventario": documento}


# =========================================================
# 🔧 Ajuste manual de inventario
# =========================================================
@router.patch("/{inventario_id}/ajustar", response_model=dict)
async def ajustar_inventario(
    inventario_id: str,
    ajuste: AjusteInventario,
    current_user: dict = Depends(get_current_user),
):

    rol = current_user.get("rol")
    if rol not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado para ajustar inventario")

    inventario = await collection_inventarios.find_one({"_id": ObjectId(inventario_id)})
    if not inventario:
        raise HTTPException(status_code=404, detail="Inventario no encontrado")

    if rol in ["admin_sede", "recepcionista"]:
        user_sede_id = current_user.get("sede_id")
        if inventario["sede_id"] != user_sede_id:
            raise HTTPException(status_code=403, detail="No puede ajustar inventario de otra sede")

    nuevo_stock = inventario["stock_actual"] + ajuste.cantidad_ajuste
    if nuevo_stock < 0:
        raise HTTPException(
            status_code=400,
            detail=f"El ajuste resultaría en stock negativo ({nuevo_stock})",
        )

    # ⏰ Timezone de la sede
    sede = await collection_locales.find_one({"id": inventario["sede_id"]})
    fecha_actual = today(sede).replace(tzinfo=None) if sede else datetime.now()

    await collection_inventarios.update_one(
        {"_id": ObjectId(inventario_id)},
        {"$set": {"stock_actual": nuevo_stock, "fecha_ultima_actualizacion": fecha_actual}},
    )

    # 📋 Determinar tipo para inventory_reports
    if ajuste.cantidad_ajuste > 0:
        tipo_reporte = "entrada"
        motivo_reporte = ajuste.motivo or "Ajuste manual (entrada rápida)"
    else:
        tipo_reporte = "salida"
        motivo_reporte = ajuste.motivo or "Ajuste manual (salida rápida)"

    reporte = {
        "tipo": tipo_reporte,
        "sede_id": inventario["sede_id"],
        "motivo": motivo_reporte,
        "observaciones": ajuste.observaciones,
        "items": [
            {
                "producto_id": inventario["producto_id"],
                "nombre_producto": inventario.get("nombre", inventario["producto_id"]),
                "cantidad": abs(ajuste.cantidad_ajuste),
                "stock_anterior": inventario["stock_actual"],
                "stock_nuevo": nuevo_stock,
            }
        ],
        "fecha": fecha_actual,
        "creado_por": current_user["email"],
        "es_ajuste_rapido": ajuste.motivo is None,  # flag útil para filtrar en reportes
    }
    await collection_inventory_reports.insert_one(reporte)

    operacion = "agregó" if ajuste.cantidad_ajuste > 0 else "restó"
    print(f"🔧 AJUSTE: {inventario['sede_id']} - {inventario.get('nombre')} - Se {operacion} {abs(ajuste.cantidad_ajuste)} u.")

    return {
        "msg": "Ajuste aplicado correctamente",
        "producto_nombre": inventario.get("nombre"),
        "stock_anterior": inventario["stock_actual"],
        "stock_nuevo": nuevo_stock,
        "ajuste_realizado": ajuste.cantidad_ajuste,
        "tipo_reporte": tipo_reporte,
    }

# =========================================================
# ⚠️ Alertas de stock bajo — versión eficiente
# =========================================================
@router.get("/alertas/stock-bajo", response_model=List[dict])
async def alertas_stock_bajo(
    sede_id: Optional[str] = Query(
        None,
        description="Solo super_admin: filtrar alertas por sede específica"
    ),
    current_user: dict = Depends(get_current_user),
):
    """
    Retorna productos con stock_actual < stock_minimo.

    - admin_sede / recepcionista: siempre ven solo su sede efectiva
      (ya resuelta por el scope dinámico en get_current_user vía X-Sede-Id).
    - super_admin: ve todas las sedes, o filtra con ?sede_id=SD-XXXX
      (alternativamente puede usar el header X-Sede-Id para scope dinámico).

    Eficiencia: un solo pipeline de aggregation + un fetch batch de productos.
    """
    rol = current_user.get("rol")

    if rol not in ["admin_sede", "super_admin", "recepcionista"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    # ── Determinar filtro de sede ────────────────────────────────────────
    if rol in ["admin_sede", "recepcionista"]:
        # Scope ya resuelto por get_current_user (X-Sede-Id o sede principal)
        effective_sede = current_user.get("sede_id")
        if not effective_sede:
            raise HTTPException(status_code=403, detail="Usuario sin sede asignada")
    else:
        # super_admin: query param tiene precedencia, luego X-Sede-Id (sede_id del token)
        effective_sede = sede_id or current_user.get("sede_id")
        # Si no viene ninguno → None → trae todas las sedes

    # ── 1. Pipeline: filtrar stock bajo directo en MongoDB ───────────────
    match_stage: dict = {
        "$expr": {"$lt": ["$stock_actual", "$stock_minimo"]}
    }
    if effective_sede:
        match_stage["sede_id"] = effective_sede

    pipeline = [
        {"$match": match_stage},
        {
            "$project": {
                "_id": 1,
                "producto_id": 1,
                "sede_id": 1,
                "nombre": 1,
                "stock_actual": 1,
                "stock_minimo": 1,
                "fecha_ultima_actualizacion": 1,
                "diferencia": {"$subtract": ["$stock_minimo", "$stock_actual"]},
            }
        },
        {"$sort": {"diferencia": -1}},  # más críticos primero
    ]

    inventarios = await collection_inventarios.aggregate(pipeline).to_list(None)

    if not inventarios:
        return []

    # ── 2. Batch fetch de productos (UNA sola query) ─────────────────────
    producto_ids = list({inv["producto_id"] for inv in inventarios})
    productos_cursor = collection_productos.find(
        {"id": {"$in": producto_ids}},
        {"id": 1, "nombre": 1, "tipo_codigo": 1, "categoria": 1}
    )
    productos_list = await productos_cursor.to_list(None)
    productos_map = {p["id"]: p for p in productos_list}

    # ── 3. Armar respuesta enriquecida ───────────────────────────────────
    alertas = []
    for inv in inventarios:
        inv["_id"] = str(inv["_id"])
        producto = productos_map.get(inv["producto_id"], {})

        alertas.append({
            **inv,
            "producto_nombre": producto.get("nombre") or inv.get("nombre"),
            "producto_codigo": producto.get("tipo_codigo"),
            "categoria": producto.get("categoria"),
        })

        print(
            f"⚠️ STOCK BAJO: {inv['sede_id']} - "
            f"{producto.get('nombre', inv.get('nombre', 'N/A'))} "
            f"({inv['stock_actual']}/{inv['stock_minimo']}) déficit: {inv['diferencia']}"
        )

    return alertas

# =========================================================
# 📦 Obtener inventario específico por producto y sede
# =========================================================
@router.get("/producto/{producto_id}", response_model=dict)
async def obtener_inventario_producto(
    producto_id: str,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol")
    
    if rol not in ["admin_sede", "super_admin", "call_center", "recepcionista"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    query = {"producto_id": producto_id}
    if rol == ["admin_sede", "call_center", "recepcionista"]:
        user_sede_id = current_user.get("sede_id")
        if not user_sede_id:
            raise HTTPException(status_code=403, detail="Usuario sin sede asignada")
        query["sede_id"] = user_sede_id
    
    inventario = await collection_inventarios.find_one(query)
    
    if not inventario:
        return {
            "producto_id": producto_id,
            "sede_id": current_user.get("sede_id") if rol == ["admin_sede", "call_center", "recepcionista"] else None,
            "stock_actual": 0,
            "stock_minimo": 0,
            "existe_registro": False
        }
    
    inv_dict = inventario_to_dict(inventario)
    inv_dict["existe_registro"] = True
    
    producto = await collection_productos.find_one({"id": producto_id})
    if producto:
        inv_dict["producto_nombre"] = producto.get("nombre")
        inv_dict["producto_codigo"] = producto.get("tipo_codigo")
        # ⭐ Enriquecer con info de comisión
        comision_global = float(producto.get("comision", 0))
        comision_override = inv_dict.get("comision")
        inv_dict["comision_efectiva"] = float(comision_override) if comision_override is not None else comision_global
        inv_dict["comision_global"] = comision_global
        inv_dict["tiene_comision_override"] = comision_override is not None
    
    return inv_dict


# =========================================================
# ⭐ NUEVO: Configurar comisión por sede (override)
# =========================================================
@router.patch("/{sede_id}/{producto_id}/comision", response_model=dict)
async def actualizar_comision_sede(
    sede_id: str,
    producto_id: str,
    comision: Optional[float] = Query(
        None,
        ge=0,
        le=100,
        description="Porcentaje de comisión para esta sede (0-100)"
    ),
    eliminar_override: bool = Query(
        False,
        description="Si True, elimina el override y vuelve al % global del producto"
    ),
    current_user: dict = Depends(get_current_user)
):
    """
    Configura (o elimina) el porcentaje de comisión de un producto
    específicamente para esta sede, sin afectar las demás.

    Resolución en ventas y citas:
      1. inventario.comision  → override de esta sede   ← este endpoint
      2. producto.comision    → % global del producto   ← fallback automático

    Ejemplos:
      PATCH /inventarios/SEDE01/PROD001/comision?comision=20
        → Esta sede paga 20% al estilista por este producto
      PATCH /inventarios/SEDE01/PROD001/comision?eliminar_override=true
        → Vuelve al % global del producto
    """
    rol = current_user.get("rol")
    if rol not in ["super_admin", "admin_sede"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    # admin_sede solo puede editar su propia sede
    if rol == "admin_sede" and current_user.get("sede_id") != sede_id:
        raise HTTPException(status_code=403, detail="Solo puedes gestionar comisiones de tu propia sede")

    inventario = await collection_inventarios.find_one(
        {"producto_id": producto_id, "sede_id": sede_id}
    )
    if not inventario:
        raise HTTPException(
            status_code=404,
            detail=f"No existe inventario para producto '{producto_id}' en sede '{sede_id}'"
        )

    producto = await collection_productos.find_one({"id": producto_id})
    comision_global = float(producto.get("comision", 0)) if producto else 0

    if eliminar_override:
        await collection_inventarios.update_one(
            {"producto_id": producto_id, "sede_id": sede_id},
            {
                "$unset": {"comision": "", "comision_actualizada_por": "", "comision_actualizada_en": ""},
            }
        )
        return {
            "msg": "Override eliminado. Se usará la comisión global del producto.",
            "sede_id": sede_id,
            "producto_id": producto_id,
            "comision_efectiva": comision_global,
            "tiene_override": False,
        }

    if comision is None:
        raise HTTPException(
            status_code=400,
            detail="Envía ?comision=<valor> para configurar, o ?eliminar_override=true para quitar el override"
        )

    comision_anterior = inventario.get("comision")

    await collection_inventarios.update_one(
        {"producto_id": producto_id, "sede_id": sede_id},
        {"$set": {
            "comision": comision,
            "comision_actualizada_por": current_user.get("email"),
            "comision_actualizada_en": datetime.now(),
        }}
    )

    return {
        "msg": "Comisión de sede actualizada correctamente",
        "sede_id": sede_id,
        "producto_id": producto_id,
        "producto_nombre": producto.get("nombre") if producto else None,
        "comision_anterior": comision_anterior,        # None = no había override antes
        "comision_nueva": comision,
        "comision_global": comision_global,            # referencia del global
        "tiene_override": True,
        "actualizado_por": current_user.get("email"),
    }

# =========================================================
# ⭐ Agregar este endpoint al router de INVENTARIOS
#    para gestionar el override de comisión por sede
# =========================================================

# PATCH /inventarios/{sede_id}/{producto_id}/comision
@router.patch("/{sede_id}/{producto_id}/comision", response_model=dict)
async def actualizar_comision_sede(
    sede_id: str,
    producto_id: str,
    comision: Optional[float] = Query(
        None,
        ge=0,
        le=100,
        description="Porcentaje de comisión para esta sede (0-100). Enviar null para eliminar el override y usar el global."
    ),
    eliminar_override: bool = Query(
        False,
        description="Si True, elimina el override de esta sede y vuelve al global del producto."
    ),
    current_user: dict = Depends(get_current_user)
):
    """
    Establece (o elimina) el override de comisión de un producto en una sede específica.

    Ejemplos de uso:
      • PATCH /inventarios/SEDE01/PROD001/comision?comision=20
          → Esta sede pagará 20% al estilista por este producto
      • PATCH /inventarios/SEDE01/PROD001/comision?eliminar_override=true
          → Vuelve a usar el porcentaje global del producto

    La resolución en ventas/citas usa siempre:
      1. override de sede  (este campo en inventarios)
      2. fallback global   (campo comision en productos)
    """
    rol = current_user.get("rol")
    if rol not in ["super_admin", "admin_sede"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    # admin_sede solo puede editar su propia sede
    if rol == "admin_sede" and current_user.get("sede_id") != sede_id:
        raise HTTPException(status_code=403, detail="Solo puedes gestionar tu propia sede")

    inventario = await collection_inventarios.find_one(
        {"producto_id": producto_id, "sede_id": sede_id}
    )
    if not inventario:
        raise HTTPException(
            status_code=404,
            detail=f"No existe inventario para producto '{producto_id}' en sede '{sede_id}'"
        )

    if eliminar_override:
        # Quitar el campo comision del inventario → vuelve al global
        await collection_inventarios.update_one(
            {"producto_id": producto_id, "sede_id": sede_id},
            {"$unset": {"comision": ""}}
        )
        return {
            "msg": "Override eliminado. Esta sede usará ahora la comisión global del producto.",
            "sede_id": sede_id,
            "producto_id": producto_id,
            "comision_efectiva": "global",
        }

    if comision is None:
        raise HTTPException(
            status_code=400,
            detail="Debes enviar ?comision=<valor> o ?eliminar_override=true"
        )

    comision_anterior = inventario.get("comision")  # puede ser None si no había override

    await collection_inventarios.update_one(
        {"producto_id": producto_id, "sede_id": sede_id},
        {"$set": {
            "comision": comision,
            "comision_actualizada_por": current_user.get("email"),
            "comision_actualizada_en": datetime.now(),
        }}
    )

    return {
        "msg": "Override de comisión actualizado para esta sede.",
        "sede_id": sede_id,
        "producto_id": producto_id,
        "comision_anterior": comision_anterior,  # None si es la primera vez
        "comision_nueva": comision,
        "actualizado_por": current_user.get("email"),
    }