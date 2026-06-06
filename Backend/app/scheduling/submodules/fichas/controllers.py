# controllers.py
from datetime import datetime
from bson import ObjectId
from app.database.mongo import collection_citas, collection_clients
from app.scheduling.submodules.quotes.controllers import (
    generar_pdf_ficha,
    crear_html_correo_ficha,
    enviar_correo_con_pdf
)

async def generar_y_enviar_pdf_ficha(ficha: dict, cita_id: str) -> dict:
    cliente_email = None
    pdf_generado = False

    try:
        try:
            cita_doc = await collection_citas.find_one({"_id": ObjectId(cita_id)})
        except Exception:
            cita_doc = None

        cita_data_for_pdf = {
            "cita_id": cita_id,
            "estado": (cita_doc or {}).get("estado", "finalizado"),
            "fecha_finalizacion": (cita_doc or {}).get("fecha_finalizacion", datetime.now()),
            "valor_total": (cita_doc or {}).get("valor_total", 0),
            "abono": (cita_doc or {}).get("abono", 0),
            "saldo_pendiente": (cita_doc or {}).get("saldo_pendiente", 0),
        }

        pdf_bytes = await generar_pdf_ficha(ficha, cita_data_for_pdf)
        pdf_generado = True

        cliente_email = ficha.get("correo")
        if not cliente_email:
            cliente = await collection_clients.find_one({"cliente_id": ficha.get("cliente_id")})
            if cliente:
                cliente_email = cliente.get("correo")

        if cliente_email:
            html = crear_html_correo_ficha(
                cliente_nombre=ficha.get("nombre", "Cliente"),
                servicio_nombre=ficha.get("servicio_nombre", "Servicio"),
                fecha=datetime.now().strftime("%d/%m/%Y %H:%M")
            )

            await enviar_correo_con_pdf(
                destinatario=cliente_email,
                asunto="Ficha Diagnostico",
                mensaje_html=html,
                pdf_bytes=pdf_bytes,
                nombre_archivo="ficha_diagnostico.pdf"
            )

    except Exception as e:
        print("❌ Error PDF:", e)

    return {
        "pdf_generado": pdf_generado,
        "pdf_enviado": bool(cliente_email) and pdf_generado,
        "cliente_email": cliente_email
    }