import base64
import os
from datetime import datetime
from typing import Any, Dict, List

import httpx
from bson import ObjectId
from fastapi import HTTPException

from app.database.mongo import (
    collection_clients,
    collection_invoices,
    collection_locales,
    collection_productos,
    collection_servicios,
)

ALEGRA_BASE_URL = os.getenv("ALEGRA_BASE_URL", "https://api.alegra.com/api/v1")
ALEGRA_EMAIL = os.getenv("ALEGRA_EMAIL")
ALEGRA_TOKEN = os.getenv("ALEGRA_TOKEN")
ALEGRA_ENABLED_SEDE_ID = os.getenv("ALEGRA_ENABLED_SEDE_ID", "").strip()
ALEGRA_DEFAULT_KIND_OF_PERSON = os.getenv("ALEGRA_DEFAULT_KIND_OF_PERSON", "PERSON_ENTITY").strip()


def alegra_is_enabled() -> bool:
    return bool(ALEGRA_EMAIL and ALEGRA_TOKEN)


def is_allowed_sede(sede_id: str) -> bool:
    if not ALEGRA_ENABLED_SEDE_ID:
        return True
    return sede_id == ALEGRA_ENABLED_SEDE_ID


def _auth_header() -> Dict[str, str]:
    if not alegra_is_enabled():
        raise HTTPException(
            status_code=400,
            detail="Integración Alegra no configurada. Define ALEGRA_EMAIL y ALEGRA_TOKEN.",
        )

    basic_token = base64.b64encode(f"{ALEGRA_EMAIL}:{ALEGRA_TOKEN}".encode("utf-8")).decode("utf-8")
    return {
        "Authorization": f"Basic {basic_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _build_contact_payload(client_doc: Dict[str, Any]) -> Dict[str, Any]:
    nombre_completo = (client_doc.get("nombre") or "").strip() or "Cliente"
    email = (client_doc.get("correo") or "").strip()
    phone_primary = (client_doc.get("telefono") or "").strip()
    cedula = (client_doc.get("cedula") or "").strip()

    person_type_raw = (client_doc.get("tipo_persona") or client_doc.get("person_type") or "").strip().lower()
    if person_type_raw in {"juridica", "jurídica", "empresa", "legal_entity"}:
        kind_of_person = "LEGAL_ENTITY"
    else:
        kind_of_person = "PERSON_ENTITY"

    # Separar nombre y apellido
    partes = nombre_completo.split(" ", 1)
    first_name = partes[0]
    last_name = partes[1] if len(partes) > 1 else "."

    payload: Dict[str, Any] = {
        "kindOfPerson": kind_of_person,
        "regime": "SIMPLIFIED_REGIME",
        "nameObject": {
            "firstName": first_name,
            "lastName": last_name,
        },
    }

    if email:
        payload["email"] = email

    if phone_primary:
        payload["phonePrimary"] = phone_primary

    if cedula:
        payload["identificationObject"] = {
            "type": "CC",
            "number": cedula,
        }

    return payload

async def _create_alegra_contact(client_doc: Dict[str, Any]) -> str:
    payload = _build_contact_payload(client_doc)

    async with httpx.AsyncClient(timeout=40) as client:
        response = await client.post(
            f"{ALEGRA_BASE_URL}/contacts",
            json=payload,
            headers=_auth_header(),
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail={
                "message": "No fue posible crear el contacto en Alegra.",
                "alegra_response": response.text,
                "payload": payload,
            },
        )

    data = response.json()
    contact_id = data.get("id")
    if not contact_id:
        raise HTTPException(
            status_code=response.status_code,
            detail="Alegra respondió sin id de contacto al crear el cliente.",
        )

    return str(contact_id)

_PAYMENT_MAP = {
    "efectivo":        ("CASH",   "CASH"),
    "transferencia":   ("CASH",   "CREDIT_TRANSFER"),
    "nequi":           ("CASH",   "CREDIT_TRANSFER"),
    "daviplata":       ("CASH",   "CREDIT_TRANSFER"),
    "link_pago":       ("CASH",   "CREDIT_TRANSFER"),
    "link_de_pago":    ("CASH",   "CREDIT_TRANSFER"),
    "tarjeta":         ("CASH",   "CREDIT_CARD"),
    "tarjeta_credito": ("CASH",   "CREDIT_CARD"),
    "tarjeta_debito":  ("CASH",   "DEBIT_CARD"),
    "cheque":          ("CASH",   "CHECK"),
    "giftcard":        ("CASH",   "CASH"),
    "otro":            ("CASH",   "INSTRUMENT_NOT_DEFINED"),
}

def _resolve_payment_fields(invoice_doc: Dict[str, Any]) -> tuple:
    """Retorna (paymentForm, paymentMethod) según los medios de pago usados."""
    desglose = invoice_doc.get("desglose_pagos", {})
    metodos = [k for k, v in desglose.items() if k != "total" and float(v or 0) > 0]

    if len(metodos) == 1:
        return _PAYMENT_MAP.get(metodos[0].lower(), ("CASH", "CASH"))
    if len(metodos) > 1:
        principal = max(metodos, key=lambda m: float(desglose.get(m, 0)))
        return _PAYMENT_MAP.get(principal.lower(), ("CASH", "CASH"))

    historial = invoice_doc.get("historial_pagos", [])
    if historial:
        metodo = (historial[0].get("metodo") or "").lower()
        return _PAYMENT_MAP.get(metodo, ("CASH", "CASH"))

    return ("CASH", "CASH")


async def _build_alegra_payload(invoice_doc: Dict[str, Any]) -> Dict[str, Any]:
    cliente_id = invoice_doc.get("cliente_id")
    sede_id = invoice_doc.get("sede_id")

    if not cliente_id or not sede_id:
        raise HTTPException(status_code=422, detail="La factura interna no tiene cliente_id o sede_id.")

    client = await collection_clients.find_one({"cliente_id": cliente_id})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente de la factura no encontrado.")

    alegra_contact_id = client.get("alegra_contact_id")
    if not alegra_contact_id:
        alegra_contact_id = await _create_alegra_contact(client)
        await collection_clients.update_one(
            {"_id": client["_id"]},
            {
                "$set": {
                    "alegra_contact_id": str(alegra_contact_id),
                    "alegra_contact_synced_at": datetime.utcnow(),
                }
            },
        )

    sede = await collection_locales.find_one({"sede_id": sede_id})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada para facturación electrónica.")

    alegra_number_template_id = sede.get("alegra_number_template_id")
    if not alegra_number_template_id:
        raise HTTPException(
            status_code=422,
            detail="La sede no tiene alegra_number_template_id configurado.",
        )

    invoice_items: List[Dict[str, Any]] = []
    missing_mappings: List[str] = []

    for item in invoice_doc.get("items", []):
        item_type = item.get("tipo")
        price = float(item.get("precio_unitario", 0))
        quantity = float(item.get("cantidad", 1))

        alegra_item_id = None

        if item_type == "servicio":
            servicio_id = item.get("servicio_id")
            # ✅ 1. Leer directo del item (ya fue denormalizado al crear la venta)
            alegra_item_id = item.get("alegra_item_id")

            # ✅ 2. Fallback: buscar en colección de servicios
            if not alegra_item_id:
                servicio = await collection_servicios.find_one({"servicio_id": servicio_id})
                if servicio:
                    alegra_item_id = servicio.get("alegra_item_id")
            
            if not alegra_item_id:
                missing_mappings.append(f"servicio:{servicio_id}")
        elif item_type == "producto":
            producto_id = item.get("producto_id")

            # ✅ Mismo patrón para productos
            alegra_item_id = item.get("alegra_item_id")

            if not alegra_item_id:
                producto = await collection_productos.find_one({"id": producto_id})
                if producto:
                    alegra_item_id = producto.get("alegra_item_id")

            if not alegra_item_id:
                missing_mappings.append(f"producto:{producto_id}")

        if not alegra_item_id:
            continue

        invoice_items.append(
            {
                "id": str(alegra_item_id),
                "price": price,
                "quantity": quantity,
            }
        )

    if missing_mappings:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Faltan mapeos de ítems hacia Alegra.",
                "missing": missing_mappings,
            },
        )

    if not invoice_items:
        raise HTTPException(status_code=422, detail="La factura no tiene ítems válidos para Alegra.")

    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    payment_form, payment_method = _resolve_payment_fields(invoice_doc)

    return {
        "date": today_str,
        "dueDate": today_str,
        "numberTemplate": {"id": str(alegra_number_template_id)},
        "client": {"id": str(alegra_contact_id)},
        "items": invoice_items,
        "paymentForm": payment_form,      # ✅ "CASH" o "CREDIT"
        "paymentMethod": payment_method,  # ✅ "CREDIT_TRANSFER", "CASH", etc.
        "observations": f"Factura interna {invoice_doc.get('numero_comprobante', '')}".strip(),
    }


