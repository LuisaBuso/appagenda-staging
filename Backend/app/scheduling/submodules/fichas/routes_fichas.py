
from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Form
from datetime import datetime, time, timedelta
from app.scheduling.models import FichaCreate, ServicioEnFicha
from app.scheduling.submodules.quotes.controllers import generar_pdf_ficha, crear_html_correo_ficha, enviar_correo_con_pdf
from app.scheduling.submodules.fichas.controllers import generar_y_enviar_pdf_ficha
import traceback
from typing import Optional, List
from bson import ObjectId
import json
import os
import boto3
import uuid
from app.auth.routes import get_current_user

from app.database.mongo import (
    collection_citas,
    collection_servicios,
    collection_estilista,
    collection_locales,
    collection_clients,
    collection_card
)

router = APIRouter(tags=["Fichas"])

# ============================================================
# 🔹 AWS CONFIGURATION
# ============================================================

AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_BUCKET_NAME = os.getenv("AWS_BUCKET_NAME")
AWS_REGION = os.getenv("AWS_REGION")

s3_client = boto3.client(
    's3',
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv("AWS_REGION", "us-west-2")
)


def upload_to_s3(file: UploadFile, folder_path: str) -> str:
    try:
        file_content   = file.file.read()
        file_extension = file.filename.split('.')[-1].lower() if file.filename else "jpg"

        print(f"📷 Subiendo: {file.filename} | {len(file_content)} bytes | {file.content_type}")

        # ── Convertir a JPEG si no lo es ya ──────────────────────────────────
        if file_extension not in ("jpg", "jpeg"):
            try:
                from PIL import Image as PILImage, ImageOps
                from io import BytesIO as _BytesIO

                # Intento 1: PIL normal (funciona con PNG, WEBP, y HEIC de iPhone)
                try:
                    img = PILImage.open(_BytesIO(file_content))
                    img.load()
                    print(f"  ✅ PIL abrió OK: modo={img.mode} tamaño={img.size}")

                except Exception as e_pil:
                    # Intento 2: fallback HEIF manual (Samsung msf1/mif1)
                    print(f"  ⚠️ PIL falló ({e_pil}), intentando HEIF fallback...")
                    try:
                        import pillow_heif
                        heif_file = pillow_heif.read_heif(file_content)
                        img = PILImage.frombytes(
                            heif_file.mode,
                            heif_file.size,
                            heif_file.data,
                            "raw",
                        )
                        print(f"  ✅ HEIF fallback OK: modo={img.mode} tamaño={img.size}")
                    except Exception as e_heif:
                        print(f"  ❌ HEIF fallback también falló: {e_heif}")
                        raise HTTPException(
                            status_code=400,
                            detail="Formato de imagen no soportado. Usa JPG, PNG o cambia la configuración de cámara del celular."
                        )

                # Corregir rotación EXIF (iPhone y Samsung)
                try:
                    img = ImageOps.exif_transpose(img)
                except Exception:
                    pass

                # Fondo blanco si tiene transparencia
                if img.mode in ("RGBA", "LA", "P"):
                    fondo = PILImage.new("RGB", img.size, (255, 255, 255))
                    if img.mode == "P":
                        img = img.convert("RGBA")
                    fondo.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
                    img = fondo
                else:
                    img = img.convert("RGB")

                # Redimensionar si es muy grande (fotos iPhone/Samsung son 4000+ px)
                w, h = img.size
                if max(w, h) > 2000:
                    ratio = 2000 / max(w, h)
                    img   = img.resize((int(w * ratio), int(h * ratio)), PILImage.LANCZOS)

                out = _BytesIO()
                img.save(out, format="JPEG", quality=85, optimize=True)
                file_content   = out.getvalue()
                file_extension = "jpg"
                print(f"  ✅ Convertido a JPEG exitosamente ({len(file_content)} bytes)")

            except HTTPException:
                raise  # Re-lanzar el 400 sin envolver
            except Exception as e:
                print(f"  ❌ Error inesperado en conversión: {e}")
                raise HTTPException(status_code=500, detail=f"Error procesando imagen: {str(e)}")

        # ── Subir a S3 ───────────────────────────────────────────────────────
        unique_filename = f"{uuid.uuid4()}.{file_extension}"
        s3_key          = f"{folder_path}/{unique_filename}"

        s3_client.put_object(
            Bucket=os.getenv("AWS_BUCKET_NAME"),
            Key=s3_key,
            Body=file_content,
            ContentType="image/jpeg",
        )

        base_url = os.getenv("AWS_PUBLIC_BASE_URL")
        if not base_url:
            raise RuntimeError("AWS_PUBLIC_BASE_URL no está configurado")

        url_final = f"{base_url}/{s3_key}"
        print(f"  ☁️ Subido a S3: {url_final}")
        return url_final

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


