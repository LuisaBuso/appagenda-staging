from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse, JSONResponse
from bson import ObjectId
from datetime import datetime
from io import BytesIO
from app.database.mongo import collection_clients, collection_citas, collection_card
from app.auth.routes import get_current_user
from app.scheduling.submodules.quotes.controllers import ( generar_pdf_ficha, 
    crear_html_correo_ficha, enviar_correo_con_pdf)

router = APIRouter()

# ============================================
# ✅ Endpoint para generar PDF específico - CORREGIDO
# ============================================
@router.get("/generar-pdf/{cliente_id}/{cita_id}", response_class=StreamingResponse)
async def generar_pdf_especifico(
    cliente_id: str,
    cita_id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        print(f"🔍 [PDF ENDPOINT] Buscando cliente: {cliente_id}")
        print(f"🔍 [PDF ENDPOINT] Buscando cita: {cita_id}")

        if current_user["rol"] not in ["admin_sede", "estilista", "recepcionista", "super_admin", "call_center"]:
            raise HTTPException(status_code=403, detail="No tienes permisos para generar PDFs")

        # Buscar cliente por cliente_id string
        cliente = await collection_clients.find_one({"cliente_id": cliente_id})
        if not cliente:
            raise HTTPException(status_code=404, detail=f"Cliente no encontrado: {cliente_id}")

        cliente_db_id = cliente.get('cliente_id')        # "CL-30549"
        cliente_object_id = str(cliente.get('_id'))      # ObjectId como string

        print(f"✅ Cliente encontrado: {cliente.get('nombre')} {cliente.get('apellido', '')}")

        # Buscar cita por ObjectId
        try:
            cita = await collection_citas.find_one({"_id": ObjectId(cita_id)})
        except Exception:
            raise HTTPException(status_code=400, detail=f"Cita ID no válido: {cita_id}")

        if not cita:
            raise HTTPException(status_code=404, detail=f"Cita no encontrada: {cita_id}")

        print(f"✅ Cita encontrada: servicio={cita.get('servicio_nombre')}, sede={cita.get('sede_id')}")

        # ============================================================
        # 🔥 BÚSQUEDA DE FICHA - ESTRATEGIA MÚLTIPLE
        # Soporta fichas nuevas (ObjectId) y fichas migradas (string ID)
        # ============================================================
        ficha = None

        # 1. Por cita_id en datos_especificos (fichas nuevas)
        ficha = await collection_card.find_one({"datos_especificos.cita_id": cita_id})
        print(f"{'✅' if ficha else '⚠️'} Estrategia 1 (cita_id): {'ok' if ficha else 'miss'}")

        # 2. Por ObjectId del cliente + servicio_id
        if not ficha:
            try:
                ficha = await collection_card.find_one({
                    "cliente_id": ObjectId(cliente.get('_id')),
                    "servicio_id": cita.get('servicio_id')
                })
                print(f"{'✅' if ficha else '⚠️'} Estrategia 2 (ObjectId + servicio_id): {'ok' if ficha else 'miss'}")
            except Exception:
                pass

        # 3. Por cliente_id STRING + servicio_id (fichas migradas)
        if not ficha and cita.get('servicio_id'):
            ficha = await collection_card.find_one({
                "cliente_id": cliente_db_id,
                "servicio_id": cita.get('servicio_id')
            })
            print(f"{'✅' if ficha else '⚠️'} Estrategia 3 (string + servicio_id): {'ok' if ficha else 'miss'}")

        # 4. Por cliente_id STRING + servicio_nombre (fichas migradas)
        if not ficha and cita.get('servicio_nombre'):
            ficha = await collection_card.find_one({
                "cliente_id": cliente_db_id,
                "servicio_nombre": cita.get('servicio_nombre')
            })
            print(f"{'✅' if ficha else '⚠️'} Estrategia 4 (string + servicio_nombre): {'ok' if ficha else 'miss'}")

        # 5. Por cliente_id STRING + sede_id → la más reciente con mejor match
        if not ficha:
            fichas_candidatas = await collection_card.find({
                "cliente_id": cliente_db_id,
                "sede_id": cita.get('sede_id')
            }).sort("fecha_ficha", -1).to_list(5)

            print(f"{'✅' if fichas_candidatas else '⚠️'} Estrategia 5 (string + sede): {len(fichas_candidatas)} candidatas")

            if fichas_candidatas:
                ficha = next(
                    (f for f in fichas_candidatas if f.get('servicio_nombre') == cita.get('servicio_nombre')),
                    fichas_candidatas[0]
                )

        # 6. Solo por cliente_id STRING → ficha más reciente (último recurso)
        if not ficha:
            ficha = await collection_card.find_one(
                {"cliente_id": cliente_db_id},
                sort=[("fecha_ficha", -1)]
            )
            print(f"{'✅' if ficha else '❌'} Estrategia 6 (solo cliente): {'ok' if ficha else 'miss'}")

        if not ficha:
            raise HTTPException(
                status_code=404,
                detail=f"No se encontró ficha técnica para cliente {cliente_db_id}, cita {cita_id}"
            )

        print(f"✅ Ficha encontrada: {ficha.get('_id')} | {ficha.get('tipo_ficha')} | {ficha.get('servicio_nombre')}")

        # Preparar datos de la cita para el PDF
        cita_data_for_pdf = {
            "cita_id": cita_id,
            "estado": cita.get("estado", "finalizado"),
            "fecha_finalizacion": cita.get("fecha_finalizacion", datetime.now()),
            "finalizado_por": cita.get("finalizado_por", "Sistema"),
            "valor_total": cita.get("valor_total", 0),
            "abono": cita.get("abono", 0),
            "saldo_pendiente": cita.get("saldo_pendiente", 0),
            "estado_pago": cita.get("estado_pago", "pendiente"),
            "metodo_pago_actual": cita.get("metodo_pago_actual"),
            "metodo_pago_inicial": cita.get("metodo_pago_inicial"),
            "moneda": cita.get("moneda", "COP"),
            "hora_fin": cita.get("hora_fin", "No especificado"),
        }

        pdf_bytes = await generar_pdf_ficha(ficha, cita_data_for_pdf)
        print(f"✅ PDF generado: {len(pdf_bytes)} bytes")

        nombre_cliente = f"{cliente.get('nombre', '').replace(' ', '_')}_{cliente.get('apellido', '').replace(' ', '_')}"
        fecha_actual = datetime.now().strftime("%Y%m%d")
        nombre_archivo = f"comprobante_{nombre_cliente}_{fecha_actual}.pdf"

        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{nombre_archivo}"',
                "Content-Length": str(len(pdf_bytes))
            }
        )

    except HTTPException as he:
        print(f"❌ HTTP Exception: {he.detail}")
        raise he
    except Exception as e:
        print(f"❌ Error generando PDF: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error generando PDF: {str(e)}")

