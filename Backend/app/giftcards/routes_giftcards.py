"""
╔══════════════════════════════════════════════════════════════════════╗
║               MÓDULO DE GIFTCARDS - routes_giftcards.py              ║
║                                                                      ║
║  Flujo de integración:                                               ║
║  1. CRUD de giftcards (crear, listar, consultar, cancelar)           ║
║  2. Al crear/abonar cita → reservar saldo (no se descuenta aún)      ║
║  3. Al facturar → redimir definitivamente y descontar saldo          ║
║  4. Si cita cancela → liberar la reserva                             ║
║  5. Recargar giftcard → genera venta + factura                       ║
╚══════════════════════════════════════════════════════════════════════╝
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timedelta
from typing import Optional, List
from bson import ObjectId
import random
import string
from pydantic import BaseModel, Field

from app.database.mongo import (
    collection_giftcards,
    collection_citas,
    collection_clients,
    collection_locales,
    collection_sales,
    collection_invoices,
)
from app.auth.routes import get_current_user
from app.utils.timezone import today, today_str

router = APIRouter()


# ══════════════════════════════════════════
# MODELOS / SCHEMAS
# ══════════════════════════════════════════

class GiftcardCreate(BaseModel):
    sede_id: str
    comprador_cliente_id: Optional[str] = None      # quien la paga
    beneficiario_cliente_id: Optional[str] = None   # a quien va dirigida
    comprador_nombre: Optional[str] = None          # si no es cliente registrado
    beneficiario_nombre: Optional[str] = None
    valor: float                                    # monto cargado
    moneda: Optional[str] = None                    # hereda de la sede si no se envía
    dias_vigencia: Optional[int] = 365              # vence en N días (None = no vence)
    notas: Optional[str] = None
    metodo_pago: str = Field(..., description="efectivo, transferencia, tarjeta_credito, etc.")
    numero_comprobante: Optional[str] = None


class GiftcardRecargar(BaseModel):
    """Recarga saldo a una giftcard existente y genera venta + factura."""
    monto: float = Field(..., gt=0, description="Monto a recargar")
    metodo_pago: str = Field(..., description="efectivo, transferencia, tarjeta_credito, etc.")
    numero_comprobante: Optional[str] = None
    notas: Optional[str] = None


class GiftcardUpdate(BaseModel):
    beneficiario_cliente_id: Optional[str] = None
    beneficiario_nombre: Optional[str] = None
    dias_vigencia: Optional[int] = None
    notas: Optional[str] = None
    estado: Optional[str] = None  # solo admin puede cambiar estado manual


class ReservaRequest(BaseModel):
    cita_id: str
    monto: float
    codigo: str


class LiberarRequest(BaseModel):
    cita_id: str


class RedimirRequest(BaseModel):
    cita_id: str
    factura_id: Optional[str] = None
    numero_comprobante: Optional[str] = None
    monto: float


# ══════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════

def _generar_codigo() -> str:
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    grupos = ["".join(random.choices(chars, k=4)) for _ in range(3)]
    return "GC-" + "-".join(grupos)


def _generar_numero() -> str:
    return str(random.randint(10000000, 99999999))


def _estado_giftcard(doc: dict) -> str:
    if doc.get("estado") == "cancelada":
        return "cancelada"

    fecha_vencimiento = doc.get("fecha_vencimiento")
    if fecha_vencimiento:
        if isinstance(fecha_vencimiento, str):
            try:
                fecha_vencimiento = datetime.fromisoformat(fecha_vencimiento)
            except ValueError:
                fecha_vencimiento = None
        if fecha_vencimiento and datetime.now() > fecha_vencimiento:
            return "vencida"

    saldo = round(float(doc.get("saldo_disponible", 0)), 2)
    valor = round(float(doc.get("valor", 0)), 2)
    saldo_reservado = round(float(doc.get("saldo_reservado", 0)), 2)

    if saldo <= 0 and saldo_reservado <= 0:
        return "usada"
    if saldo < valor:
        return "parcialmente_usada"
    return "activa"


def _serializar(doc: dict) -> dict:
    doc["_id"] = str(doc["_id"])
    for campo in ["fecha_emision", "fecha_vencimiento", "fecha_primer_uso", "created_at"]:
        if isinstance(doc.get(campo), datetime):
            doc[campo] = doc[campo].isoformat()
    doc["estado"] = _estado_giftcard(doc)
    return doc


async def _registrar_venta_y_factura(
    *,
    sede: dict,
    sede_id: str,
    moneda: str,
    codigo: str,
    valor: float,
    metodo_pago: str,
    comprador_cliente_id: Optional[str],
    nombre_cliente: str,
    cedula_cliente: str = "",       
    email_cliente: str = "",     
    telefono_cliente: str = "",
    numero_comprobante: str,
    identificador: str,
    fecha_actual: datetime,
    registrado_por: str,
    vendedor_nombre: str = "",
    tipo_movimiento: str = "Compra",       # "Compra" | "Recarga"
    notas: Optional[str] = None,
) -> None:
    """
    Helper compartido entre crear_giftcard y recargar_giftcard.
    Inserta un documento en collection_sales y otro en collection_invoices.
    Usa la fecha ya localizada (tzinfo removido) que recibe como parámetro.
    """
    nombre_item = f"Giftcard {codigo} — {tipo_movimiento}"

    historial_pagos = [{
        "fecha": fecha_actual,
        "monto": round(valor, 2),
        "metodo": metodo_pago,
        "tipo": "pago_completo",
        "registrado_por": registrado_por,
        "saldo_despues": 0,
        "notas": notas or f"{tipo_movimiento} giftcard {codigo}",
    }]

    venta = {
        "identificador": identificador,
        "tipo_origen": "giftcard",
        "subtipo": tipo_movimiento.lower(),    # "compra" | "recarga"
        "origen_id": codigo,
        "fecha_pago": fecha_actual,
        "local": sede.get("nombre"),
        "sede_id": sede_id,
        "moneda": moneda,
        "tipo_comision": "ninguno",
        "cliente_id": comprador_cliente_id,
        "nombre_cliente": nombre_cliente,
        "cedula_cliente": cedula_cliente,   
        "email_cliente": email_cliente,      
        "telefono_cliente": telefono_cliente, 
        "items": [{
            "tipo": "giftcard",
            "codigo": codigo,
            "nombre": nombre_item,
            "cantidad": 1,
            "precio_unitario": round(valor, 2),
            "subtotal": round(valor, 2),
            "moneda": moneda,
            "comision": 0,
        }],
        "historial_pagos": historial_pagos,
        "desglose_pagos": {
            metodo_pago: round(valor, 2),
            "total": round(valor, 2),
        },
        "numero_comprobante": numero_comprobante,
        "facturado_por": registrado_por,
        "vendido_por": vendedor_nombre,           # ← NUEVO
        "profesional_nombre": vendedor_nombre,    # ← NUEVO
        "estado_factura": "facturado",
        "estado_pago": "pagado",
        "saldo_pendiente": 0,
    }

    await collection_sales.insert_one(venta)

    await collection_invoices.insert_one({
        **venta,
        "total": round(valor, 2),
        "monto": round(valor, 2),
        "comprobante_de_pago": "Giftcard",
        "fecha_comprobante": fecha_actual,
        "estado": "pagado",
    })


# ══════════════════════════════════════════
# CRUD - CREAR GIFTCARD
# ══════════════════════════════════════════

@router.post("/", response_model=dict)
async def crear_giftcard(
    data: GiftcardCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Crea una nueva giftcard y registra la venta + factura de su compra.
    - Solo admin_sede o super_admin pueden crearlas.
    - El código se genera automáticamente (único en la sede).
    - El saldo inicial = valor cargado.
    - Genera venta en collection_sales e invoice en collection_invoices
      usando el método de pago real con el que se compró.
    """
    if current_user["rol"] not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado para crear giftcards")

    sede = await collection_locales.find_one({"sede_id": data.sede_id})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    moneda = data.moneda or sede.get("moneda", "COP")

    if data.valor <= 0:
        raise HTTPException(status_code=400, detail="El valor de la giftcard debe ser mayor a 0")

    comprador_nombre = data.comprador_nombre
    if data.comprador_cliente_id:
        comprador = await collection_clients.find_one({"cliente_id": data.comprador_cliente_id})
        if not comprador:
            raise HTTPException(status_code=404, detail="Cliente comprador no encontrado")
        comprador_nombre = comprador_nombre or comprador.get("nombre", "")

    beneficiario_nombre = data.beneficiario_nombre
    if data.beneficiario_cliente_id:
        beneficiario = await collection_clients.find_one({"cliente_id": data.beneficiario_cliente_id})
        if not beneficiario:
            raise HTTPException(status_code=404, detail="Cliente beneficiario no encontrado")
        beneficiario_nombre = beneficiario_nombre or beneficiario.get("nombre", "")

    for _ in range(5):
        codigo = _generar_codigo()
        if not await collection_giftcards.find_one({"codigo": codigo}):
            break
    else:
        raise HTTPException(status_code=500, detail="No se pudo generar código único. Intenta de nuevo.")

    # ✅ Hora local de la sede, sin tzinfo para Mongo
    fecha_actual = today(sede).replace(tzinfo=None)

    fecha_vencimiento = None
    if data.dias_vigencia and data.dias_vigencia > 0:
        fecha_vencimiento = fecha_actual + timedelta(days=data.dias_vigencia)

    doc = {
        "codigo": codigo,
        "sede_id": data.sede_id,
        "sede_nombre": sede.get("nombre"),
        "moneda": moneda,
        "comprador_cliente_id": data.comprador_cliente_id,
        "comprador_nombre": comprador_nombre,
        "beneficiario_cliente_id": data.beneficiario_cliente_id,
        "beneficiario_nombre": beneficiario_nombre,
        "valor": round(float(data.valor), 2),
        "saldo_disponible": round(float(data.valor), 2),
        "saldo_reservado": 0.0,
        "saldo_usado": 0.0,
        "fecha_emision": fecha_actual,
        "fecha_vencimiento": fecha_vencimiento,
        "fecha_primer_uso": None,
        "estado": "activa",
        "historial": [],
        "notas": data.notas,
        "creada_por": current_user.get("email"),
        "created_at": fecha_actual,
    }

    result = await collection_giftcards.insert_one(doc)
    doc["_id"] = str(result.inserted_id)

    cedula_cliente = ""
    email_cliente = ""
    telefono_cliente = ""

    if data.comprador_cliente_id:
        cliente_doc = await collection_clients.find_one({"cliente_id": data.comprador_cliente_id})
        if cliente_doc:
            cedula_cliente   = cliente_doc.get("cedula", "")
            email_cliente    = cliente_doc.get("correo", "")   # ← ojo: es "correo" no "email"
            telefono_cliente = cliente_doc.get("telefono", "")
            # Si no vino nombre del comprador, tomarlo del cliente
            comprador_nombre = comprador_nombre or (
                cliente_doc.get("nombre", "") + " " + cliente_doc.get("apellido", "")
            ).strip()

    # ── Venta + Factura de la COMPRA ────────────────────────
    await _registrar_venta_y_factura(
        sede=sede,
        sede_id=data.sede_id,
        moneda=moneda,
        codigo=codigo,
        valor=round(float(data.valor), 2),
        metodo_pago=data.metodo_pago,
        comprador_cliente_id=data.comprador_cliente_id,
        nombre_cliente=comprador_nombre or "Comprador giftcard",
        cedula_cliente=cedula_cliente,
        email_cliente=email_cliente,
        telefono_cliente=telefono_cliente,
        numero_comprobante=data.numero_comprobante or _generar_numero(),
        identificador=_generar_numero(),
        fecha_actual=fecha_actual,
        registrado_por=current_user.get("email"),
        vendedor_nombre=current_user.get("nombre", ""),
        tipo_movimiento="Compra",
        notas=data.notas,
    )

    return {
        "success": True,
        "message": "Giftcard creada exitosamente",
        "giftcard": _serializar(doc),
    }