async def _create_alegra_invoice(payload: Dict[str, Any]) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=40) as client:
        response = await client.post(
            f"{ALEGRA_BASE_URL}/invoices",
            json=payload,
            headers=_auth_header(),
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail={
                "message": "Error en Alegra",
                "alegra_response": response.text,
                "payload": payload
            },
        )

    return response.json()


async def _stamp_alegra_invoice(alegra_invoice_id: str) -> Dict[str, Any]:
    payload = {"ids": [str(alegra_invoice_id)]}

    async with httpx.AsyncClient(timeout=40) as client:
        response = await client.post(
            f"{ALEGRA_BASE_URL}/invoices/stamp",
            json=payload,
            headers=_auth_header(),
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail={
                "message": "Error en Alegra",
                "alegra_response": response.text,
                "payload": payload
            },
        )

    return response.json()


async def emit_invoice_to_alegra(invoice_id: str, requested_by: str = "system") -> Dict[str, Any]:
    try:
        mongo_id = ObjectId(invoice_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invoice_id inválido") from exc

    invoice_doc = await collection_invoices.find_one({"_id": mongo_id})
    if not invoice_doc:
        raise HTTPException(status_code=404, detail="Factura interna no encontrada")

    if not is_allowed_sede(invoice_doc.get("sede_id", "")):
        raise HTTPException(
            status_code=403,
            detail=(
                f"La sede {invoice_doc.get('sede_id')} no está habilitada para factura "
                "electrónica con Alegra."
            ),
        )

    payload = await _build_alegra_payload(invoice_doc)

    created = await _create_alegra_invoice(payload)
    alegra_invoice_id = str(created.get("id") or created.get("number") or "")

    stamp_response: Dict[str, Any] = {}
    if alegra_invoice_id:
        stamp_response = await _stamp_alegra_invoice(alegra_invoice_id)

    electronic_data = {
        "provider": "alegra",
        "status": "submitted",
        "last_attempt_at": datetime.utcnow(),
        "requested_by": requested_by,
        "alegra_invoice_id": alegra_invoice_id,
        "payload": payload,
        "create_response": created,
        "stamp_response": stamp_response,
    }

    await collection_invoices.update_one(
        {"_id": mongo_id},
        {"$set": {"electronic_invoice": electronic_data}},
    )

    return electronic_data


async def mark_invoice_electronic_pending(invoice_id: ObjectId, reason: str) -> None:
    await collection_invoices.update_one(
        {"_id": invoice_id},
        {
            "$set": {
                "electronic_invoice": {
                    "provider": "alegra",
                    "status": "pending",
                    "reason": reason,
                    "last_attempt_at": datetime.utcnow(),
                }
            }
        },
    )


async def initialize_manual_electronic_status(invoice_id: ObjectId, sede_id: str) -> None:
    if not is_allowed_sede(sede_id):
        await mark_invoice_electronic_pending(
            invoice_id,
            f"Sede {sede_id} no habilitada para factura electrónica en Alegra.",
        )
        await collection_invoices.update_one(
            {"_id": invoice_id},
            {"$set": {"electronic_invoice.status": "disabled"}},
        )
        return

    await mark_invoice_electronic_pending(
        invoice_id,
        "Pendiente de emisión manual desde módulo de ventas facturadas.",
    )
