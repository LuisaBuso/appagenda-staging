# app/commissions/comision_context.py
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo
from typing import Optional
import re
from bson import ObjectId

from app.commissions.comision_engine import PeriodoConfig, get_periodo_actual, calcular_valor_comision_item
from app.database.mongo import (
    collection_locales,
    collection_commissions,
    collection_sales,
    collection_invoices,
)


# ══════════════════════════════════════════════════════════════
# CONTEXTO — dataclass interno, no toca la BD
# ══════════════════════════════════════════════════════════════

@dataclass
class ComisionContexto:
    cantidad_actual: int
    cantidad_acumulada_periodo: int
    moneda_sede: str
    inicio_periodo: date
    fin_periodo: date


# ══════════════════════════════════════════════════════════════
# HELPER — fecha local de la sede
# ══════════════════════════════════════════════════════════════

def _hoy_sede(sede: dict) -> date:
    zona = sede.get("zona_horaria", "America/Bogota")
    return datetime.now(ZoneInfo(zona)).date()


def _ahora_sede(sede: dict) -> datetime:
    zona = sede.get("zona_horaria", "America/Bogota")
    return datetime.now(ZoneInfo(zona))


# ══════════════════════════════════════════════════════════════
# CONSTRUIR CONTEXTO — consulta async pre-cálculo
# ══════════════════════════════════════════════════════════════