# ══════════════════════════════════════════
# RECARGAR GIFTCARD
# ══════════════════════════════════════════

@router.post("/{codigo}/recargar", response_model=dict)
async def recargar_giftcard(
    codigo: str,
    data: GiftcardRecargar,
    current_user: dict = Depends(get_current_user)
):
    """
    Recarga saldo a una giftcard existente.

    - Solo admin_sede o super_admin.
    - La giftcard no puede estar cancelada.
    - Genera venta + factura con el método de pago indicado,
      igual que cuando se crea la giftcard por primera vez.
    - Actualiza saldo_disponible y registra movimiento en historial.
    - Si estaba "usada" o "parcialmente_usada", vuelve a "activa".
    """
    if current_user["rol"] not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado para recargar giftcards")

    codigo = codigo.upper().strip()
    doc = await collection_giftcards.find_one({"codigo": codigo})
    if not doc:
        raise HTTPException(status_code=404, detail="Giftcard no encontrada")

    if doc.get("estado") == "cancelada":
        raise HTTPException(status_code=400, detail="No se puede recargar una giftcard cancelada")

    sede = await collection_locales.find_one({"sede_id": doc["sede_id"]})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede de la giftcard no encontrada")

    # ✅ Hora local de la sede
    fecha_actual = today(sede).replace(tzinfo=None)

    monto = round(float(data.monto), 2)
    nuevo_disponible = round(float(doc.get("saldo_disponible", 0)) + monto, 2)

    # Si se recarga una vencida, extendemos a 1 año desde hoy por defecto
    update_set: dict = {"saldo_disponible": nuevo_disponible}
    fecha_venc = doc.get("fecha_vencimiento")
    if fecha_venc and isinstance(fecha_venc, datetime) and fecha_venc < fecha_actual:
        nueva_fecha_venc = fecha_actual + timedelta(days=365)
        update_set["fecha_vencimiento"] = nueva_fecha_venc

    movimiento = {
        "tipo": "recarga",
        "monto": monto,
        "metodo_pago": data.metodo_pago,
        "fecha": fecha_actual,
        "registrado_por": current_user.get("email"),
        "saldo_disponible_antes": float(doc.get("saldo_disponible", 0)),
        "saldo_disponible_despues": nuevo_disponible,
        "notas": data.notas or "",
    }

    await collection_giftcards.update_one(
        {"codigo": codigo},
        {"$set": update_set, "$push": {"historial": movimiento}}
    )
    
    cedula_cliente = ""
    email_cliente = ""
    telefono_cliente = ""
    nombre_cliente = doc.get("comprador_nombre") or "Recarga giftcard"

    comprador_cliente_id = doc.get("comprador_cliente_id")
    if comprador_cliente_id:
        cliente_doc = await collection_clients.find_one({"cliente_id": comprador_cliente_id})
        if cliente_doc:
            cedula_cliente   = cliente_doc.get("cedula", "")
            email_cliente    = cliente_doc.get("correo", "")
            telefono_cliente = cliente_doc.get("telefono", "")
            # Enriquecer nombre si el doc de giftcard no lo tenía
            nombre_cliente = nombre_cliente or (
                cliente_doc.get("nombre", "") + " " + cliente_doc.get("apellido", "")
            ).strip() or "Recarga giftcard"
    
    # ── Venta + Factura de la RECARGA ───────────────────────
    numero_comprobante = data.numero_comprobante or _generar_numero()
    await _registrar_venta_y_factura(
        sede=sede,
        sede_id=doc["sede_id"],
        moneda=doc.get("moneda", sede.get("moneda", "COP")),
        codigo=codigo,
        valor=monto,
        metodo_pago=data.metodo_pago,
        comprador_cliente_id=comprador_cliente_id,
        nombre_cliente=nombre_cliente,
        cedula_cliente=cedula_cliente,
        email_cliente=email_cliente,
        telefono_cliente=telefono_cliente,
        numero_comprobante=numero_comprobante,
        identificador=_generar_numero(),
        fecha_actual=fecha_actual,
        registrado_por=current_user.get("email"),
        vendedor_nombre=current_user.get("nombre", ""), 
        tipo_movimiento="Recarga",
        notas=data.notas,
    )

    doc_actualizado = await collection_giftcards.find_one({"codigo": codigo})
    return {
        "success": True,
        "message": f"Giftcard {codigo} recargada con {monto} {doc.get('moneda')}",
        "numero_comprobante": numero_comprobante,
        "monto_recargado": monto,
        "saldo_disponible": nuevo_disponible,
        "giftcard": _serializar(doc_actualizado),
    }