### Resumen de la lógica
'''
Foto entra
    │
    ├── ¿Ya es JPG/JPEG? → Sube directo ✅
    │
    └── ¿Otro formato (HEIC/HEIF/PNG/WEBP)?
            │
            ├── Intento 1: PILImage.open() → funciona con iPhone, PNG, WEBP
            │
            ├── Intento 2: pillow_heif.read_heif() → cubre Samsung msf1/mif1
            │
            └── ¿Ambos fallan? → HTTP 400 (nunca sube basura a S3)'''

# =============================================================
# 🔹 OBTENER FICHAS POR CLIENTE (con filtros inteligentes)
# ⭐ ACTUALIZADO PARA SOPORTAR MÚLTIPLES SERVICIOS
# =============================================================
@router.get("/fichas", response_model=dict)
async def obtener_fichas_por_cliente(
    cliente_id: str = Query(...),
    cita_id: str = Query(None, description="Filtrar por cita específica (para facturación)"),
    fecha: str = Query(None, description="Filtrar por fecha (YYYY-MM-DD)"),
    solo_hoy: bool = Query(True, description="Solo fichas de hoy"),
    limit: int = Query(10, description="Límite de resultados"),
    current_user: dict = Depends(get_current_user)
):
    """
    Obtiene fichas técnicas de un cliente con filtros opcionales.
    
    Ejemplos de uso:
    - Facturación: ?cliente_id=CL-90411&cita_id=6941c18a...
    - Historial: ?cliente_id=CL-90411
    - Fichas de hoy: ?cliente_id=CL-90411&solo_hoy=true
    
    ⭐ PRIORIDAD DE FILTROS:
    1. cita_id (ignora fecha y solo_hoy)
    2. fecha específica
    3. solo_hoy
    4. cliente_id solo
    """
    
    # -----------------------------------------
    # 1. Validación de acceso
    # -----------------------------------------
    rol = current_user["rol"]
    if rol not in ["super_admin", "admin_franquicia", "admin_sede", "estilista", "call_center", "recepcionista"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    # -----------------------------------------
    # 2. Construir filtro dinámico
    # -----------------------------------------
    filtro = {"cliente_id": cliente_id}

    # 🔹 PRIORIDAD 1: Si pasan cita_id, buscar en datos_especificos.cita_id
    if cita_id:
        filtro["datos_especificos.cita_id"] = cita_id
        limit = 1  # Solo necesitamos una
        print(f"🔍 Buscando ficha con cita_id: {cita_id}")
    
    # 🔹 PRIORIDAD 2: Filtrar por fecha específica
    elif fecha:
        filtro["fecha_reserva"] = fecha
        print(f"🔍 Buscando fichas con fecha: {fecha}")
    
    # 🔹 PRIORIDAD 3: Filtrar por hoy
    elif solo_hoy:
        from datetime import datetime
        hoy = datetime.now().strftime("%Y-%m-%d")
        filtro["fecha_reserva"] = hoy
        print(f"🔍 Buscando fichas de hoy: {hoy}")
    
    else:
        print(f"🔍 Buscando todas las fichas del cliente: {cliente_id}")

    # -----------------------------------------
    # 3. Buscar fichas
    # -----------------------------------------
    print(f"📋 Filtro aplicado: {filtro}")
    
    fichas = (
        await collection_card
        .find(filtro)
        .sort("fecha_ficha", -1)
        .limit(limit)
        .to_list(None)
    )

    print(f"✅ Fichas encontradas: {len(fichas)}")

    if not fichas:
        return {"success": True, "total": 0, "fichas": []}

    resultado = []

    # -----------------------------------------
    # 4. Enriquecer cada ficha
    # -----------------------------------------
    for ficha in fichas:
        # Extraer cita_id desde datos_especificos si existe
        datos_especificos = ficha.get("datos_especificos", {})
        cita_id_ficha = datos_especificos.get("cita_id") if isinstance(datos_especificos, dict) else None
        
        # ⭐ NUEVA LÓGICA: Manejar múltiples servicios
        servicios_ficha = ficha.get("servicios", [])
        servicio_id_principal = ficha.get("servicio_id")  # Compatibilidad
        
        # Si tiene array de servicios (nuevo formato)
        if servicios_ficha and isinstance(servicios_ficha, list):
            # Enriquecer todos los servicios
            servicios_enriquecidos = []
            for serv in servicios_ficha:
                servicio_db = await collection_servicios.find_one(
                    {"servicio_id": serv.get("servicio_id")}
                )
                servicios_enriquecidos.append({
                    "servicio_id": serv.get("servicio_id"),
                    "nombre": serv.get("nombre") or (servicio_db.get("nombre") if servicio_db else "Desconocido"),
                    "precio": serv.get("precio", 0)
                })
        
        # Si solo tiene servicio_id único (formato antiguo)
        elif servicio_id_principal:
            servicio_db = await collection_servicios.find_one(
                {"servicio_id": servicio_id_principal}
            )
            servicios_enriquecidos = [{
                "servicio_id": servicio_id_principal,
                "nombre": servicio_db.get("nombre") if servicio_db else "Desconocido",
                "precio": ficha.get("precio", 0)
            }]
        
        else:
            servicios_enriquecidos = []
        
        # Construir objeto de respuesta
        ficha_norm = {
            "id": str(ficha.get("_id")),
            "cita_id": cita_id_ficha,
            "cliente_id": ficha.get("cliente_id"),
            "nombre": ficha.get("nombre"),
            "apellido": ficha.get("apellido"),
            "telefono": ficha.get("telefono"),
            "cedula": ficha.get("cedula"),
            
            # ⭐ CAMBIO: Ahora devuelve array de servicios
            "servicios": servicios_enriquecidos,
            
            # ⭐ COMPATIBILIDAD: Mantener campos antiguos
            "servicio_id": servicio_id_principal,
            "servicio_nombre": servicios_enriquecidos[0]["nombre"] if servicios_enriquecidos else None,
            
            "profesional_id": ficha.get("profesional_id"),
            "sede_id": ficha.get("sede_id"),
            "fecha_ficha": ficha.get("fecha_ficha"),
            "fecha_reserva": ficha.get("fecha_reserva"),
            "tipo_ficha": ficha.get("tipo_ficha"),
            "precio": ficha.get("precio"),
            "estado": ficha.get("estado"),
            "estado_pago": ficha.get("estado_pago"),
            "contenido": datos_especificos,
        }

        # Enriquecimiento de profesional y sede
        profesional = await collection_estilista.find_one(
            {"profesional_id": ficha.get("profesional_id")}
        )
        sede = await collection_locales.find_one(
            {"sede_id": ficha.get("sede_id")}
        )

        ficha_norm["profesional_nombre"] = profesional.get("nombre") if profesional else None
        ficha_norm["sede_nombre"] = sede.get("nombre") if sede else None

        resultado.append(ficha_norm)

    # -----------------------------------------
    # 5. Respuesta final
    # -----------------------------------------
    return {
        "success": True,
        "total": len(resultado),
        "fichas": resultado
    }

def parse_ficha(data: str = Form(...)):
    try:
        parsed = json.loads(data)
        return FichaCreate(**parsed)
    except Exception as e:
        print("Error parseando JSON de ficha:", e)
        raise HTTPException(422, "Formato inválido en 'data'. Debe ser JSON válido.")   

# ============================================================
# 📌 Crear ficha 
# ============================================================
@router.post("/create-ficha", response_model=dict)
async def crear_ficha(
    data: FichaCreate = Depends(parse_ficha),
    fotos_antes: Optional[List[UploadFile]] = File(None),
    fotos_despues: Optional[List[UploadFile]] = File(None),
    current_user: dict = Depends(get_current_user)
):
    print("📝 Data recibida:", data.dict())

    # ------------------------------
    # ⭐ COMPATIBILIDAD: Determinar servicio(s)
    # ------------------------------
    servicios_lista = []
    servicio_id_principal = None
    
    # Caso 1: Viene servicios (array) - NUEVO FORMATO
    if data.servicios and len(data.servicios) > 0:
        servicios_lista = data.servicios
        servicio_id_principal = data.servicios[0].servicio_id
        print(f"✅ Usando servicios (array): {[s.servicio_id for s in servicios_lista]}")
    
    # Caso 2: Viene servicio_id único - FORMATO ANTIGUO
    elif data.servicio_id:
        servicios_lista = [ServicioEnFicha(servicio_id=data.servicio_id)]
        servicio_id_principal = data.servicio_id
        print(f"✅ Usando servicio_id único: {servicio_id_principal}")
    
    else:
        raise HTTPException(400, "Debe especificar al menos un servicio")

    # ------------------------------
    # VALIDAR
    # ------------------------------
    if current_user.get("rol") not in ["estilista", "admin_sede", "super_admin"]:
        raise HTTPException(403, "No autorizado")

    cliente = await collection_clients.find_one({"cliente_id": data.cliente_id})
    if not cliente:
        raise HTTPException(404, "Cliente no encontrado")

    # ⭐ VALIDAR TODOS LOS SERVICIOS
    servicios_validados = []
    precio_total = 0
    
    for servicio_item in servicios_lista:
        servicio = await collection_servicios.find_one({
            "$or": [
                {"servicio_id": servicio_item.servicio_id},
                {"unique_id": servicio_item.servicio_id}
            ]
        })
        if not servicio:
            raise HTTPException(404, f"Servicio {servicio_item.servicio_id} no encontrado")
        
        servicios_validados.append({
            "servicio_id": servicio_item.servicio_id,
            "nombre": servicio.get("nombre"),
            "precio": servicio_item.precio or servicio.get("precio", 0)
        })
        
        precio_total += servicio_item.precio or servicio.get("precio", 0)

    profesional = await collection_estilista.find_one({
        "profesional_id": data.profesional_id
    })
    if not profesional:
        raise HTTPException(404, "Profesional no encontrado")

    sede = await collection_locales.find_one({"sede_id": data.sede_id})
    if not sede:
        raise HTTPException(404, "Sede no encontrada")

    # ------------------------------
    # SUBIR FOTOS
    # ------------------------------
    urls_antes = []
    if fotos_antes:
        for foto in fotos_antes:
            url = upload_to_s3(
                foto,
                f"companies/{sede.get('company_id','default')}/clients/{data.cliente_id}/fichas/{data.tipo_ficha}/antes"
            )
            urls_antes.append(url)

    urls_despues = []
    if fotos_despues:
        for foto in fotos_despues:
            url = upload_to_s3(
                foto,
                f"companies/{sede.get('company_id','default')}/clients/{data.cliente_id}/fichas/{data.tipo_ficha}/despues"
            )
            urls_despues.append(url)

    # ------------------------------
    # FIX RESPUESTAS
    # ------------------------------
    respuestas_final = data.respuestas

    if "respuestas" in data.datos_especificos:
        respuestas_final = data.datos_especificos.get("respuestas", [])

    # ------------------------------
    # ⭐ OBJETO FINAL CON SERVICIOS
    # ------------------------------
    ficha = {
        "_id": ObjectId(),
        "cliente_id": data.cliente_id,
        "sede_id": data.sede_id,
        
        # ⭐ COMPATIBILIDAD: Guardar ambos formatos
        "servicio_id": servicio_id_principal,  # Para queries antiguas
        "servicios": servicios_validados,  # NUEVO: Lista completa
        
        "servicio_nombre": servicios_validados[0]["nombre"],  # Primer servicio
        "profesional_id": data.profesional_id,
        "profesional_nombre": data.profesional_nombre or profesional.get("nombre"),
        "sede_nombre": sede.get("nombre"),

        "fecha_ficha": data.fecha_ficha or datetime.now(),
        "fecha_reserva": data.fecha_reserva,

        "correo": data.email or cliente.get("correo"),
        "nombre": data.nombre or cliente.get("nombre"),
        "apellido": data.apellido or cliente.get("apellido"),
        "cedula": data.cedula or cliente.get("cedula"),
        "telefono": data.telefono or cliente.get("telefono"),

        "precio": data.precio or precio_total,  # ⭐ Suma de todos los servicios
        "estado": data.estado,
        "estado_pago": data.estado_pago,

        "tipo_ficha": data.tipo_ficha,

        "datos_especificos": data.datos_especificos,
        "descripcion_servicio": data.descripcion_servicio,
        "respuestas": respuestas_final,

        "fotos": {
            "antes": urls_antes,
            "despues": urls_despues,
            "antes_urls": data.fotos_antes,
            "despues_urls": data.fotos_despues
        },

        "autorizacion_publicacion": data.autorizacion_publicacion,
        "comentario_interno": data.comentario_interno,

        "created_at": datetime.now(),
        "created_by": current_user.get("email"),
        "user_id": current_user.get("user_id"),

        "procesado_imagenes": bool(urls_antes or urls_despues),
        "origen": "manual"
    }

    await collection_card.insert_one(ficha)

    ficha["_id"] = str(ficha["_id"])

    return {
        "success": True,
        "message": "Ficha creada exitosamente",
        "ficha": ficha
    }


# ============================================================
# ✏️ EDITAR FICHA
# ============================================================
@router.put("/fichas/{ficha_id}", response_model=dict)
async def editar_ficha(
    ficha_id: str,
    data: str = Form(...),
    fotos_antes: Optional[List[UploadFile]] = File(None),
    fotos_despues: Optional[List[UploadFile]] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Edita una ficha técnica existente.

    ⭐ FOTOS:
    - Si envías fotos_antes  → reemplaza SOLO las fotos de antes
    - Si envías fotos_despues → reemplaza SOLO las fotos de despues
    - Si no envías fotos     → las fotos no se tocan
    - Las fotos SIEMPRE reemplazan, nunca se acumulan

    ⭐ PDF:
    - reenviar_pdf: true → regenera el PDF con los datos actualizados
                           y lo reenvía al correo del cliente
    """

    # ------------------------------
    # PARSEAR BODY
    # ------------------------------
    try:
        cambios = json.loads(data)
    except Exception:
        raise HTTPException(status_code=422, detail="Formato inválido en 'data'. Debe ser JSON válido.")

    # ------------------------------
    # PERMISOS
    # ------------------------------
    if current_user.get("rol") not in ["estilista", "admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    # ------------------------------
    # BUSCAR FICHA
    # ------------------------------
    try:
        ficha = await collection_card.find_one({"_id": ObjectId(ficha_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="ID de ficha inválido")

    if not ficha:
        raise HTTPException(status_code=404, detail="Ficha no encontrada")

    # Estilistas solo pueden editar sus propias fichas
    if current_user["rol"] == "estilista":
        if ficha.get("profesional_id") != current_user.get("profesional_id"):
            raise HTTPException(status_code=403, detail="Solo puedes editar tus propias fichas")

    update_doc = {}

    # ------------------------------
    # SERVICIOS
    # ------------------------------
    if "servicios" in cambios:
        servicios_lista = cambios["servicios"]
        if not isinstance(servicios_lista, list) or len(servicios_lista) == 0:
            raise HTTPException(status_code=400, detail="Debe incluir al menos un servicio")

        servicios_validados = []
        precio_total = 0.0

        for serv in servicios_lista:
            servicio_id = serv.get("servicio_id")
            if not servicio_id:
                raise HTTPException(status_code=400, detail="Cada servicio debe tener servicio_id")

            servicio_db = await collection_servicios.find_one({
                "$or": [
                    {"servicio_id": servicio_id},
                    {"unique_id": servicio_id}
                ]
            })
            if not servicio_db:
                raise HTTPException(status_code=404, detail=f"Servicio {servicio_id} no encontrado")

            precio = float(serv.get("precio") or servicio_db.get("precio", 0))
            servicios_validados.append({
                "servicio_id": servicio_id,
                "nombre":      servicio_db.get("nombre"),
                "precio":      precio
            })
            precio_total += precio

        update_doc["servicios"]       = servicios_validados
        update_doc["servicio_id"]     = servicios_validados[0]["servicio_id"]
        update_doc["servicio_nombre"] = servicios_validados[0]["nombre"]
        if "precio" not in cambios:
            update_doc["precio"] = precio_total

    # ------------------------------
    # CAMPOS SIMPLES PERMITIDOS
    # ------------------------------
    campos_editables = [
        "tipo_ficha", "fecha_reserva", "fecha_ficha",
        "datos_especificos", "descripcion_servicio", "respuestas",
        "estado", "estado_pago", "precio",
        "autorizacion_publicacion", "comentario_interno",
        "nombre", "apellido", "telefono", "cedula", "correo"
    ]
    for campo in campos_editables:
        if campo in cambios:
            update_doc[campo] = cambios[campo]

    # ------------------------------
    # FOTOS — siempre reemplazan, nunca acumulan
    # Solo se toca el lado (antes/despues) que se envía
    # ------------------------------
    if fotos_antes or fotos_despues:
        sede       = await collection_locales.find_one({"sede_id": ficha.get("sede_id")})
        company_id = sede.get("company_id", "default") if sede else "default"
        cliente_id = ficha.get("cliente_id")
        tipo_ficha = cambios.get("tipo_ficha", ficha.get("tipo_ficha", "general"))

        fotos_actuales = ficha.get("fotos", {
            "antes": [], "despues": [], "antes_urls": [], "despues_urls": []
        })

        nuevas_antes   = fotos_actuales.get("antes", [])   # default: mantener las actuales
        nuevas_despues = fotos_actuales.get("despues", []) # default: mantener las actuales

        if fotos_antes:
            nuevas_antes = []  # ← reemplaza, no suma
            for foto in fotos_antes:
                url = upload_to_s3(
                    foto,
                    f"companies/{company_id}/clients/{cliente_id}/fichas/{tipo_ficha}/antes"
                )
                nuevas_antes.append(url)

        if fotos_despues:
            nuevas_despues = []  # ← reemplaza, no suma
            for foto in fotos_despues:
                url = upload_to_s3(
                    foto,
                    f"companies/{company_id}/clients/{cliente_id}/fichas/{tipo_ficha}/despues"
                )
                nuevas_despues.append(url)

        update_doc["fotos"] = {
            "antes":       nuevas_antes,
            "despues":     nuevas_despues,
            "antes_urls":  fotos_actuales.get("antes_urls", []),
            "despues_urls": fotos_actuales.get("despues_urls", [])
        }

    # ------------------------------
    # VALIDAR QUE HAY ALGO QUE EDITAR
    # ------------------------------
    if not update_doc:
        raise HTTPException(status_code=400, detail="No se enviaron campos para actualizar")

    # ------------------------------
    # METADATA
    # ------------------------------
    update_doc["updated_at"] = datetime.now()
    update_doc["updated_by"] = current_user.get("email")

    await collection_card.update_one(
        {"_id": ObjectId(ficha_id)},
        {"$set": update_doc}
    )

    # Leer la ficha ya actualizada (con las fotos nuevas)
    ficha_actualizada = await collection_card.find_one({"_id": ObjectId(ficha_id)})

    # ------------------------------
    # REENVIAR PDF (opcional)
    # ------------------------------
    pdf_result = {"pdf_generado": False, "pdf_enviado": False, "cliente_email": None}

    reenviar_pdf = cambios.get("reenviar_pdf", False)
    if reenviar_pdf:
        # Obtener cita_id desde datos_especificos de la ficha original
        datos_especificos = ficha.get("datos_especificos", {})
        cita_id_ficha = datos_especificos.get("cita_id") if isinstance(datos_especificos, dict) else None

        if not cita_id_ficha:
            print("⚠️ reenviar_pdf=true pero la ficha no tiene cita_id en datos_especificos")
        else:
            # Pasar la ficha YA ACTUALIZADA para que el PDF tenga las fotos nuevas
            pdf_result = await generar_y_enviar_pdf_ficha(ficha_actualizada, cita_id_ficha)

            # Registrar en la cita que el PDF fue reenviado
            if pdf_result["pdf_generado"] and cita_id_ficha:
                try:
                    await collection_citas.update_one(
                        {"_id": ObjectId(cita_id_ficha)},
                        {"$set": {
                            "pdf_generado":        True,
                            "pdf_fecha_generacion": datetime.now(),
                            "pdf_enviado":          pdf_result["pdf_enviado"]
                        }}
                    )
                except Exception:
                    pass  # No bloquear si la cita no existe o el ID es inválido

    ficha_actualizada["_id"] = str(ficha_actualizada["_id"])

    return {
        "success": True,
        "message": "Ficha actualizada exitosamente",
        "ficha":   ficha_actualizada,
        **pdf_result  # pdf_generado, pdf_enviado, cliente_email
    }

# ============================================================
# 🗑️ ELIMINAR FICHA
# ============================================================
@router.delete("/fichas/{ficha_id}", response_model=dict)
async def eliminar_ficha(
    ficha_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Elimina una ficha técnica.
    
    ⭐ REGLAS:
    - Estilistas solo pueden eliminar sus propias fichas
    - admin_sede y super_admin pueden eliminar cualquier ficha
    - No se puede eliminar si la cita asociada está en estado finalizado/completada
    """

    # ------------------------------
    # PERMISOS
    # ------------------------------
    if current_user.get("rol") not in ["estilista", "admin_sede", "super_admin"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    # ------------------------------
    # BUSCAR FICHA
    # ------------------------------
    try:
        ficha = await collection_card.find_one({"_id": ObjectId(ficha_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="ID de ficha inválido")

    if not ficha:
        raise HTTPException(status_code=404, detail="Ficha no encontrada")

    # Estilistas solo pueden eliminar sus propias fichas
    if current_user["rol"] == "estilista":
        if ficha.get("profesional_id") != current_user.get("profesional_id"):
            raise HTTPException(status_code=403, detail="Solo puedes eliminar tus propias fichas")

    # ------------------------------
    # VERIFICAR CITA ASOCIADA
    # ------------------------------
    datos_especificos = ficha.get("datos_especificos", {})
    cita_id = datos_especificos.get("cita_id") if isinstance(datos_especificos, dict) else None

    if cita_id:
        try:
            cita = await collection_citas.find_one({"_id": ObjectId(cita_id)})
            if cita:
                estados_bloqueados = {"completada", "finalizada", "finalizado"}
                estado_cita = str(cita.get("estado", "")).lower()
                if estado_cita in estados_bloqueados:
                    raise HTTPException(
                        status_code=400,
                        detail=f"No se puede eliminar la ficha porque la cita asociada está en estado '{cita.get('estado')}'"
                    )
        except HTTPException:
            raise
        except Exception:
            pass  # Si el ObjectId es inválido o la cita no existe, continuar normalmente

    # ------------------------------
    # ELIMINAR
    # ------------------------------
    await collection_card.delete_one({"_id": ObjectId(ficha_id)})

    return {
        "success": True,
        "message": "Ficha eliminada exitosamente",
        "ficha_id": ficha_id
    }