async def construir_contexto(
    *,
    profesional_id: Optional[str],
    sede_id: str,
    cantidad_actual: int,
    moneda_sede: str,
    vendedor_nombre: Optional[str] = None,
    hoy: Optional[date] = None,
) -> ComisionContexto:
    """
    Consulta MongoDB para saber cuántas unidades lleva el vendedor
    en el período activo de la sede. Resultado va al ComisionContexto.
    La fecha usa la zona horaria de la sede para evitar desfases.
    """
    sede = await collection_locales.find_one({"sede_id": sede_id})
    hoy = hoy or _hoy_sede(sede or {})

    periodo_raw = (sede or {}).get("comision_periodo_config", {})
    periodo_cfg = PeriodoConfig(**periodo_raw) if periodo_raw else PeriodoConfig()
    inicio, fin = get_periodo_actual(periodo_cfg, hoy)

    cantidad_acumulada = 0

    if profesional_id:
        await asegurar_productos_legacy_periodo(
            profesional_id=profesional_id,
            sede_id=sede_id,
            vendedor_nombre=vendedor_nombre,
            moneda_sede=moneda_sede,
            inicio_periodo=inicio,
            fin_periodo=fin,
        )

        pipeline = [
            {"$match": {
                "profesional_id": profesional_id,
                "sede_id": sede_id,
                "estado": "pendiente",
                "periodo_inicio": inicio.strftime("%Y-%m-%d"),
            }},
            {"$unwind": "$productos_detalle"},
            {"$match": {
                "productos_detalle.fecha": {
                    "$gte": inicio.strftime("%Y-%m-%d"),
                    "$lte": fin.strftime("%Y-%m-%d"),
                }
            }},
            {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$productos_detalle.cantidad", 1]}}}}
        ]
        resultado = await collection_commissions.aggregate(pipeline).to_list(1)
        cantidad_acumulada = int(resultado[0]["total"] or 0) if resultado else 0

    return ComisionContexto(
        cantidad_actual=cantidad_actual,
        cantidad_acumulada_periodo=cantidad_acumulada,
        moneda_sede=moneda_sede,
        inicio_periodo=inicio,
        fin_periodo=fin,
    )


# ══════════════════════════════════════════════════════════════
# RECÁLCULO RETROACTIVO — solo para tipo escalonado
# ══════════════════════════════════════════════════════════════

def _cantidad_producto_detalle(item: dict) -> int:
    try:
        cantidad = int(item.get("cantidad") or 0)
        if cantidad > 0:
            return cantidad
    except (TypeError, ValueError):
        pass

    match = re.search(r"\(x(\d+)\)", str(item.get("descripcion", "")))
    if match:
        return max(int(match.group(1)), 1)
    return 1


def _subtotal_producto_detalle(item: dict) -> float:
    for campo in ("valor_producto", "valor_productos", "subtotal"):
        if item.get(campo) is not None:
            try:
                return float(item.get(campo) or 0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def _valor_comision_producto(item: dict) -> float:
    for campo in ("valor_comision_productos", "valor_comision", "comision", "comision_valor"):
        if item.get(campo) is not None:
            try:
                return float(item.get(campo) or 0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def _actualizar_item_producto(
    item: dict,
    *,
    nuevo_tipo: str,
    nuevo_valor: float,
) -> float:
    cantidad = _cantidad_producto_detalle(item)
    subtotal = _subtotal_producto_detalle(item)
    nueva_comision = calcular_valor_comision_item(
        tipo=nuevo_tipo,
        valor=nuevo_valor,
        subtotal=subtotal,
        cantidad=cantidad,
    )

    item["cantidad"] = cantidad
    item["valor_comision"] = nueva_comision
    item["valor_comision_productos"] = nueva_comision
    item["comision_tipo"] = nuevo_tipo
    item["comision_valor_aplicado"] = nuevo_valor
    return nueva_comision


def _actualizar_item_venta(
    item: dict,
    *,
    nuevo_tipo: str,
    nuevo_valor: float,
) -> float:
    cantidad = _cantidad_producto_detalle(item)
    subtotal = _subtotal_producto_detalle(item)
    nueva_comision = calcular_valor_comision_item(
        tipo=nuevo_tipo,
        valor=nuevo_valor,
        subtotal=subtotal,
        cantidad=cantidad,
    )

    item["cantidad"] = cantidad
    item["comision"] = nueva_comision
    item["comision_tipo"] = nuevo_tipo
    item["comision_porcentaje"] = nuevo_valor
    if "comision_valor" in item:
        item["comision_valor"] = nueva_comision
    return nueva_comision


def _fecha_doc_a_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, dict) and "$date" in value:
        value = value["$date"]
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    return datetime.now().date()


def _build_sales_seller_query(profesional_id: str, vendedor_nombre: Optional[str]) -> list[dict]:
    condiciones = [
        {"profesional_id": profesional_id},
        {"items.profesional_id": profesional_id},
    ]
    if vendedor_nombre:
        nombre_regex = f"^{re.escape(vendedor_nombre.strip())}$"
        condiciones.extend([
            {"vendido_por": {"$regex": nombre_regex, "$options": "i"}},
            {"profesional_nombre": {"$regex": nombre_regex, "$options": "i"}},
        ])
    return condiciones


async def asegurar_productos_legacy_periodo(
    *,
    profesional_id: str,
    sede_id: str,
    vendedor_nombre: Optional[str],
    moneda_sede: str,
    inicio_periodo: date,
    fin_periodo: date,
) -> int:
    inicio_str = inicio_periodo.strftime("%Y-%m-%d")
    fin_str = fin_periodo.strftime("%Y-%m-%d")
    inicio_dt = datetime.combine(inicio_periodo, datetime.min.time())
    fin_dt = datetime.combine(fin_periodo, datetime.max.time())

    sede = await collection_locales.find_one({"sede_id": sede_id}) or {}
    comision_doc = await collection_commissions.find_one({
        "profesional_id": profesional_id,
        "sede_id": sede_id,
        "estado": "pendiente",
        "periodo_inicio": inicio_str,
    })

    existentes = set()
    if comision_doc:
        for item in comision_doc.get("productos_detalle", []):
            venta_id = item.get("venta_id") or item.get("origen_id")
            producto_id = item.get("producto_id")
            if venta_id and producto_id:
                existentes.add(f"{venta_id}:{producto_id}")

    ventas = await collection_sales.find({
        "sede_id": sede_id,
        "estado_factura": "facturado",
        "fecha_pago": {"$gte": inicio_dt, "$lte": fin_dt},
        "items.tipo": "producto",
        "$or": _build_sales_seller_query(profesional_id, vendedor_nombre),
    }).to_list(None)

    nuevos_detalles = []
    for venta in ventas:
        venta_id = str(venta.get("_id"))
        fecha_venta = _fecha_doc_a_date(venta.get("fecha_pago")).strftime("%Y-%m-%d")
        for item in venta.get("items", []):
            if item.get("tipo") != "producto":
                continue
            producto_id = item.get("producto_id")
            key = f"{venta_id}:{producto_id}"
            if key in existentes:
                continue

            cantidad = _cantidad_producto_detalle(item)
            subtotal = _subtotal_producto_detalle(item)
            valor_comision = round(_valor_comision_producto(item), 2)
            nuevos_detalles.append({
                "tipo": "venta_directa",
                "venta_id": venta_id,
                "fecha": fecha_venta,
                "descripcion": f"{item.get('nombre', 'Producto')} (x{cantidad})",
                "producto_id": producto_id,
                "producto_nombre": item.get("nombre"),
                "cantidad": cantidad,
                "valor_servicio": 0,
                "valor_comision_servicio": 0,
                "valor_producto": subtotal,
                "valor_productos": subtotal,
                "valor_comision": valor_comision,
                "valor_comision_productos": valor_comision,
                "comision_tipo": item.get("comision_tipo"),
                "comision_valor_aplicado": item.get("comision_porcentaje"),
                "numero_comprobante": venta.get("numero_comprobante"),
                "registrado_por": venta.get("facturado_por") or venta.get("vendido_por"),
                "legacy_migrado": True,
            })
            existentes.add(key)

    if not nuevos_detalles:
        return 0

    ahora = _ahora_sede(sede).replace(tzinfo=None)
    total_legacy = round(sum(float(i.get("valor_comision", 0)) for i in nuevos_detalles), 2)
    total_productos_valor = round(sum(float(i.get("valor_producto", 0)) for i in nuevos_detalles), 2)

    if comision_doc:
        await collection_commissions.update_one(
            {"_id": comision_doc["_id"]},
            {
                "$push": {"productos_detalle": {"$each": nuevos_detalles}},
                "$inc": {
                    "total_comisiones": total_legacy,
                    "total_productos": len(nuevos_detalles),
                    "total_servicios": total_productos_valor,
                },
                "$set": {"ultima_actualizacion": ahora, "periodo_fin": fin_str},
            }
        )
    else:
        await collection_commissions.insert_one({
            "profesional_id": profesional_id,
            "profesional_nombre": vendedor_nombre or profesional_id,
            "sede_id": sede_id,
            "sede_nombre": sede.get("nombre", ""),
            "moneda": moneda_sede,
            "tipo_comision": (sede.get("reglas_comision") or {}).get("tipo", "productos"),
            "total_servicios": total_productos_valor,
            "total_productos": len(nuevos_detalles),
            "total_comisiones": total_legacy,
            "servicios_detalle": [],
            "productos_detalle": nuevos_detalles,
            "periodo_inicio": inicio_str,
            "periodo_fin": fin_str,
            "estado": "pendiente",
            "creado_en": ahora,
        })

    print(f"Productos legacy migrados a comisiones: {len(nuevos_detalles)} para {profesional_id}")
    return len(nuevos_detalles)


def _sumar_comisiones_servicios(servicios: list[dict]) -> float:
    total = 0.0
    for item in servicios or []:
        total += float(
            item.get("valor_comision")
            or item.get("valor_comision_servicio")
            or 0
        )
    return round(total, 2)


async def _recalcular_comisiones_periodo_legacy(
    *,
    profesional_id: str,
    sede_id: str,
    nuevo_porcentaje: float,
    nuevo_tipo: str,          # "porcentaje" | "fijo"
    inicio_periodo: date,
    fin_periodo: date,
) -> None:
    """
    Cuando el vendedor sube de nivel escalonado, recalcula todas las
    comisiones de productos del período activo al nuevo porcentaje/valor.
    Actualiza collection_commissions directamente.
    Solo actúa si el documento de comisión está en estado 'pendiente'.
    """
    sede = await collection_locales.find_one({"sede_id": sede_id})
    ahora = _ahora_sede(sede or {}).replace(tzinfo=None)

    comision_doc = await collection_commissions.find_one({
        "profesional_id": profesional_id,
        "sede_id": sede_id,
        "estado": "pendiente",
        # Confirmar que el doc pertenece al período activo
        "periodo_inicio": {"$gte": inicio_periodo.strftime("%Y-%m-%d")},
        "periodo_fin":    {"$lte": fin_periodo.strftime("%Y-%m-%d")},
    })

    if not comision_doc:
        print(f"⚠️ recalcular_comisiones_periodo: no se encontró doc pendiente para {profesional_id}")
        return

    detalle = comision_doc.get("productos_detalle", [])
    if not detalle:
        return

    nuevo_total = 0.0
    for item in detalle:
        valor_producto = float(item.get("valor_producto", item.get("valor_comision", 0)))
        if nuevo_tipo == "porcentaje":
            item["valor_comision"] = round((valor_producto * nuevo_porcentaje) / 100, 2)
        else:
            # fijo: el valor es el monto fijo, independiente del subtotal
            item["valor_comision"] = round(float(nuevo_porcentaje), 2)
        nuevo_total += item["valor_comision"]

    nuevo_total = round(nuevo_total, 2)

    await collection_commissions.update_one(
        {"_id": comision_doc["_id"]},
        {"$set": {
            "productos_detalle": detalle,
            "total_comisiones": nuevo_total,
            "ultima_actualizacion": ahora,
            "nivel_escalonado_actual": nuevo_porcentaje,
        }}
    )
    print(f"♻️ Comisiones recalculadas → {nuevo_porcentaje}{'%' if nuevo_tipo == 'porcentaje' else ' (fijo)'} para {profesional_id} | total: {nuevo_total}")


async def recalcular_comisiones_periodo_v2(
    *,
    profesional_id: str,
    sede_id: str,
    nuevo_porcentaje: float,
    nuevo_tipo: str,
    inicio_periodo: date,
    fin_periodo: date,
) -> None:
    """
    Recalcula todos los productos pendientes del periodo activo con el nivel
    escalonado final.
    """
    sede = await collection_locales.find_one({"sede_id": sede_id})
    ahora = _ahora_sede(sede or {}).replace(tzinfo=None)
    inicio_str = inicio_periodo.strftime("%Y-%m-%d")
    fin_str = fin_periodo.strftime("%Y-%m-%d")

    comision_docs = await collection_commissions.find({
        "profesional_id": profesional_id,
        "sede_id": sede_id,
        "estado": "pendiente",
        "periodo_inicio": inicio_str,
    }).to_list(None)

    if not comision_docs:
        print(f"recalcular_comisiones_periodo: no se encontro doc pendiente para {profesional_id}")
        return

    docs_actualizados = 0
    referencias_producto: set[str] = set()
    for comision_doc in comision_docs:
        detalle_original = comision_doc.get("productos_detalle", [])
        if not detalle_original:
            continue

        nuevo_total_productos = 0.0
        total_unidades_productos = 0
        detalle_actualizado = []
        for item in detalle_original:
            fecha_item = str(item.get("fecha", ""))
            if inicio_str <= fecha_item <= fin_str:
                nuevo_total_productos += _actualizar_item_producto(
                    item,
                    nuevo_tipo=nuevo_tipo,
                    nuevo_valor=nuevo_porcentaje,
                )
                ref_id = item.get("venta_id") or item.get("origen_id")
                if ref_id:
                    referencias_producto.add(str(ref_id))
            else:
                nuevo_total_productos += _valor_comision_producto(item)
            total_unidades_productos += _cantidad_producto_detalle(item)
            detalle_actualizado.append(item)

        total_servicios = _sumar_comisiones_servicios(comision_doc.get("servicios_detalle", []))
        nuevo_total = round(total_servicios + nuevo_total_productos, 2)

        await collection_commissions.update_one(
            {"_id": comision_doc["_id"]},
            {"$set": {
                "productos_detalle": detalle_actualizado,
                "total_comisiones": nuevo_total,
                "total_productos": total_unidades_productos,
                "ultima_actualizacion": ahora,
                "nivel_escalonado_actual": nuevo_porcentaje,
                "nivel_escalonado_tipo": nuevo_tipo,
            }}
        )
        docs_actualizados += 1

    ventas_actualizadas = await recalcular_items_productos_en_documentos(
        collection=collection_sales,
        profesional_id=profesional_id,
        sede_id=sede_id,
        vendedor_nombre=None,
        referencias=referencias_producto,
        inicio_periodo=inicio_periodo,
        fin_periodo=fin_periodo,
        nuevo_tipo=nuevo_tipo,
        nuevo_valor=nuevo_porcentaje,
        total_field="comision_productos_total",
    )
    facturas_actualizadas = await recalcular_items_productos_en_documentos(
        collection=collection_invoices,
        profesional_id=profesional_id,
        sede_id=sede_id,
        vendedor_nombre=None,
        referencias=referencias_producto,
        inicio_periodo=inicio_periodo,
        fin_periodo=fin_periodo,
        nuevo_tipo=nuevo_tipo,
        nuevo_valor=nuevo_porcentaje,
        total_field=None,
    )

    print(
        f"Comisiones recalculadas a {nuevo_porcentaje}"
        f"{'%' if nuevo_tipo == 'porcentaje' else ' por unidad'} para {profesional_id}. "
        f"Docs: {docs_actualizados}, ventas: {ventas_actualizadas}, facturas: {facturas_actualizadas}"
    )


async def recalcular_items_productos_en_documentos(
    *,
    collection,
    profesional_id: str,
    sede_id: str,
    vendedor_nombre: Optional[str],
    referencias: set[str],
    inicio_periodo: date,
    fin_periodo: date,
    nuevo_tipo: str,
    nuevo_valor: float,
    total_field: Optional[str],
) -> int:
    inicio_dt = datetime.combine(inicio_periodo, datetime.min.time())
    fin_dt = datetime.combine(fin_periodo, datetime.max.time())

    condiciones_or = _build_sales_seller_query(profesional_id, vendedor_nombre)
    referencias = {str(r) for r in referencias or set() if r}
    if referencias:
        condiciones_or.append({"origen_id": {"$in": list(referencias)}})
        object_ids = [ObjectId(r) for r in referencias if ObjectId.is_valid(r)]
        if object_ids:
            condiciones_or.append({"_id": {"$in": object_ids}})

    docs = await collection.find({
        "sede_id": sede_id,
        "fecha_pago": {"$gte": inicio_dt, "$lte": fin_dt},
        "items.tipo": "producto",
        "$or": condiciones_or,
    }).to_list(None)

    actualizados = 0
    for doc in docs:
        items = doc.get("items", [])
        if not items:
            continue

        cambio = False
        total_productos = 0.0
        for item in items:
            if item.get("tipo") != "producto":
                continue
            total_productos += _actualizar_item_venta(
                item,
                nuevo_tipo=nuevo_tipo,
                nuevo_valor=nuevo_valor,
            )
            cambio = True

        if not cambio:
            continue

        set_data = {
            "items": items,
            "ultima_actualizacion_comisiones": datetime.now(),
        }
        if total_field:
            set_data[total_field] = round(total_productos, 2)

        await collection.update_one(
            {"_id": doc["_id"]},
            {"$set": set_data},
        )
        actualizados += 1

    return actualizados


recalcular_comisiones_periodo = recalcular_comisiones_periodo_v2