# ══════════════════════════════════════════
# CRUD - LISTAR GIFTCARDS DE UNA SEDE
# ══════════════════════════════════════════

@router.get("/sede/{sede_id}", response_model=dict)
async def listar_giftcards(
    sede_id: str,
    estado: Optional[str] = Query(None),
    cliente_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user)
):
    if current_user["rol"] not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    filtro = {"sede_id": sede_id}
    if estado:
        filtro["estado"] = estado
    if cliente_id:
        filtro["$or"] = [
            {"comprador_cliente_id": cliente_id},
            {"beneficiario_cliente_id": cliente_id},
        ]

    skip = (page - 1) * limit
    total = await collection_giftcards.count_documents(filtro)
    docs = await collection_giftcards.find(filtro).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)

    return {
        "success": True,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
        "giftcards": [_serializar(d) for d in docs],
    }


# ══════════════════════════════════════════
# CRUD - CONSULTAR GIFTCARD POR CÓDIGO
# ══════════════════════════════════════════

@router.get("/{codigo}", response_model=dict)
async def consultar_giftcard(
    codigo: str,
    current_user: dict = Depends(get_current_user)
):
    codigo = codigo.upper().strip()
    doc = await collection_giftcards.find_one({"codigo": codigo})
    if not doc:
        raise HTTPException(status_code=404, detail="Giftcard no encontrada")

    alerta_vencimiento = None
    fecha_venc = doc.get("fecha_vencimiento")
    if fecha_venc:
        if isinstance(fecha_venc, str):
            try:
                fecha_venc = datetime.fromisoformat(fecha_venc)
            except ValueError:
                fecha_venc = None
        if fecha_venc:
            dias_restantes = (fecha_venc - datetime.now()).days
            if 0 < dias_restantes <= 30:
                alerta_vencimiento = f"Vence en {dias_restantes} días"

    return {
        "success": True,
        "giftcard": _serializar(doc),
        "alerta_vencimiento": alerta_vencimiento,
    }