# ============================================
# ✅ Versión alternativa que devuelve JSON + URL - CORREGIDA
# ============================================
@router.get("/generar-pdf-info/{cliente_id}/{cita_id}", response_model=dict)
async def generar_pdf_info(
    cliente_id: str,  # "CL-XXXXX"
    cita_id: str,     # ObjectId string
    current_user: dict = Depends(get_current_user)
):
    """
    Genera un PDF y devuelve información sobre él.
    """
    try:
        print(f"🔍 [PDF INFO] Buscando datos: cliente={cliente_id}, cita={cita_id}")
        
        # Buscar cliente por cliente_id (no ObjectId)
        cliente = await collection_clients.find_one({"cliente_id": cliente_id})
        if not cliente:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")
        
        # Buscar cita por ObjectId
        try:
            cita = await collection_citas.find_one({"_id": ObjectId(cita_id)})
        except:
            raise HTTPException(status_code=404, detail="Cita ID no válido")
        
        if not cita:
            raise HTTPException(status_code=404, detail="Cita no encontrada")
        
        # Buscar ficha técnica
        ficha = await collection_card.find_one({"datos_especificos.cita_id": cita_id})
        if not ficha:
            ficha = await collection_card.find_one({"cliente_id": ObjectId(cliente.get('_id'))})
        
        if not ficha:
            raise HTTPException(status_code=404, detail="No se encontró ficha técnica")
        
        # Preparar datos para el PDF
        cita_data_for_pdf = {
            "cita_id": cita_id,
            "estado": cita.get("estado", "finalizado"),
            "valor_total": cita.get("valor_total", 0),
            "abono": cita.get("abono", 0),
            "saldo_pendiente": cita.get("saldo_pendiente", 0),
            "estado_pago": cita.get("estado_pago", "pendiente"),
            "metodo_pago_actual": cita.get("metodo_pago_actual"),
            "metodo_pago_inicial": cita.get("metodo_pago_inicial"),
            "fecha_finalizacion": cita.get("fecha_finalizacion", datetime.now()),
            "finalizado_por": cita.get("finalizado_por", "Sistema"),
        }
        
        # Generar PDF (pero no lo devolvemos, solo para calcular tamaño)
        pdf_bytes = await generar_pdf_ficha(ficha, cita_data_for_pdf)
        
        # Calcular tamaño
        pdf_size_kb = len(pdf_bytes) / 1024
        
        # Información del documento
        info = {
            "success": True,
            "message": "PDF generado exitosamente",
            "cliente": {
                "id": cliente.get('cliente_id', str(cliente["_id"])),
                "nombre": f"{cliente.get('nombre', '')} {cliente.get('apellido', '')}",
                "documento": cliente.get('cedula', 'No especificado'),
                "email": cliente.get('email', 'No especificado')
            },
            "cita": {
                "id": str(cita["_id"]),
                "servicio": cita.get('servicio_nombre', 'No especificado'),
                "fecha": cita.get('fecha_reserva', 'No especificado'),
                "estado": cita.get('estado', 'No especificado'),
                "valor_total": cita.get('valor_total', 0)
            },
            "pdf": {
                "tamano_bytes": len(pdf_bytes),
                "tamano_kb": round(pdf_size_kb, 2),
                "fecha_generacion": datetime.now().isoformat(),
                "disponible_descarga": True
            },
            "download_url": f"/api/pdf/generar-pdf/{cliente_id}/{cita_id}"
        }
        
        # Si el PDF es muy grande, dar advertencia
        if pdf_size_kb > 1024:  # Más de 1MB
            info["advertencia"] = f"El PDF es grande ({round(pdf_size_kb/1024, 2)} MB), puede tardar en descargarse"
        
        return info
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error en PDF info: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno: {str(e)}")