# ══════════════════════════════════════════
# CRUD - EDITAR GIFTCARD
# ══════════════════════════════════════════

@router.put("/{codigo}", response_model=dict)
async def editar_giftcard(
    codigo: str,
    cambios: GiftcardUpdate,
    current_user: dict = Depends(get_current_user)
):
    if current_user["rol"] not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    codigo = codigo.upper().strip()
    doc = await collection_giftcards.find_one({"codigo": codigo})
    if not doc:
        raise HTTPException(status_code=404, detail="Giftcard no encontrada")

    update_fields = {}

    if cambios.beneficiario_cliente_id is not None:
        beneficiario = await collection_clients.find_one({"cliente_id": cambios.beneficiario_cliente_id})
        if not beneficiario:
            raise HTTPException(status_code=404, detail="Beneficiario no encontrado")
        update_fields["beneficiario_cliente_id"] = cambios.beneficiario_cliente_id
        update_fields["beneficiario_nombre"] = cambios.beneficiario_nombre or beneficiario.get("nombre")

    if cambios.beneficiario_nombre is not None:
        update_fields["beneficiario_nombre"] = cambios.beneficiario_nombre

    if cambios.dias_vigencia is not None:
        nueva_fecha = doc["fecha_emision"] + timedelta(days=cambios.dias_vigencia)
        update_fields["fecha_vencimiento"] = nueva_fecha

    if cambios.notas is not None:
        update_fields["notas"] = cambios.notas

    if cambios.estado and current_user["rol"] == "super_admin":
        estados_validos = {"activa", "cancelada", "usada", "parcialmente_usada"}
        if cambios.estado not in estados_validos:
            raise HTTPException(status_code=400, detail=f"Estado inválido. Use: {estados_validos}")
        update_fields["estado"] = cambios.estado

    if not update_fields:
        raise HTTPException(status_code=400, detail="No hay campos válidos para actualizar")

    update_fields["actualizado_por"] = current_user.get("email")
    update_fields["ultima_actualizacion"] = datetime.now()

    await collection_giftcards.update_one({"codigo": codigo}, {"$set": update_fields})
    doc_actualizado = await collection_giftcards.find_one({"codigo": codigo})

    return {
        "success": True,
        "message": "Giftcard actualizada",
        "giftcard": _serializar(doc_actualizado),
    }


# ══════════════════════════════════════════
# CRUD - CANCELAR GIFTCARD
# ══════════════════════════════════════════

@router.delete("/{codigo}", response_model=dict)
async def cancelar_giftcard(
    codigo: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user["rol"] not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    codigo = codigo.upper().strip()
    doc = await collection_giftcards.find_one({"codigo": codigo})
    if not doc:
        raise HTTPException(status_code=404, detail="Giftcard no encontrada")

    if doc.get("estado") == "cancelada":
        raise HTTPException(status_code=400, detail="La giftcard ya está cancelada")

    if float(doc.get("saldo_reservado", 0)) > 0:
        raise HTTPException(
            status_code=400,
            detail="No se puede cancelar: tiene saldo reservado en citas pendientes de facturar",
        )

    # ✅ Hora local de la sede para fecha_cancelacion
    sede = await collection_locales.find_one({"sede_id": doc["sede_id"]})
    fecha_cancelacion = today(sede).replace(tzinfo=None) if sede else datetime.now()

    await collection_giftcards.update_one(
        {"codigo": codigo},
        {"$set": {
            "estado": "cancelada",
            "cancelada_por": current_user.get("email"),
            "fecha_cancelacion": fecha_cancelacion,
        }}
    )

    return {"success": True, "message": "Giftcard cancelada exitosamente", "codigo": codigo}


# ══════════════════════════════════════════════════════════
# OPERACIONES DE FLUJO - RESERVAR SALDO
# ══════════════════════════════════════════════════════════

@router.post("/{codigo}/reservar", response_model=dict)
async def reservar_saldo_giftcard(
    codigo: str,
    data: ReservaRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Reserva saldo de una giftcard al crear/abonar una cita.
    El dinero NO se descuenta aún — se bloquea temporalmente.
    """
    if current_user["rol"] not in ["usuario", "admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    codigo = codigo.upper().strip()
    doc = await collection_giftcards.find_one({"codigo": codigo})
    if not doc:
        raise HTTPException(status_code=404, detail="Giftcard no encontrada")

    estado_actual = _estado_giftcard(doc)
    if estado_actual in ["cancelada", "vencida", "usada"]:
        raise HTTPException(status_code=400, detail=f"La giftcard no puede usarse: estado '{estado_actual}'")

    historial = doc.get("historial", [])
    ya_reservada = any(
        m.get("cita_id") == data.cita_id and m.get("tipo") == "reserva"
        for m in historial
    )
    if ya_reservada:
        raise HTTPException(status_code=400, detail="Ya existe una reserva activa de esta giftcard para esta cita")

    saldo_disponible = round(float(doc.get("saldo_disponible", 0)), 2)
    monto = round(float(data.monto), 2)

    if monto <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a 0")
    if monto > saldo_disponible:
        raise HTTPException(
            status_code=400,
            detail=f"Saldo insuficiente. Disponible: {saldo_disponible} {doc.get('moneda')}, solicitado: {monto}",
        )

    nuevo_disponible = round(saldo_disponible - monto, 2)
    nuevo_reservado = round(float(doc.get("saldo_reservado", 0)) + monto, 2)

    # ✅ Hora local de la sede
    sede = await collection_locales.find_one({"sede_id": doc["sede_id"]})
    fecha_actual = today(sede).replace(tzinfo=None) if sede else datetime.now()

    movimiento = {
        "tipo": "reserva",
        "cita_id": data.cita_id,
        "monto": monto,
        "fecha": fecha_actual,
        "registrado_por": current_user.get("email"),
        "saldo_disponible_antes": saldo_disponible,
        "saldo_disponible_despues": nuevo_disponible,
    }

    await collection_giftcards.update_one(
        {"codigo": codigo},
        {"$set": {"saldo_disponible": nuevo_disponible, "saldo_reservado": nuevo_reservado},
         "$push": {"historial": movimiento}},
    )

    doc_actualizado = await collection_giftcards.find_one({"codigo": codigo})
    return {
        "success": True,
        "message": f"Saldo de {monto} {doc.get('moneda')} reservado correctamente",
        "saldo_disponible": nuevo_disponible,
        "saldo_reservado": nuevo_reservado,
        "moneda": doc.get("moneda"),
        "giftcard": _serializar(doc_actualizado),
    }


# ══════════════════════════════════════════════════════════
# OPERACIONES DE FLUJO - LIBERAR RESERVA
# ══════════════════════════════════════════════════════════

@router.post("/{codigo}/liberar", response_model=dict)
async def liberar_reserva_giftcard(
    codigo: str,
    data: LiberarRequest,
    current_user: dict = Depends(get_current_user)
):
    """Libera la reserva de saldo cuando una cita se cancela."""
    if current_user["rol"] not in ["admin_sede", "super_admin", "usuario", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    codigo = codigo.upper().strip()
    doc = await collection_giftcards.find_one({"codigo": codigo})
    if not doc:
        raise HTTPException(status_code=404, detail="Giftcard no encontrada")

    historial = doc.get("historial", [])
    reserva = next(
        (m for m in historial if m.get("cita_id") == data.cita_id and m.get("tipo") == "reserva"),
        None,
    )
    if not reserva:
        raise HTTPException(status_code=404, detail="No existe reserva activa de esta giftcard para esta cita")

    ya_redimida = any(
        m.get("cita_id") == data.cita_id and m.get("tipo") == "redencion"
        for m in historial
    )
    if ya_redimida:
        raise HTTPException(status_code=400, detail="Esta reserva ya fue redimida en facturación, no se puede liberar")

    monto_reservado = round(float(reserva.get("monto", 0)), 2)
    nuevo_disponible = round(float(doc.get("saldo_disponible", 0)) + monto_reservado, 2)
    nuevo_reservado = max(0.0, round(float(doc.get("saldo_reservado", 0)) - monto_reservado, 2))

    # ✅ Hora local de la sede
    sede = await collection_locales.find_one({"sede_id": doc["sede_id"]})
    fecha_actual = today(sede).replace(tzinfo=None) if sede else datetime.now()

    movimiento = {
        "tipo": "liberacion",
        "cita_id": data.cita_id,
        "monto": monto_reservado,
        "fecha": fecha_actual,
        "registrado_por": current_user.get("email"),
        "motivo": "cita_cancelada",
    }

    await collection_giftcards.update_one(
        {"codigo": codigo},
        {"$set": {"saldo_disponible": nuevo_disponible, "saldo_reservado": nuevo_reservado},
         "$push": {"historial": movimiento}},
    )

    doc_actualizado = await collection_giftcards.find_one({"codigo": codigo})
    return {
        "success": True,
        "message": f"Saldo de {monto_reservado} {doc.get('moneda')} liberado correctamente",
        "saldo_disponible": nuevo_disponible,
        "saldo_reservado": nuevo_reservado,
        "giftcard": _serializar(doc_actualizado),
    }


# ══════════════════════════════════════════════════════════
# OPERACIONES DE FLUJO - REDIMIR (desde facturación)
# ══════════════════════════════════════════════════════════

@router.post("/{codigo}/redimir", response_model=dict)
async def redimir_giftcard(
    codigo: str,
    data: RedimirRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Llamado automáticamente desde el endpoint de facturación.
    Convierte la reserva en redención definitiva.
    """
    if current_user["rol"] not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado para redimir giftcards")

    codigo = codigo.upper().strip()
    doc = await collection_giftcards.find_one({"codigo": codigo})
    if not doc:
        raise HTTPException(status_code=404, detail="Giftcard no encontrada")

    historial = doc.get("historial", [])
    ya_redimida = any(
        m.get("cita_id") == data.cita_id and m.get("tipo") == "redencion"
        for m in historial
    )
    if ya_redimida:
        raise HTTPException(status_code=400, detail="Esta giftcard ya fue redimida para esta cita")

    reserva = next(
        (m for m in historial if m.get("cita_id") == data.cita_id and m.get("tipo") == "reserva"),
        None,
    )

    monto_redimir = round(float(data.monto), 2)

    # Si no hay reserva previa (uso directo en facturación sin reserva)
    if not reserva:
        # Verificar saldo disponible directamente
        saldo_disponible = round(float(doc.get("saldo_disponible", 0)), 2)
        if monto_redimir > saldo_disponible:
            raise HTTPException(
                status_code=400,
                detail=f"Saldo insuficiente: disponible {saldo_disponible}, requerido {monto_redimir}",
            )
        nuevo_disponible = round(saldo_disponible - monto_redimir, 2)
        nuevo_reservado = float(doc.get("saldo_reservado", 0))
    else:
        # Ajuste entre lo reservado y lo que se redime realmente
        monto_reservado = round(float(reserva.get("monto", 0)), 2)
        diferencia = round(monto_reservado - monto_redimir, 2)
        nuevo_reservado = max(0.0, round(float(doc.get("saldo_reservado", 0)) - monto_reservado, 2))
        nuevo_disponible = float(doc.get("saldo_disponible", 0))
        if diferencia > 0:
            nuevo_disponible = round(nuevo_disponible + diferencia, 2)

    nuevo_usado = round(float(doc.get("saldo_usado", 0)) + monto_redimir, 2)

    # ✅ Hora local de la sede
    sede = await collection_locales.find_one({"sede_id": doc["sede_id"]})
    fecha_actual = today(sede).replace(tzinfo=None) if sede else datetime.now()

    movimiento = {
        "tipo": "redencion",
        "cita_id": data.cita_id,
        "factura_id": data.factura_id,
        "numero_comprobante": data.numero_comprobante,
        "monto": monto_redimir,
        "fecha": fecha_actual,
        "registrado_por": current_user.get("email"),
    }

    # Primer uso
    update_set = {
        "saldo_disponible": nuevo_disponible,
        "saldo_reservado": nuevo_reservado,
        "saldo_usado": nuevo_usado,
    }
    if not doc.get("fecha_primer_uso"):
        update_set["fecha_primer_uso"] = fecha_actual

    await collection_giftcards.update_one(
        {"codigo": codigo},
        {"$set": update_set, "$push": {"historial": movimiento}},
    )

    # Recalcular estado
    doc_actualizado = await collection_giftcards.find_one({"codigo": codigo})
    estado_nuevo = _estado_giftcard(doc_actualizado)
    await collection_giftcards.update_one({"codigo": codigo}, {"$set": {"estado": estado_nuevo}})

    doc_final = await collection_giftcards.find_one({"codigo": codigo})
    return {
        "success": True,
        "message": f"Giftcard redimida: {monto_redimir} {doc.get('moneda')}",
        "monto_redimido": monto_redimir,
        "saldo_restante": nuevo_disponible,
        "estado": estado_nuevo,
        "giftcard": _serializar(doc_final),
    }


# ══════════════════════════════════════════════════════════
# HISTORIAL DE MOVIMIENTOS
# ══════════════════════════════════════════════════════════

@router.get("/{codigo}/historial", response_model=dict)
async def historial_giftcard(
    codigo: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Devuelve el historial completo de movimientos de una giftcard.
    """
    codigo = codigo.upper().strip()
    doc = await collection_giftcards.find_one({"codigo": codigo})
    if not doc:
        raise HTTPException(status_code=404, detail="Giftcard no encontrada")

    historial = doc.get("historial", [])
    # Serializar fechas dentro del historial
    for mov in historial:
        if isinstance(mov.get("fecha"), datetime):
            mov["fecha"] = mov["fecha"].isoformat()

    return {
        "success": True,
        "codigo": codigo,
        "valor_original": doc.get("valor"),
        "saldo_disponible": doc.get("saldo_disponible"),
        "saldo_usado": doc.get("saldo_usado"),
        "moneda": doc.get("moneda"),
        "estado": _estado_giftcard(doc),
        "total_movimientos": len(historial),
        "historial": historial,
    }

"""
══════════════════════════════════════════════════════════════
ENDPOINT DE MIGRACIÓN — Agrega esto a routes_giftcards.py
══════════════════════════════════════════════════════════════
Colócalo ANTES de la sección "CRUD - LISTAR GIFTCARDS".
"""


# ══════════════════════════════════════════
# MODELO PARA MIGRACIÓN
# ══════════════════════════════════════════

class GiftcardMigrar(BaseModel):
    sede_id: str
    codigo_override: Optional[str] = None                       # El nuevo código que asignaste
    comprador_cliente_id: Optional[str] = None
    beneficiario_cliente_id: Optional[str] = None
    comprador_nombre: Optional[str] = None
    beneficiario_nombre: Optional[str] = None
    valor: float                                    # Saldo ACTUAL (lo que tiene disponible)
    valor_original: Optional[float] = None         # Saldo inicial del sistema viejo (solo referencia)
    metodo_pago: str
    fecha_emision_override: str                     # "2026-02-28T13:38:00" — fecha real de venta
    dias_vigencia: Optional[int] = 365
    notas: Optional[str] = None
    id_sistema_anterior: Optional[str] = None      # ID del sistema viejo (para trazabilidad)
    numero_comprobante: Optional[str] = None
    es_migracion: bool = True


# ══════════════════════════════════════════
# ENDPOINT /giftcards/migrar  (solo super_admin)
# ══════════════════════════════════════════

@router.post("/migrar", response_model=dict)
async def migrar_giftcard(
    data: GiftcardMigrar,
    current_user: dict = Depends(get_current_user)
):
    """
    Crea una giftcard con fecha de emisión histórica (override).
    Solo super_admin puede usarlo.

    Diferencias vs crear_giftcard normal:
    - Acepta codigo_override en lugar de generarlo automáticamente.
    - Acepta fecha_emision_override para respetar la fecha original de venta.
    - El campo valor = saldo ACTUAL del cliente (no el valor original si ya usó parte).
    - valor_original se guarda en notas y en el doc para trazabilidad contable.
    - La venta y factura se generan con la fecha histórica → no altera nómina actual.
    - id_sistema_anterior queda guardado para auditoría.
    """
    if current_user["rol"] != "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Solo super_admin puede realizar migraciones de giftcards"
        )

    sede = await collection_locales.find_one({"sede_id": data.sede_id})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    moneda = sede.get("moneda", "COP")

    if data.valor < 0:
        raise HTTPException(status_code=400, detail="El valor no puede ser negativo")

    # ── Validar código único ────────────────────────────────
    if data.codigo_override:
        codigo = data.codigo_override.upper().strip()
        if await collection_giftcards.find_one({"codigo": codigo}):
            raise HTTPException(
                status_code=409,
                detail=f"El código {codigo} ya existe en el sistema"
            )
    else:
        # Auto-generar igual que crear_giftcard normal
        for _ in range(5):
            codigo = _generar_codigo()
            if not await collection_giftcards.find_one({"codigo": codigo}):
                break
            else:
                raise HTTPException(status_code=500, detail="No se pudo generar código único. Intenta de nuevo.")
    # ── Resolver comprador ──────────────────────────────────
    comprador_nombre = data.comprador_nombre
    cedula_cliente = ""
    email_cliente = ""
    telefono_cliente = ""

    if data.comprador_cliente_id:
        comprador = await collection_clients.find_one({"cliente_id": data.comprador_cliente_id})
        if not comprador:
            raise HTTPException(status_code=404, detail="Cliente comprador no encontrado")
        comprador_nombre = comprador_nombre or (
            comprador.get("nombre", "") + " " + comprador.get("apellido", "")
        ).strip()
        cedula_cliente   = comprador.get("cedula", "")
        email_cliente    = comprador.get("correo", "")
        telefono_cliente = comprador.get("telefono", "")

    # ── Resolver beneficiario ───────────────────────────────
    beneficiario_nombre = data.beneficiario_nombre
    if data.beneficiario_cliente_id:
        beneficiario = await collection_clients.find_one({"cliente_id": data.beneficiario_cliente_id})
        if not beneficiario:
            raise HTTPException(status_code=404, detail="Cliente beneficiario no encontrado")
        beneficiario_nombre = beneficiario_nombre or beneficiario.get("nombre", "")

    # ── Fecha de emisión histórica ──────────────────────────
    try:
        fecha_emision = datetime.fromisoformat(data.fecha_emision_override).replace(tzinfo=None)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"fecha_emision_override inválida: '{data.fecha_emision_override}'. Use formato ISO: 2026-02-28T13:38:00"
        )

    fecha_vencimiento = None
    if data.dias_vigencia and data.dias_vigencia > 0:
        fecha_vencimiento = fecha_emision + timedelta(days=data.dias_vigencia)

    # ── Notas enriquecidas con info de migración ────────────
    nota_migracion = (
        f"[MIGRACIÓN] ID sistema anterior: {data.id_sistema_anterior or 'N/A'}. "
        f"Valor original: {data.valor_original or data.valor}. "
        f"Saldo migrado: {data.valor}. "
        + (data.notas or "")
    ).strip()

    # ── Crear documento ─────────────────────────────────────
    doc = {
        "codigo": codigo,
        "sede_id": data.sede_id,
        "sede_nombre": sede.get("nombre"),
        "moneda": moneda,
        "comprador_cliente_id": data.comprador_cliente_id,
        "comprador_nombre": comprador_nombre,
        "beneficiario_cliente_id": data.beneficiario_cliente_id,
        "beneficiario_nombre": beneficiario_nombre,
        "valor": round(float(data.valor), 2),
        "saldo_disponible": round(float(data.valor), 2),
        "saldo_reservado": 0.0,
        "saldo_usado": 0.0,
        "fecha_emision": fecha_emision,
        "fecha_vencimiento": fecha_vencimiento,
        "fecha_primer_uso": None,
        "estado": "activa" if data.valor > 0 else "usada",
        "historial": [],
        "notas": nota_migracion,
        "es_migracion": True,
        "id_sistema_anterior": data.id_sistema_anterior,
        "valor_original_migracion": round(float(data.valor_original or data.valor), 2),
        "creada_por": current_user.get("email"),
        "created_at": fecha_emision,           # ← usa fecha histórica, no now()
    }

    result = await collection_giftcards.insert_one(doc)
    doc["_id"] = str(result.inserted_id)

    # ── Venta + Factura con fecha histórica ─────────────────
    # Solo si el saldo es > 0 (si es 0 es una giftcard ya agotada, no genera factura)
    if data.valor > 0:
        await _registrar_venta_y_factura(
            sede=sede,
            sede_id=data.sede_id,
            moneda=moneda,
            codigo=codigo,
            valor=round(float(data.valor_original or data.valor), 2),  # factura por valor original
            metodo_pago=data.metodo_pago,
            comprador_cliente_id=data.comprador_cliente_id,
            nombre_cliente=comprador_nombre or "Migración giftcard",
            cedula_cliente=cedula_cliente,
            email_cliente=email_cliente,
            telefono_cliente=telefono_cliente,
            numero_comprobante=data.numero_comprobante or _generar_numero(),
            identificador=_generar_numero(),
            fecha_actual=fecha_emision,         # ← fecha histórica
            registrado_por=current_user.get("email"),
            vendedor_nombre=current_user.get("nombre", ""),
            tipo_movimiento="Compra",
            notas=nota_migracion,
        )

    return {
        "success": True,
        "message": f"Giftcard {codigo} migrada exitosamente",
        "codigo_nuevo": codigo,
        "id_sistema_anterior": data.id_sistema_anterior,
        "saldo_migrado": round(float(data.valor), 2),
        "fecha_emision_registrada": fecha_emision.isoformat(),
        "giftcard": _serializar(doc),
    }