# ============================================
# ✅ Endpoint para reenviar PDF por correo - CORREGIDO
# ============================================
@router.post("/reenviar-pdf-correo/{cliente_id}/{cita_id}", response_model=dict)
async def reenviar_pdf_correo(
    cliente_id: str,  # "CL-XXXXX"
    cita_id: str,     # ObjectId string
    email_destino: str = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Reenvía el PDF por correo electrónico.
    """
    try:
        # Buscar cliente
        cliente = await collection_clients.find_one({"cliente_id": cliente_id})
        if not cliente:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")
        
        # Buscar cita
        try:
            cita = await collection_citas.find_one({"_id": ObjectId(cita_id)})
        except:
            raise HTTPException(status_code=404, detail="Cita ID no válido")
        
        if not cita:
            raise HTTPException(status_code=404, detail="Cita no encontrada")
        
        # Buscar ficha
        ficha = await collection_card.find_one({"datos_especificos.cita_id": cita_id})
        if not ficha:
            raise HTTPException(status_code=404, detail="No se encontró ficha técnica")
        
        # Determinar email destino
        email_a_usar = email_destino or cliente.get('email') or ficha.get('email')
        if not email_a_usar:
            raise HTTPException(
                status_code=400,
                detail="No se encontró email del cliente. Especifique un email destino."
            )
        
        # Preparar datos para PDF
        cita_data_for_pdf = {
            "cita_id": cita_id,
            "estado": cita.get("estado", "finalizado"),
            "valor_total": cita.get("valor_total", 0),
            "abono": cita.get("abono", 0),
            "saldo_pendiente": cita.get("saldo_pendiente", 0),
            "estado_pago": cita.get("estado_pago", "pendiente"),
            "fecha_finalizacion": cita.get("fecha_finalizacion", datetime.now()),
            "finalizado_por": cita.get("finalizado_por", "Sistema"),
        }
        
        # Generar PDF
        pdf_bytes = await generar_pdf_ficha(ficha, cita_data_for_pdf)
        
        # Crear HTML del correo
        html_correo = crear_html_correo_ficha(
            cliente_nombre=f"{cliente.get('nombre', '')} {cliente.get('apellido', '')}",
            servicio_nombre=ficha.get('servicio_nombre', 'Servicio'),
            fecha=datetime.now().strftime("%d/%m/%Y %H:%M")
        )
        
        # Crear nombre del archivo
        nombre_archivo = f"ficha_diagnostico_{cliente_id[-6:]}_{cita_id[-6:]}.pdf"
        
        # Enviar correo
        enviado = await enviar_correo_con_pdf(
            destinatario=email_a_usar,
            asunto=f"📄 Ficha Diagnostico - {ficha.get('servicio_nombre', 'Servicio')}",
            mensaje_html=html_correo,
            pdf_bytes=pdf_bytes,
            nombre_archivo=nombre_archivo
        )
        
        if enviado:
            # Registrar envío en la base de datos
            await collection_citas.update_one(
                {"_id": ObjectId(cita_id)},
                {"$set": {
                    "ultimo_envio_pdf": datetime.now(),
                    "pdf_enviado_a": email_a_usar,
                    "reenviado_por": current_user.get("email")
                }}
            )
            
            return {
                "success": True,
                "message": f"PDF enviado exitosamente a {email_a_usar}",
                "email_destino": email_a_usar,
                "fecha_envio": datetime.now().isoformat(),
                "tamano_pdf_kb": round(len(pdf_bytes) / 1024, 2)
            }
        else:
            raise HTTPException(
                status_code=500,
                detail="Error al enviar el correo con el PDF"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error reenviando PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno: {str(e)}")