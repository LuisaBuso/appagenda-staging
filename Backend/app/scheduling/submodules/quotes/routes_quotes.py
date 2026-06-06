from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Form
from datetime import datetime, time, timedelta
import traceback
from typing import Optional, List
from email.message import EmailMessage
from email.utils import formataddr
import smtplib, ssl, os
from bson import ObjectId
import uuid
import boto3
import json
import logging
from dotenv import load_dotenv
load_dotenv()

from app.scheduling.submodules.fichas.controllers import generar_y_enviar_pdf_ficha
from app.commissions.comision_engine import resolver_config_comision, calcular_comision
from app.commissions.comision_context import construir_contexto
from app.scheduling.models import Cita, ProductoItem, PagoRequest, ServicioEnCita, ServicioEnFicha
from app.clients_service.routes_clientes import calcular_analytics_cliente
from app.database.mongo import (
    collection_citas,
    collection_horarios,
    collection_servicios,
    collection_estilista,
    collection_clients,
    collection_locales,
    collection_auth,
    collection_block,
    collection_card,
    collection_commissions,
    collection_products,
    collection_inventarios,
    collection_pre_bookings
)
from app.cash.utils_cash import fecha_a_datetime
from app.auth.routes import get_current_user
from app.utils.timezone import today_str, today

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()


# -----------------------
# EMAIL (config desde env)
# -----------------------
EMAIL_SENDER = os.getenv("EMAIL_REMITENTE")
EMAIL_PASSWORD = os.getenv("EMAIL_CONTRASENA")
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 465

def enviar_correo(destinatario: str, asunto: str, mensaje: str):
    """Envía correo HTML (SSL)."""
    try:
        msg = EmailMessage()
        msg["Subject"] = asunto
        msg["From"] = formataddr(("Rizos Felices", EMAIL_SENDER))
        msg["To"] = destinatario
        msg.set_content(mensaje, subtype="html")

        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT, context=context) as server:
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            server.send_message(msg)

        print(f"📧 Correo enviado a {destinatario}")
    except Exception as e:
        print("Error enviando email:", e)

# -----------------------
# HELPERS
# -----------------------
def normalize_cita_doc(doc: dict) -> dict:
    """Convierte _id a str y normaliza fecha si viene como datetime."""
    doc["_id"] = str(doc["_id"])
    if isinstance(doc.get("fecha"), datetime):
        doc["fecha"] = doc["fecha"].strftime("%Y-%m-%d")
    return doc

async def resolve_cita_by_id(cita_id: str) -> Optional[dict]:
    """
    Intenta resolver una cita por:
      1) campo cita_id (string de negocio)
      2) _id (ObjectId)
    Devuelve el documento o None.
    """
    cita = await collection_citas.find_one({"cita_id": cita_id})
    if cita:
        return cita
    try:
        cita = await collection_citas.find_one({"_id": ObjectId(cita_id)})
        return cita
    except Exception:
        return None

# ============================================================
# ENDPOINT PRE-RESERVAS
# ============================================================
from pydantic import BaseModel, Field

ROLES_ADMIN = {"admin", "admin_sede", "call_center", "recepcionista"}
DURACION_MINIMA = 5
DURACION_MAXIMA = 60
DURACION_DEFAULT = 10

class PreReservaRequest(BaseModel):
    sede_id: str
    profesional_id: str
    fecha: str
    hora_inicio: str
    duracion_minutos: int = Field(
        default=DURACION_DEFAULT,
        ge=DURACION_MINIMA,
        le=DURACION_MAXIMA,
        description="Minutos que dura la pre-reserva (5–60). Solo admins pueden superar 10."
    )
    notas: str = Field(default="", max_length=200)


@router.post("/pre-reservar")
async def pre_reservar_slot(
    datos: PreReservaRequest,
    current_user: dict = Depends(get_current_user)
):
    rol = current_user.get("rol", "")
    es_admin = rol in ROLES_ADMIN

    # Solo admins pueden poner más de 10 minutos
    duracion = datos.duracion_minutos
    if duracion > DURACION_DEFAULT and not es_admin:
        duracion = DURACION_DEFAULT  # silenciosamente lo baja, no rompe el flujo

    # Validar formato fecha/hora
    try:
        datetime.strptime(f"{datos.fecha} {datos.hora_inicio}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha u hora inválido. Usa YYYY-MM-DD y HH:MM")

    # Limpiar pre-reservas expiradas de este slot antes de verificar
    await collection_pre_bookings.delete_many({
        "profesional_id": datos.profesional_id,
        "sede_id": datos.sede_id,
        "fecha": datos.fecha,
        "hora_inicio": datos.hora_inicio,
        "expira_en": {"$lt": datetime.utcnow()}
    })

    # Verificar cita confirmada
    conflicto_cita = await collection_citas.find_one({
        "profesional_id": datos.profesional_id,
        "sede_id": datos.sede_id,
        "fecha": datos.fecha,
        "hora_inicio": datos.hora_inicio,
        "estado": {"$nin": ["cancelada", "cancelado"]}
    })
    if conflicto_cita:
        raise HTTPException(status_code=409, detail="Este horario ya tiene una cita confirmada")

    # Verificar pre-reserva activa (ya limpiamos las expiradas arriba)
    pre_reserva_activa = await collection_pre_bookings.find_one({
        "profesional_id": datos.profesional_id,
        "sede_id": datos.sede_id,
        "fecha": datos.fecha,
        "hora_inicio": datos.hora_inicio,
    })
    if pre_reserva_activa:
        reservado_por = pre_reserva_activa.get("reservado_por", "otro usuario")
        expira_en = pre_reserva_activa.get("expira_en")
        minutos_restantes = max(0, round((expira_en - datetime.utcnow()).total_seconds() / 60)) if expira_en else "?"
        raise HTTPException(
            status_code=409,
            detail=f"Horario en negociación por {reservado_por}. Libera en ~{minutos_restantes} min."
        )

    ahora = datetime.utcnow()
    resultado = await collection_pre_bookings.insert_one({
        "sede_id": datos.sede_id,
        "profesional_id": datos.profesional_id,
        "fecha": datos.fecha,
        "hora_inicio": datos.hora_inicio,
        "reservado_por": current_user.get("email"),
        "rol_reservador": rol,
        "notas": datos.notas,
        "duracion_minutos": duracion,
        "creado_en": ahora,
        "expira_en": ahora + timedelta(minutes=duracion)
    })

    expira_en_local = ahora + timedelta(minutes=duracion)

    return {
        "success": True,
        "pre_reserva_id": str(resultado.inserted_id),
        "duracion_minutos": duracion,
        "expira_en": expira_en_local.strftime("%H:%M:%S UTC"),
        "message": f"Slot bloqueado por {duracion} minutos."
    }


@router.delete("/pre-reservar/{pre_reserva_id}")
async def liberar_pre_reserva(
    pre_reserva_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Libera manualmente una pre-reserva. Admins pueden liberar cualquiera; otros solo la propia."""
    try:
        oid = ObjectId(pre_reserva_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID de pre-reserva inválido")

    pre_reserva = await collection_pre_bookings.find_one({"_id": oid})
    if not pre_reserva:
        # Ya expiró o no existe — para el frontend esto es éxito igual
        return {"success": True, "message": "Pre-reserva no encontrada (ya liberada o expirada)"}

    es_admin = current_user.get("rol") in ROLES_ADMIN
    es_propietario = pre_reserva.get("reservado_por") == current_user.get("email")

    if not es_admin and not es_propietario:
        raise HTTPException(status_code=403, detail="Solo puedes liberar tus propias pre-reservas")

    await collection_pre_bookings.delete_one({"_id": oid})
    return {"success": True, "message": "Pre-reserva liberada correctamente"}


@router.get("/disponibilidad")
async def obtener_disponibilidad(
    sede_id: str,
    fecha: str,
    profesional_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    # Limpiar globalmente las pre-reservas expiradas de esa sede/fecha antes de responder
    await collection_pre_bookings.delete_many({
        "sede_id": sede_id,
        "fecha": fecha,
        "expira_en": {"$lt": datetime.utcnow()}
    })

    filtro_citas = {
        "sede_id": sede_id,
        "fecha": fecha,
        "estado": {"$nin": ["cancelada", "cancelado"]}
    }
    filtro_pre = {"sede_id": sede_id, "fecha": fecha}

    if profesional_id:
        filtro_citas["profesional_id"] = profesional_id
        filtro_pre["profesional_id"] = profesional_id

    citas = await collection_citas.find(
        filtro_citas,
        {"hora_inicio": 1, "profesional_id": 1}
    ).to_list(None)

    pre_reservas = await collection_pre_bookings.find(
        filtro_pre,
        {"hora_inicio": 1, "profesional_id": 1, "expira_en": 1, "reservado_por": 1, "duracion_minutos": 1}
    ).to_list(None)

    ahora = datetime.utcnow()

    slots_ocupados = [
        {
            "hora": c["hora_inicio"],
            "profesional_id": c.get("profesional_id"),
            "tipo": "confirmada"
        }
        for c in citas
    ] + [
        {
            "hora": p["hora_inicio"],
            "profesional_id": p.get("profesional_id"),
            "tipo": "temporal",
            "pre_reserva_id": str(p["_id"]),
            "reservado_por": p.get("reservado_por"),
            "minutos_restantes": max(0, round((p["expira_en"] - ahora).total_seconds() / 60)) if p.get("expira_en") else 0,
            "duracion_minutos": p.get("duracion_minutos", DURACION_DEFAULT)
        }
        for p in pre_reservas
    ]

    return {"success": True, "slots_ocupados": slots_ocupados}

# ============================================================
# ENDPOINT OBTENER CITAS (con cálculos en tiempo real) con fecha
# ============================================================
@router.get("/", response_model=dict)
async def obtener_citas(
    sede_id: Optional[str] = Query(None),
    profesional_id: Optional[str] = Query(None),
    fecha: Optional[str] = Query(None, description="Fecha específica (YYYY-MM-DD)"),
    current_user: dict = Depends(get_current_user)
):
    try:
        # ⭐ SEDE: usar la del usuario autenticado (ya viene dinámica del header X-Sede-Id)
        # Si el frontend pasa sede_id en query, validar que coincida con la sede activa
        sede_activa = current_user.get("sede_id")
        es_super = current_user.get("rol") in ["super_admin", "call_center"]

        if sede_id and not es_super:
            # Validar que no pida una sede diferente a la que tiene activa
            sedes_autorizadas = list(set(
                [sede_activa] + current_user.get("sedes_permitidas", [])
            ))
            if sede_id not in sedes_autorizadas:
                raise HTTPException(status_code=403, detail="No tienes acceso a esa sede")
            filtro_sede = sede_id
        elif sede_id and es_super:
            filtro_sede = sede_id  # super_admin puede pedir cualquier sede
        else:
            filtro_sede = sede_activa  # default: sede activa del token

        # === CONSTRUIR FILTRO ===
        filtro = {}

        # ⭐ Sede siempre presente (excepto super_admin sin sede_id)
        if filtro_sede:
            filtro["sede_id"] = filtro_sede

        if profesional_id:
            from app.utils.scope import expand_profesional_filter
            filtro["profesional_id"] = expand_profesional_filter(profesional_id, current_user)

        if fecha:
            filtro["fecha"] = fecha
        else:
            # Sin fecha específica: rango temporal para no traer toda la historia
            hoy = datetime.now()
            fecha_inicio = (hoy - timedelta(days=30)).strftime("%Y-%m-%d")
            fecha_fin = (hoy + timedelta(days=60)).strftime("%Y-%m-%d")
            filtro["fecha"] = {"$gte": fecha_inicio, "$lte": fecha_fin}

        print(f"🔍 Buscando citas con filtro: {filtro}")


        # 🔥 OPCIÓN 1: Usar aggregate con allowDiskUse (solución rápida)
        pipeline = [
            {"$match": filtro},
            {"$sort": {"fecha": 1}}
        ]
        
        citas = await collection_citas.aggregate(
            pipeline,
            allowDiskUse=True  # Permite usar disco si se excede memoria
        ).to_list(None)

        # 🔥 ALTERNATIVA: Si prefieres usar find(), agregar límite
        # citas = await collection_citas.find(filtro).sort("fecha", 1).limit(500).to_list(500)

        print(f"✅ Se encontraron {len(citas)} citas")

        if not citas:
            return {"citas": []}

        # === Bulk fetch para enriquecer datos (solo si es necesario) ===
        servicio_ids = set()
        for cita in citas:
            if "servicios" in cita:
                for s in cita["servicios"]:
                    servicio_ids.add(s.get("servicio_id"))
            elif "servicios_ids" in cita:
                servicio_ids.update(cita["servicios_ids"])
            elif "servicio_id" in cita:
                servicio_ids.add(cita["servicio_id"])

        # Solo consultar servicios si hay IDs
        servicios_map = {}
        if servicio_ids:
            print(f"🔍 Buscando {len(servicio_ids)} servicios...")
            servicios = await collection_servicios.find(
                {"servicio_id": {"$in": list(servicio_ids)}}
            ).to_list(None)
            servicios_map = {s["servicio_id"]: s for s in servicios}
            print(f"✅ Se encontraron {len(servicios)} servicios")

        # === Enriquecer cada cita ===
        for cita in citas:
            try:
                normalize_cita_doc(cita)

                # ⭐ NUEVA ESTRUCTURA (con nombre y precio en servicios)
                if "servicios" in cita and cita["servicios"] and isinstance(cita["servicios"][0], dict):
                    primer_servicio = cita["servicios"][0]
                    
                    # Detectar si es nueva estructura (tiene campo "nombre")
                    if "nombre" in primer_servicio:
                        # Nueva estructura - nombres ya están en la cita
                        nombres = [s.get("nombre", "Servicio") for s in cita["servicios"]]
                        cita["servicio_nombre"] = ", ".join(nombres)
                        
                        # Duración: consultar solo para obtener duraciones
                        duracion_total = 0
                        for s in cita["servicios"]:
                            srv = servicios_map.get(s.get("servicio_id"))
                            if srv:
                                duracion_total += srv.get("duracion_minutos", 0)
                        cita["servicio_duracion"] = duracion_total
                        
                        # Ya no necesitas recalcular servicios_detalle, ya está en la cita
                        cita["servicios_detalle"] = cita["servicios"]
                    else:
                        # Estructura antigua (solo tiene servicio_id)
                        nombres = []
                        duracion = 0
                        for s in cita["servicios"]:
                            srv = servicios_map.get(s.get("servicio_id"))
                            if srv:
                                nombres.append(srv.get("nombre", "Servicio"))
                                duracion += srv.get("duracion_minutos", 0)
                        
                        cita["servicio_nombre"] = ", ".join(nombres) if nombres else "Sin servicio"
                        cita["servicio_duracion"] = duracion
                
                elif "servicio_id" in cita:
                    # Estructura muy antigua (un solo servicio)
                    srv = servicios_map.get(cita.get("servicio_id"))
                    cita["servicio_nombre"] = srv.get("nombre", "Sin servicio") if srv else "Sin servicio"
                    
            except Exception as e:
                print(f"❌ Error enriqueciendo cita {cita.get('_id')}: {str(e)}")
                # Continuar con las demás citas
                continue

        print(f"✅ Retornando {len(citas)} citas enriquecidas")
        return {"citas": citas}

    except Exception as e:
        print(f"❌ ERROR EN OBTENER_CITAS:")
        print(f"   Tipo: {type(e).__name__}")
        print(f"   Mensaje: {str(e)}")
        print(f"   Traceback:")
        traceback.print_exc()
        
        # Retornar error HTTP apropiado
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Error al obtener citas",
                "tipo": type(e).__name__,
                "mensaje": str(e),
                "filtro": filtro if 'filtro' in locals() else None
            }
        )

# =============================================================
# 🔹 CREAR CITA (ACTUALIZADA)
# =============================================================
@router.post("/", response_model=dict)
async def crear_cita(
    cita: Cita,
    current_user: dict = Depends(get_current_user)
):
    """
    Crea una cita con la nueva estructura optimizada.
    ✅ Guarda solo servicios: [{servicio_id, precio_personalizado}]
    ✅ Calcula totales en tiempo real
    ✅ Compatible con estructura antigua
    """
    print(f"🔍 crear_cita invocada por {current_user.get('email')}")

    # Validar permisos
    if current_user.get("rol") not in ["usuario", "admin_sede", "super_admin", "call_center", "recepcionista"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    fecha_str = cita.fecha.strftime("%Y-%m-%d") if isinstance(cita.fecha, datetime) else str(cita.fecha)

    # === Validaciones básicas ===
    cliente = await collection_clients.find_one({"cliente_id": cita.cliente_id})
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    profesional = await collection_estilista.find_one({"profesional_id": cita.profesional_id})
    if not profesional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    sede = await collection_locales.find_one({"sede_id": cita.sede_id})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    moneda_sede = sede.get("moneda", "COP")

    # ====================================
    # ⭐ PROCESAR SERVICIOS (NUEVA LÓGICA)
    # ====================================
    if not cita.servicios or len(cita.servicios) == 0:
        raise HTTPException(status_code=400, detail="Debe especificar al menos un servicio")

    servicios_procesados = []
    servicios_info = []  # Para email
    servicios_ids_vistos = set()
    valor_total = 0
    duracion_total = 0
    nombres_servicios = []  # Para denormalizar

    for servicio_item in cita.servicios:
        if servicio_item.servicio_id in servicios_ids_vistos:
            raise HTTPException(
                status_code=400,
                detail=f"Servicio duplicado en la cita: {servicio_item.servicio_id}"
            )
        servicios_ids_vistos.add(servicio_item.servicio_id)

        cantidad = int(servicio_item.cantidad or 1)
        if cantidad < 1:
            raise HTTPException(status_code=400, detail="La cantidad debe ser mayor o igual a 1")

        servicio_db = await collection_servicios.find_one({"servicio_id": servicio_item.servicio_id})
        if not servicio_db:
            raise HTTPException(status_code=404, detail=f"Servicio {servicio_item.servicio_id} no encontrado")

        # ⭐ DETERMINAR PRECIO
        es_personalizado = False
        if servicio_item.precio_personalizado is not None and servicio_item.precio_personalizado > 0:
            # Precio personalizado válido
            precio = float(servicio_item.precio_personalizado)
            es_personalizado = True
        else:
            # Usar precio de BD
            precios = servicio_db.get("precios", {})
            if moneda_sede not in precios:
                raise HTTPException(status_code=400, detail=f"Servicio sin precio en {moneda_sede}")
            precio = float(precios[moneda_sede])
            es_personalizado = False

        # Acumular totales
        subtotal = round(precio * cantidad, 2)
        valor_total += subtotal
        duracion_total += int(servicio_db.get("duracion_minutos", 0) or 0) * cantidad
        nombre_servicio = servicio_db.get("nombre", "Servicio")
        nombres_servicios.append(f"{nombre_servicio} x{cantidad}" if cantidad > 1 else nombre_servicio)
        servicios_info.append({
            "servicio_id": servicio_item.servicio_id,
            "nombre": nombre_servicio,
            "precio_unitario": round(precio, 2),
            "cantidad": cantidad,
            "subtotal": subtotal
        })

        # ⭐ GUARDAR SERVICIO (estructura mejorada)
        servicio_guardado = {
            "servicio_id": servicio_item.servicio_id,
            "nombre": nombre_servicio,  # ⭐ NUEVO
            "precio_personalizado": es_personalizado,  # ⭐ BOOLEANO
            "precio": round(precio, 2),  # ⭐ SIEMPRE guardar el precio unitario usado
            "cantidad": cantidad,
            "subtotal": subtotal
        }
        servicios_procesados.append(servicio_guardado)

    valor_total = round(valor_total, 2)
    # === Calcular estado de pago ===
    abono = float(cita.abono or 0)
    saldo_pendiente = round(valor_total - abono, 2)

    if saldo_pendiente <= 0:
        estado_pago = "pagado"
    elif abono > 0:
        estado_pago = "abonado"
    else:
        estado_pago = "pendiente"

    # === Historial de pagos ===
    historial_pagos = []
    if abono > 0:
        historial_pagos.append({
            "fecha": today(sede).replace(tzinfo=None),
            "monto": float(abono),
            "metodo": cita.metodo_pago_inicial,
            "tipo": "pago_completo" if saldo_pendiente <= 0 else "abono_inicial",
            "registrado_por": current_user.get("email"),
            "saldo_despues": float(saldo_pendiente)
        })

    """# === validar horario del profesional ===
    dia_semana = cita.fecha.isoweekday()
    horario = await collection_horarios.find_one({
        "profesional_id": cita.profesional_id,
        "disponibilidad": {
            "$elemMatch": {"dia_semana": dia_semana, "activo": True}
        }
    })
    if not horario:
        raise HTTPException(status_code=400, detail="El profesional no trabaja este día")

    dia_info = next((d for d in horario["disponibilidad"] if d["dia_semana"] == dia_semana), None)
    if not dia_info:
        raise HTTPException(status_code=400, detail="El profesional no tiene disponibilidad para ese día")

    hora_inicio_hor = time.fromisoformat(dia_info["hora_inicio"])
    hora_fin_hor = time.fromisoformat(dia_info["hora_fin"])
    hora_inicio_cita = time.fromisoformat(cita.hora_inicio)
    hora_fin_cita = time.fromisoformat(cita.hora_fin)

    if not (hora_inicio_hor <= hora_inicio_cita < hora_fin_hor and hora_inicio_hor < hora_fin_cita <= hora_fin_hor):
        raise HTTPException(status_code=400, detail="La cita está fuera del horario laboral del profesional")"""

    # === horario fijo para mostrar en email ===
    dia_info = {
        "hora_inicio": "09:00",
        "hora_fin": "18:00"
    }

    """# === validar bloqueos ===
    bloqueo = await collection_block.find_one({
        "profesional_id": cita.profesional_id,
        "fecha": fecha_str,
        "hora_inicio": {"$lt": cita.hora_fin},
        "hora_fin": {"$gt": cita.hora_inicio}
    })
    if bloqueo:
        raise HTTPException(
            status_code=400, 
            detail=f"El profesional tiene un bloqueo en ese horario (Motivo: {bloqueo.get('motivo', 'No especificado')})"
        )

    # === validar solape con otras citas (SOLO para diferentes clientes) ===
    # 🔥 CORRECCIÓN: Permitir al mismo cliente múltiples citas, pero no a diferentes clientes con el mismo profesional
    solape = await collection_citas.find_one({
        "profesional_id": cita.profesional_id,
        "cliente_id": {"$ne": cita.cliente_id},  # Solo verificar citas de OTROS clientes
        "fecha": fecha_str,
        "hora_inicio": {"$lt": cita.hora_fin},
        "hora_fin": {"$gt": cita.hora_inicio},
        "estado": {"$ne": "cancelada"}
    })
    if solape:
        cliente_solape_nombre = solape.get("cliente_nombre", "Cliente")
        raise HTTPException(
            status_code=400, 
            detail=f"El profesional ya tiene una cita con {cliente_solape_nombre} en ese horario"
        )"""

# ====================================
# ⭐ GUARDAR CITA CON DATOS DENORMALIZADOS
# ====================================
    data = {
        "sede_id": cita.sede_id,
        "cliente_id": cita.cliente_id,
        "profesional_id": cita.profesional_id,
    
        # ⭐ SERVICIOS (con nombres y precios)
        "servicios": servicios_procesados,
    
        # ⭐ DATOS DENORMALIZADOS (para consultas rápidas)
        "cliente_nombre": cliente.get("nombre"),
        "cliente_email": cliente.get("email") or cliente.get("correo"),
        "cliente_telefono": cliente.get("telefono"),
        "profesional_nombre": profesional.get("nombre"),
        "sede_nombre": sede.get("nombre"),
        "notas": cita.notas,
    
        # Fechas y estado
        "fecha": fecha_str,
        "hora_inicio": cita.hora_inicio,
        "hora_fin": cita.hora_fin,
        "estado": "confirmada" if abono > 0 else "pre_reservada",
        "requiere_confirmacion": abono == 0,
    
        # Pagos
        "metodo_pago_inicial": cita.metodo_pago_inicial,
        "metodo_pago_actual": cita.metodo_pago_inicial,
        "abono": float(abono),
        "valor_total": float(valor_total),
        "saldo_pendiente": float(saldo_pendiente),
        "estado_pago": estado_pago,
        "moneda": moneda_sede,
        "historial_pagos": historial_pagos,
    
        # Metadata
        "creada_por": current_user.get("email"),
        "creada_por_rol": current_user.get("rol"),
        "fecha_creacion": today(sede).replace(tzinfo=None),
        "ultima_actualizacion": today(sede).replace(tzinfo=None),
    }

    # Guardar en BD
    result = await collection_citas.insert_one(data)
    cita_id = str(result.inserted_id)

    # === construir email HTML mejorado ===
    estilo = """
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Poppins', sans-serif;
            background-color: #f8f9fa;
            color: #333;
            line-height: 1.6;
        }
        
        .email-container {
            max-width: 700px;
            margin: 30px auto;
            background: white;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
        }
        
        .email-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
        }
        
        .logo {
            width: 180px;
            margin-bottom: 20px;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
        }
        
        .header-title {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
        }
        
        .header-subtitle {
            font-size: 16px;
            opacity: 0.9;
            font-weight: 300;
        }
        
        .cita-id {
            background: rgba(255, 255, 255, 0.15);
            display: inline-block;
            padding: 8px 16px;
            border-radius: 50px;
            font-size: 14px;
            margin-top: 15px;
            letter-spacing: 1px;
        }
        
        .email-body {
            padding: 40px 30px;
        }
        
        .section-title {
            font-size: 18px;
            font-weight: 600;
            color: #4a5568;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e9ecef;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .section-title i {
            color: #667eea;
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .info-card {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 20px;
            border-left: 4px solid #667eea;
        }
        
        .info-label {
            font-size: 13px;
            color: #718096;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
        }
        
        .info-value {
            font-size: 16px;
            font-weight: 500;
            color: #2d3748;
        }
        
        .pago-section {
            background: linear-gradient(135deg, #f6f9ff 0%, #f0f4ff 100%);
            border-radius: 15px;
            padding: 25px;
            margin: 30px 0;
            border: 1px solid #e2e8f0;
        }
        
        .pago-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        
        .pago-item {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px dashed #cbd5e0;
        }
        
        .pago-item.total {
            border-bottom: 2px solid #4a5568;
            font-weight: 600;
            color: #2d3748;
        }
        
        .estado-pago {
            display: inline-block;
            padding: 8px 16px;
            border-radius: 50px;
            font-size: 14px;
            font-weight: 600;
            margin-top: 10px;
        }
        
        .estado-pagado {
            background: #c6f6d5;
            color: #22543d;
        }
        
        .estado-abonado {
            background: #fed7d7;
            color: #742a2a;
        }
        
        .estado-pendiente {
            background: #feebc8;
            color: #744210;
        }
        
        .instrucciones {
            background: #e6fffa;
            border-radius: 12px;
            padding: 25px;
            margin-top: 30px;
            border-left: 4px solid #38b2ac;
        }
        
        .instrucciones-title {
            font-size: 16px;
            font-weight: 600;
            color: #234e52;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .instrucciones-list {
            list-style: none;
        }
        
        .instrucciones-list li {
            padding: 8px 0;
            color: #4a5568;
        }
        
        .instrucciones-list li:before {
            content: "✓";
            color: #38b2ac;
            font-weight: bold;
            margin-right: 10px;
        }
        
        .email-footer {
            background: #2d3748;
            color: #cbd5e0;
            padding: 30px;
            text-align: center;
            font-size: 14px;
        }
        
        .footer-links {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin: 20px 0;
        }
        
        .footer-links a {
            color: #90cdf4;
            text-decoration: none;
        }
        
        .footer-links a:hover {
            text-decoration: underline;
        }
        
        .social-icons {
            display: flex;
            justify-content: center;
            gap: 15px;
            margin-top: 20px;
        }
        
        .social-icon {
            width: 36px;
            height: 36px;
            background: #4a5568;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            text-decoration: none;
            transition: all 0.3s ease;
        }
        
        .social-icon:hover {
            transform: translateY(-3px);
            background: #667eea;
        }
        
        @media (max-width: 600px) {
            .email-container {
                margin: 10px;
                border-radius: 15px;
            }
            
            .email-header {
                padding: 30px 20px;
            }
            
            .email-body {
                padding: 30px 20px;
            }
            
            .info-grid {
                grid-template-columns: 1fr;
            }
            
            .pago-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
    """

    # Símbolos de moneda
    simbolos = {
        "COP": {"simbolo": "$", "nombre": "COP"},
        "USD": {"simbolo": "US$", "nombre": "USD"},
        "MXN": {"simbolo": "MX$", "nombre": "MXN"},
        "EUR": {"simbolo": "€", "nombre": "EUR"}
    }
    moneda_info = simbolos.get(moneda_sede, {"simbolo": "$", "nombre": "COP"})
    
    # Determinar clase CSS para estado de pago
    estado_pago_class = {
        "pagado": "estado-pagado",
        "abonado": "estado-abonado",
        "pendiente": "estado-pendiente"
    }.get(estado_pago, "estado-pendiente")

    # Crear lista de nombres de servicios para el email
    nombres_servicios = [s["nombre"] for s in servicios_info]
    nombres_concatenados = ", ".join(nombres_servicios)

    mensaje_html = f"""
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirmación de Cita - Rizos Felices</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f4f4f4;
                margin: 0;
                padding: 0;
            }}
            .email-container {{
                max-width: 600px;
                margin: 20px auto;
                background-color: #ffffff;
                border-radius: 15px;
                overflow: hidden;
                box-shadow: 0 4px 10px rgba(0,0,0,0.1);
                border: 1px solid #f198c0;
            }}
            .email-header {{
                background-color: #000000; /* Fondo Negro */
                color: #ffffff;
                padding: 40px 20px;
                text-align: center;
            }}
            .logo {{
                max-width: 180px;
                margin-bottom: 20px;
            }}
            .header-title {{
                color: #f198c0; /* Rosa solicitado */
                margin: 0;
                font-size: 28px;
                text-transform: uppercase;
                letter-spacing: 2px;
            }}
            .header-subtitle {{
                margin: 10px 0 0;
                font-size: 16px;
                opacity: 0.9;
            }}
            .email-body {{
                padding: 30px;
            }}
            .section-title {{
                color: #333;
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 2px solid #f198c0; /* Borde rosa */
            }}
            .info-grid {{
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 15px;
                margin-bottom: 30px;
            }}
            .info-card {{
                background-color: #fff;
                padding: 15px;
                border-radius: 10px;
                border: 1px solid #f198c0; /* Bordes rosa */
            }}
            .info-label {{
                color: #f198c0; /* Texto rosa */
                font-size: 12px;
                text-transform: uppercase;
                font-weight: bold;
                margin-bottom: 5px;
            }}
            .info-value {{
                color: #333;
                font-size: 15px;
                font-weight: 600;
            }}
            .instrucciones {{
                background-color: #fff0f6; /* Fondo rosado muy clarito */
                padding: 20px;
                border-radius: 12px;
                border-left: 5px solid #f198c0;
            }}
            .instrucciones-title {{
                color: #f198c0;
                font-weight: bold;
                margin-bottom: 10px;
            }}
            .instrucciones-list {{
                margin: 0;
                padding-left: 20px;
                color: #555;
                font-size: 14px;
            }}
            .instrucciones-list li {{
                margin-bottom: 8px;
            }}
            .email-footer {{
                background-color: #f9f9f9;
                padding: 30px;
                text-align: center;
                color: #777;
                font-size: 13px;
            }}
            .footer-links a {{
                color: #f198c0;
                text-decoration: none;
                margin: 0 10px;
            }}
            .social-icons {{
                margin-top: 20px;
            }}
            .social-icon {{
                display: inline-block;
                width: 30px;
                height: 30px;
                background: #f198c0;
                color: white;
                border-radius: 50%;
                line-height: 30px;
                margin: 0 5px;
                text-decoration: none;
                font-size: 12px;
                font-weight: bold;
            }}
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="email-header">
                <img class="logo" src="https://rizosfelicesdata.s3.us-east-2.amazonaws.com/logo+principal+rosado+letra+blanco_Mesa+de+tra+(1).png" alt="Rizos Felices">
                <h1 class="header-title">¡Cita Confirmada!</h1>
                <p class="header-subtitle">Tu reserva ha sido agendada exitosamente</p>
            </div>
        
            <div class="email-body">
                <div class="section-title">
                    <span>📅 Detalles de la cita</span>
                </div>
            
                <div class="info-grid">
                    <div class="info-card">
                        <div class="info-label">Cliente</div>
                        <div class="info-value">{cliente.get('nombre')}</div>
                    </div>
                
                    <div class="info-card">
                        <div class="info-label">Servicio(s)</div>
                        <div class="info-value">{nombres_concatenados}</div>
                        <small style="color:#888;">{duracion_total} minutos</small>
                    </div>
                
                    <div class="info-card">
                        <div class="info-label">Profesional</div>
                        <div class="info-value">{profesional.get('nombre')}</div>
                    </div>
                
                    <div class="info-card">
                        <div class="info-label">Sede</div>
                        <div class="info-value">{sede.get('nombre')}</div>
                        <small style="color:#888;">{sede.get('direccion', '')}</small>
                    </div>
                
                    <div class="info-card">
                        <div class="info-label">Fecha</div>
                        <div class="info-value">{fecha_str}</div>
                    </div>
                
                    <div class="info-card">
                        <div class="info-label">Horario</div>
                        <div class="info-value">{cita.hora_inicio} - {cita.hora_fin}</div>
                    </div>
                </div>
            
                <div class="instrucciones">
                    <div class="instrucciones-title">
                        <span>📋 Recomendaciones importantes</span>
                    </div>
                    <ul class="instrucciones-list">
                        <li>Llega 10 minutos antes de tu cita</li>
                        <li>En caso de servicio completo, traer cabello desenredado</li>
                        <li>Notifica cualquier cancelación con al menos 24 horas de anticipación</li>
                        <li>Consulta nuestras políticas en nuestro sitio web</li>
                        <li>En caso de corte de cabello, traer el cabello limpio y desenredado</li>
                    </ul>
                </div>
            
                <div style="margin-top: 30px; padding: 20px; background: #fff; border-radius: 12px; border: 1px solid #f198c0;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                        <span style="font-size: 16px; font-weight: 600; color: #f198c0;">📞 ¿Necesitas ayuda?</span>
                    </div>
                    <p style="color: #333; margin-bottom: 5px;">
                        <strong>{sede.get('nombre')}:</strong> {sede.get('telefono', 'No disponible')}
                    </p>
                    <p style="color: #666; font-size: 14px;">
                        Horario de atención: {dia_info['hora_inicio']} - {dia_info['hora_fin']}
                    </p>
                </div>
            </div>
        
            <div class="email-footer">
                <p>© {datetime.now().year} Rizos Felices. Todos los derechos reservados.</p>
                <div class="footer-links">
                    <a href="#">Políticas de privacidad</a>
                    <a href="#">Términos de servicio</a>
                </div>
                <p style="margin-top: 20px; font-size: 12px; opacity: 0.7;">
                    Este es un correo automático, por favor no responder.
                </p>
            </div>
        </div>
    </body>
    </html>
    """
    # === determinar si la cita quedó confirmada ===
    estado_guardado = data["estado"]  # "confirmada" o "pre_reservada"

    if estado_guardado == "confirmada":
        # === Formatear fecha y hora para asunto ===
        meses_es = [
            "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
        ]
        fecha_dt = datetime.strptime(fecha_str, "%Y-%m-%d")
        fecha_limpia = f"{fecha_dt.day} {meses_es[fecha_dt.month - 1]}"
        hora_dt = datetime.strptime(cita.hora_inicio, "%H:%M")
        hora_limpia = hora_dt.strftime("%I %p").lstrip("0").replace("AM", "Am").replace("PM", "Pm")
        asunto_limpio = f"Confirmamos tu cita. Para el {fecha_limpia} {hora_limpia}"

        # === Al cliente ===
        cliente_email = cliente.get("email") or cliente.get("correo")
        if cliente_email:
            try:
                enviar_correo(cliente_email, asunto_limpio, mensaje_html)
                print(f"📧 Confirmación enviada a cliente: {cliente_email}")
            except Exception as e:
                print(f"⚠️ Error enviando email al cliente: {e}")

        # === Al profesional ===
        try:
            prof_email = profesional.get("email")
            if prof_email:
                prof_subject = f"📅 Nueva cita asignada - {fecha_str} {cita.hora_inicio} - {cliente.get('nombre')}"
                enviar_correo(prof_email, prof_subject, mensaje_html)
                print(f"📧 Confirmación enviada a profesional: {prof_email}")
        except Exception as e:
            print(f"⚠️ Error enviando email al profesional: {e}")

        # === Al admin de sede ===
        try:
            admin_sede_email = sede.get("email_contacto")
            if admin_sede_email and admin_sede_email != current_user.get("email"):
                admin_subject = f"📋 Nueva cita registrada - {fecha_str} - {cliente.get('nombre')}"
                enviar_correo(admin_sede_email, admin_subject, mensaje_html)
        except Exception as e:
            print(f"⚠️ Error enviando email a admin sede: {e}")

    else:
        # pre_reservada — sin correo, el cliente recibirá uno cuando se confirme
        print(f"📭 Cita pre_reservada — correo pendiente hasta confirmación")

    # ═══════════════════════════════════════════════
    # ⭐ INTEGRACIÓN GIFTCARD - Reservar saldo
    # Si el método de pago inicial es giftcard, reservar saldo.
    # ⭐ Soporta pago parcial: si la giftcard no cubre el abono
    # completo, usa lo que tiene y el resto queda en saldo_pendiente.
    # ═══════════════════════════════════════════════
    codigo_giftcard = getattr(cita, 'codigo_giftcard', None)

    if cita.metodo_pago_inicial == "giftcard" and codigo_giftcard and abono > 0:
        try:
            from app.database.mongo import collection_giftcards
            from app.giftcards.routes_giftcards import _estado_giftcard

            codigo_upper = codigo_giftcard.upper().strip()
            gc_doc = await collection_giftcards.find_one({"codigo": codigo_upper})

            if not gc_doc:
                await collection_citas.delete_one({"_id": result.inserted_id})
                raise HTTPException(
                    status_code=404,
                    detail=f"Giftcard '{codigo_upper}' no encontrada"
                )

            estado_gc = _estado_giftcard(gc_doc)
            if estado_gc in ["cancelada", "vencida", "usada"]:
                await collection_citas.delete_one({"_id": result.inserted_id})
                raise HTTPException(
                    status_code=400,
                    detail=f"Giftcard no válida: estado '{estado_gc}'"
                )

            saldo_gc = round(float(gc_doc.get("saldo_disponible", 0)), 2)

            if saldo_gc <= 0:
                await collection_citas.delete_one({"_id": result.inserted_id})
                raise HTTPException(
                    status_code=400,
                    detail="La giftcard no tiene saldo disponible"
                )

            # ⭐ Pago parcial: usar lo que alcance, el resto queda en saldo_pendiente.
            # El cajero completará la diferencia con otro método después.
            abono_real_gc = round(min(abono, saldo_gc), 2)
            abono_restante = round(abono - abono_real_gc, 2)

            nuevo_disponible = round(saldo_gc - abono_real_gc, 2)
            nuevo_reservado = round(float(gc_doc.get("saldo_reservado", 0)) + abono_real_gc, 2)

            movimiento_gc = {
                "tipo": "reserva",
                "cita_id": cita_id,
                "concepto": "abono_inicial",
                "monto": abono_real_gc,
                "fecha": datetime.now(),
                "registrado_por": current_user.get("email"),
                "saldo_disponible_antes": saldo_gc,
                "saldo_disponible_despues": nuevo_disponible,
                **({"monto_restante_otro_metodo": abono_restante} if abono_restante > 0 else {})
            }

            await collection_giftcards.update_one(
                {"codigo": codigo_upper},
                {
                    "$set": {
                        "saldo_disponible": nuevo_disponible,
                        "saldo_reservado": nuevo_reservado,
                    },
                    "$push": {"historial": movimiento_gc}
                }
            )

            # Si la giftcard solo cubrió parcialmente el abono,
            # recalcular saldo_pendiente con el abono real
            if abono_real_gc < abono:
                saldo_pendiente = round(valor_total - abono_real_gc, 2)
                if saldo_pendiente <= 0:
                    estado_pago = "pagado"
                elif abono_real_gc > 0:
                    estado_pago = "abonado"

                # Actualizar el historial_pagos con el monto real
                historial_pagos[0]["monto"] = abono_real_gc
                historial_pagos[0]["saldo_despues"] = saldo_pendiente

                await collection_citas.update_one(
                    {"_id": result.inserted_id},
                    {"$set": {
                        "codigo_giftcard": codigo_upper,
                        "abono": abono_real_gc,
                        "saldo_pendiente": saldo_pendiente,
                        "estado_pago": estado_pago,
                        "historial_pagos": historial_pagos,
                    }}
                )
                print(f"🎁 Giftcard {codigo_upper}: cubrió {abono_real_gc}, "
                      f"restante {abono_restante} queda en saldo_pendiente")
            else:
                # La giftcard cubrió todo el abono, solo guardar el código
                await collection_citas.update_one(
                    {"_id": result.inserted_id},
                    {"$set": {"codigo_giftcard": codigo_upper}}
                )
                print(f"🎁 Giftcard {codigo_upper}: reservados {abono_real_gc} {gc_doc.get('moneda')}")

        except HTTPException:
            # Re-lanzar los errores que generamos arriba
            # (la cita ya fue eliminada dentro de cada if antes del raise)
            raise
        except Exception as e:
            await collection_citas.delete_one({"_id": result.inserted_id})
            raise HTTPException(
                status_code=500,
                detail=f"Error reservando giftcard: {str(e)}"
            )

    return {
        "success": True, 
        "message": "Cita creada exitosamente", 
        "cita_id": cita_id,
        "data": {
            "cita_id": cita_id,
            "cliente": cliente.get("nombre"),
            "servicios": nombres_servicios,
            "profesional": profesional.get("nombre"),
            "fecha": fecha_str,
            "horario": f"{cita.hora_inicio} - {cita.hora_fin}",
            "duracion_total": duracion_total,
            "valor_total": valor_total,
            "estado_pago": estado_pago,
            "saldo_pendiente": saldo_pendiente,
            "moneda": moneda_sede
        }
    }

# =============================================================
# 🔹 EDITAR CITA (MEJORADA)
# =============================================================
@router.put("/{cita_id}", response_model=dict)
async def editar_cita(
    cita_id: str,
    cambios: dict,
    current_user: dict = Depends(get_current_user)
):
    """
    Edita una cita.
    ✅ Soporta edición de servicios, productos y horario
    ✅ Recalcula totales automáticamente
    ✅ Valida disponibilidad y conflictos de agenda
    """
    if current_user.get("rol") not in ["admin_sede", "super_admin", "recepcionista", "call_center"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    cita_actual = await resolve_cita_by_id(cita_id)
    if not cita_actual:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    cita_object_id = cita_actual.get("_id")
    if not cita_object_id:
        raise HTTPException(status_code=500, detail="La cita no tiene _id válido")

    def _hora_a_minutos(hora_str: str) -> int:
        hora_obj = time.fromisoformat(hora_str)
        return (hora_obj.hour * 60) + hora_obj.minute

    def _minutos_a_hora(total_min: int) -> str:
        horas = total_min // 60
        minutos = total_min % 60
        return f"{str(horas).zfill(2)}:{str(minutos).zfill(2)}"

    def _sumar_minutos_hora(hora_str: str, minutos: int) -> str:
        inicio = _hora_a_minutos(hora_str)
        return _minutos_a_hora(inicio + max(0, minutos))

    def _normalizar_fecha(fecha_valor) -> str:
        if isinstance(fecha_valor, datetime):
            return fecha_valor.strftime("%Y-%m-%d")
        fecha_texto = str(fecha_valor)
        try:
            return datetime.strptime(fecha_texto[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
        except Exception:
            raise HTTPException(status_code=400, detail="Formato de fecha inválido. Use YYYY-MM-DD")

    def _total_productos_desde_lista(productos_lista: list) -> float:
        total = 0.0
        for p in productos_lista or []:
            cantidad = int(p.get("cantidad", 1) or 1)
            precio_unitario = float(p.get("precio_unitario", p.get("precio", 0)) or 0)
            subtotal = float(p.get("subtotal", precio_unitario * cantidad) or 0)
            total += subtotal
        return round(total, 2)
    
    # ====================================
    # ⭐ NOTAS (se permite editar en cualquier estado)
    # ====================================
    notas_a_guardar = None
    if "notas" in cambios:
        notas_valor = cambios.pop("notas")  # Sacar de cambios temporalmente
        if notas_valor is not None and not isinstance(notas_valor, str):
            raise HTTPException(status_code=400, detail="El campo 'notas' debe ser texto")
        notas_a_guardar = notas_valor.strip() if isinstance(notas_valor, str) else ""

    estado_actual = str(cita_actual.get("estado", "")).strip().lower()
    estados_no_editables = {"completada"}
    campos_edicion_cita = {"servicios", "productos", "fecha", "hora_inicio", "hora_fin", "profesional_id", "notas"}
    solicita_edicion = any(campo in cambios for campo in campos_edicion_cita)

    if solicita_edicion and estado_actual in estados_no_editables:
        raise HTTPException(
            status_code=400,
            detail=f"No se puede editar la cita cuando está en estado '{cita_actual.get('estado')}'"
        )

    sede = await collection_locales.find_one({"sede_id": cita_actual.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede de la cita no encontrada")

    moneda_sede = sede.get("moneda", "COP")

    # ====================================
    # ⭐ SERVICIOS
    # ====================================
    valor_servicios = round(
        float(cita_actual.get("valor_total", 0) or 0) - _total_productos_desde_lista(cita_actual.get("productos", [])),
        2
    )
    valor_servicios = max(0, valor_servicios)
    duracion_total = int(cita_actual.get("servicio_duracion", 0) or 0)
    if duracion_total <= 0:
        try:
            duracion_total = max(
                0,
                _hora_a_minutos(str(cita_actual.get("hora_fin", "00:00"))) -
                _hora_a_minutos(str(cita_actual.get("hora_inicio", "00:00")))
            )
        except Exception:
            duracion_total = 0

    if "servicios" in cambios:
        if not isinstance(cambios["servicios"], list) or len(cambios["servicios"]) == 0:
            raise HTTPException(status_code=400, detail="Debe enviar al menos un servicio")

        servicios_procesados = []
        servicios_ids_vistos = set()
        valor_servicios = 0.0
        duracion_total = 0
        nombres_servicios = []

        for servicio_item in cambios["servicios"]:
            if not isinstance(servicio_item, dict):
                raise HTTPException(status_code=400, detail="Formato inválido en servicios")

            servicio_id = servicio_item.get("servicio_id")
            if not servicio_id:
                raise HTTPException(status_code=400, detail="Cada servicio debe incluir servicio_id")

            if servicio_id in servicios_ids_vistos:
                raise HTTPException(status_code=400, detail=f"Servicio duplicado en la cita: {servicio_id}")
            servicios_ids_vistos.add(servicio_id)

            cantidad_raw = servicio_item.get("cantidad", 1)
            try:
                cantidad = int(cantidad_raw)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Cantidad inválida para servicio {servicio_id}")

            if cantidad < 1:
                raise HTTPException(status_code=400, detail="La cantidad debe ser mayor o igual a 1")

            servicio_db = await collection_servicios.find_one({"servicio_id": servicio_id})
            if not servicio_db:
                raise HTTPException(status_code=404, detail=f"Servicio {servicio_id} no encontrado")

            precios = servicio_db.get("precios", {})
            if moneda_sede not in precios:
                raise HTTPException(status_code=400, detail=f"Servicio sin precio en {moneda_sede}")
            precio_base_sede = float(precios[moneda_sede])

            precio_manual = servicio_item.get("precio")
            precio_personalizado = servicio_item.get("precio_personalizado")
            precio = None

            if precio_manual is not None:
                try:
                    precio_manual_float = float(precio_manual)
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"Precio inválido para servicio {servicio_id}")
                if precio_manual_float > 0:
                    precio = precio_manual_float

            if precio is None and precio_personalizado is not None:
                try:
                    precio_personalizado_float = float(precio_personalizado)
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"Precio personalizado inválido para servicio {servicio_id}")
                if precio_personalizado_float > 0:
                    precio = precio_personalizado_float

            if precio is None:
                precio = precio_base_sede

            es_personalizado = round(precio, 2) != round(precio_base_sede, 2)

            subtotal = round(precio * cantidad, 2)
            duracion_servicio = int(servicio_db.get("duracion_minutos", 0) or 0)
            nombre_servicio = servicio_db.get("nombre", "Servicio")

            valor_servicios += subtotal
            duracion_total += duracion_servicio * cantidad
            nombres_servicios.append(f"{nombre_servicio} x{cantidad}" if cantidad > 1 else nombre_servicio)

            servicios_procesados.append({
                "servicio_id": servicio_id,
                "nombre": nombre_servicio,
                "precio_personalizado": es_personalizado,
                "precio": round(precio, 2),
                "cantidad": cantidad,
                "subtotal": subtotal
            })

        cambios["servicios"] = servicios_procesados
        cambios["servicio_nombre"] = ", ".join(nombres_servicios) if nombres_servicios else "Sin servicio"
        cambios["servicio_duracion"] = duracion_total
        valor_servicios = round(valor_servicios, 2)

    # ====================================
    # ⭐ PRODUCTOS
    # ====================================
    productos_finales = cita_actual.get("productos", [])
    total_productos = _total_productos_desde_lista(productos_finales)

    if "productos" in cambios:
        if not isinstance(cambios["productos"], list):
            raise HTTPException(status_code=400, detail="Formato inválido en productos")

        productos_procesados = []
        productos_ids_vistos = set()
        total_productos = 0.0
        profesional_para_producto = cambios.get("profesional_id", cita_actual.get("profesional_id"))

        for producto_item in cambios["productos"]:
            if not isinstance(producto_item, dict):
                raise HTTPException(status_code=400, detail="Formato inválido en productos")

            producto_id = str(producto_item.get("producto_id", "")).strip()
            if not producto_id:
                raise HTTPException(status_code=400, detail="Cada producto debe incluir producto_id")

            if producto_id in productos_ids_vistos:
                raise HTTPException(status_code=400, detail=f"Producto duplicado en la cita: {producto_id}")
            productos_ids_vistos.add(producto_id)

            cantidad_raw = producto_item.get("cantidad", 1)
            try:
                cantidad = int(cantidad_raw)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Cantidad inválida para producto {producto_id}")

            if cantidad < 1:
                raise HTTPException(status_code=400, detail="La cantidad de producto debe ser mayor o igual a 1")

            producto_db = await collection_products.find_one({"id": producto_id})
            if not producto_db:
                try:
                    producto_db = await collection_products.find_one({"_id": ObjectId(producto_id)})
                except Exception:
                    producto_db = None
            if not producto_db:
                raise HTTPException(status_code=404, detail=f"Producto {producto_id} no encontrado")

            precio_manual = producto_item.get("precio", producto_item.get("precio_unitario"))
            precio_unitario = None

            if precio_manual is not None:
                try:
                    precio_manual_float = float(precio_manual)
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"Precio inválido para producto {producto_id}")
                if precio_manual_float > 0:
                    precio_unitario = precio_manual_float

            if precio_unitario is None:
                precios_producto = producto_db.get("precios", {})
                if moneda_sede not in precios_producto:
                    raise HTTPException(
                        status_code=400,
                        detail=f"El producto '{producto_db.get('nombre', producto_id)}' no tiene precio en {moneda_sede}"
                    )
                precio_unitario = float(precios_producto[moneda_sede])

            subtotal = round(precio_unitario * cantidad, 2)
            comision_porcentaje = float(producto_db.get("comision", 0) or 0)
            comision_valor = round((subtotal * comision_porcentaje) / 100, 2)

            productos_procesados.append({
                "producto_id": producto_id,
                "nombre": producto_db.get("nombre", "Producto"),
                "cantidad": cantidad,
                "precio_unitario": round(precio_unitario, 2),
                "subtotal": subtotal,
                "moneda": moneda_sede,
                "comision_porcentaje": comision_porcentaje,
                "comision_valor": comision_valor,
                "agregado_por_email": current_user.get("email"),
                "agregado_por_rol": current_user.get("rol"),
                "fecha_agregado": today_str(sede),
                "profesional_id": profesional_para_producto
            })

            total_productos += subtotal

        total_productos = round(total_productos, 2)
        productos_finales = productos_procesados
        cambios["productos"] = productos_procesados

    # ====================================
    # ⭐ FECHA/HORA/PROFESIONAL
    # ====================================
    fecha_final = _normalizar_fecha(cambios.get("fecha", cita_actual.get("fecha")))
    hora_inicio_final = str(cambios.get("hora_inicio", cita_actual.get("hora_inicio")))
    profesional_id_final = str(cambios.get("profesional_id", cita_actual.get("profesional_id")))
    hora_fin_final = str(cambios.get("hora_fin", cita_actual.get("hora_fin")))

    if ("servicios" in cambios or "hora_inicio" in cambios) and "hora_fin" not in cambios:
        hora_fin_final = _sumar_minutos_hora(hora_inicio_final, duracion_total)
        cambios["hora_fin"] = hora_fin_final

    if "fecha" in cambios:
        cambios["fecha"] = fecha_final
    if "hora_inicio" in cambios:
        cambios["hora_inicio"] = hora_inicio_final
    if "profesional_id" in cambios:
        cambios["profesional_id"] = profesional_id_final

    if "profesional_id" in cambios:
        profesional_db = await collection_estilista.find_one({"profesional_id": profesional_id_final})
        if not profesional_db:
            raise HTTPException(status_code=404, detail="Profesional no encontrado")
        cambios["profesional_nombre"] = profesional_db.get("nombre")

    # Validar disponibilidad y conflictos si cambia agenda
    if any(campo in cambios for campo in {"fecha", "hora_inicio", "hora_fin", "profesional_id", "servicios"}):
        try:
            fecha_dt = datetime.strptime(fecha_final, "%Y-%m-%d")
            hora_inicio_obj = time.fromisoformat(hora_inicio_final)
            hora_fin_obj = time.fromisoformat(hora_fin_final)
        except Exception:
            raise HTTPException(status_code=400, detail="Fecha u hora inválida")

        if not hora_inicio_obj < hora_fin_obj:
            raise HTTPException(status_code=400, detail="La hora de fin debe ser mayor a la hora de inicio")

        dia_semana = fecha_dt.isoweekday()
        horario = await collection_horarios.find_one({"profesional_id": profesional_id_final})
        if not horario:
            raise HTTPException(status_code=400, detail="El profesional no tiene horario configurado")

        dia_info = next(
            (
                d for d in horario.get("disponibilidad", [])
                if int(d.get("dia_semana", 0)) == dia_semana and d.get("activo", True) is True
            ),
            None
        )
        if not dia_info:
            raise HTTPException(status_code=400, detail="El profesional no tiene disponibilidad para esa fecha")

        hora_inicio_horario = time.fromisoformat(dia_info.get("hora_inicio"))
        hora_fin_horario = time.fromisoformat(dia_info.get("hora_fin"))

        if not (
            hora_inicio_horario <= hora_inicio_obj < hora_fin_horario and
            hora_inicio_horario < hora_fin_obj <= hora_fin_horario
        ):
            raise HTTPException(status_code=400, detail="La cita está fuera del horario laboral del profesional")

        """bloqueo = await collection_block.find_one({
            "profesional_id": profesional_id_final,
            "fecha": fecha_final,
            "hora_inicio": {"$lt": hora_fin_final},
            "hora_fin": {"$gt": hora_inicio_final}
        })
        if bloqueo:
            raise HTTPException(
                status_code=400,
                detail=f"El profesional tiene un bloqueo en ese horario (Motivo: {bloqueo.get('motivo', 'No especificado')})"
            )

        solape = await collection_citas.find_one({
            "_id": {"$ne": cita_object_id},
            "profesional_id": profesional_id_final,
            "fecha": fecha_final,
            "hora_inicio": {"$lt": hora_fin_final},
            "hora_fin": {"$gt": hora_inicio_final},
            "estado": {"$nin": ["cancelada", "no asistio", "no_asistio"]}
        })
        if solape:
            cliente_solape = solape.get("cliente_nombre", "otro cliente")
            raise HTTPException(
                status_code=400,
                detail=f"El profesional ya tiene una cita con {cliente_solape} en ese horario"
            )"""

    # ====================================
    # ⭐ RECÁLCULO DE TOTALES
    # ====================================
    nuevo_valor_total = round(valor_servicios + total_productos, 2)
    cambios["valor_total"] = nuevo_valor_total

    abono_actual = float(cambios.get("abono", cita_actual.get("abono", 0)) or 0)
    nuevo_saldo = round(nuevo_valor_total - abono_actual, 2)
    cambios["saldo_pendiente"] = nuevo_saldo

    if nuevo_saldo <= 0:
        cambios["estado_pago"] = "pagado"
    elif abono_actual > 0:
        cambios["estado_pago"] = "abonado"
    else:
        cambios["estado_pago"] = "pendiente"

    if notas_a_guardar is not None:
        cambios["notas"] = notas_a_guardar

    # ====================================
    # ⭐ Actualizar timestamp
    # ====================================
    cambios["ultima_actualizacion"] = today_str(sede)

    # ====================================
    # Ejecutar actualización
    # ====================================
    result = await collection_citas.update_one(
        {"_id": cita_object_id},
        {"$set": cambios}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    # Obtener cita actualizada
    cita_actualizada = await collection_citas.find_one({"_id": cita_object_id})
    normalize_cita_doc(cita_actualizada)
    
    return {"success": True, "cita": cita_actualizada}

# =============================================================
# 🔹 CANCELAR CITA
# =============================================================
@router.post("/{cita_id}/cancelar", response_model=dict)
async def cancelar_cita(cita_id: str, current_user: dict = Depends(get_current_user)):
    cita = await resolve_cita_by_id(cita_id)
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    sede = await collection_locales.find_one({"sede_id": cita.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    if current_user.get("rol") == "usuario":
        if cita.get("cliente_id") != current_user.get("user_id") and cita.get("cliente_id") != current_user.get("cliente_id"):
            raise HTTPException(status_code=403, detail="Solo puedes cancelar tus propias citas")

    await collection_citas.update_one({"_id": ObjectId(cita["_id"])}, {"$set": {
        "estado": "cancelada",
        "fecha_cancelacion": today_str(sede),
        "cancelada_por": current_user.get("email")
    }})

    # ═══════════════════════════════════════════════
    # ⭐ INTEGRACIÓN GIFTCARD - Liberar saldo reservado
    # ═══════════════════════════════════════════════
    codigo_giftcard = cita.get("codigo_giftcard")
    if codigo_giftcard:
        try:
            from app.database.mongo import collection_giftcards
            
            gc_doc = await collection_giftcards.find_one({"codigo": codigo_giftcard})
            if gc_doc:
                historial = gc_doc.get("historial", [])
                reserva = next(
                    (m for m in historial
                     if m.get("cita_id") == str(cita["_id"]) and m.get("tipo") == "reserva"),
                    None
                )
                if reserva:
                    monto_liberar = round(float(reserva.get("monto", 0)), 2)
                    nuevo_disponible = round(float(gc_doc.get("saldo_disponible", 0)) + monto_liberar, 2)
                    nuevo_reservado = max(0.0, round(float(gc_doc.get("saldo_reservado", 0)) - monto_liberar, 2))
                    
                    movimiento_liberacion = {
                        "tipo": "liberacion",
                        "cita_id": str(cita["_id"]),
                        "monto": monto_liberar,
                        "fecha": datetime.now(),
                        "registrado_por": current_user.get("email"),
                        "motivo": "cita_cancelada"
                    }
                    
                    await collection_giftcards.update_one(
                        {"codigo": codigo_giftcard},
                        {
                            "$set": {
                                "saldo_disponible": nuevo_disponible,
                                "saldo_reservado": nuevo_reservado,
                            },
                            "$push": {"historial": movimiento_liberacion}
                        }
                    )
                    print(f"🎁 Giftcard {codigo_giftcard}: liberados {monto_liberar}")
        except Exception as e:
            print(f"⚠️ Error liberando giftcard al cancelar: {e}")

    return {"success": True, "mensaje": "Cita cancelada", "cita_id": cita_id}

# =============================================================
# 🔹 CONFIRMAR CITA
# =============================================================
@router.post("/{cita_id}/confirmar", response_model=dict)
async def confirmar_cita(
    cita_id: str,
    current_user: dict = Depends(get_current_user)
):
    cita = await resolve_cita_by_id(cita_id)
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    estado_actual = cita.get("estado", "")

    # Ya estaba confirmada o en estado terminal
    if estado_actual == "confirmada":
        return {"success": True, "mensaje": "La cita ya estaba confirmada", "cita_id": cita_id}

    if estado_actual in {"cancelada", "completada", "no_asistio"}:
        raise HTTPException(
            status_code=400,
            detail=f"No se puede confirmar una cita en estado '{estado_actual}'"
        )

    sede = await collection_locales.find_one({"sede_id": cita.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    await collection_citas.update_one(
        {"_id": ObjectId(cita["_id"])},
        {"$set": {
            "estado": "confirmada",
            "confirmada_por": current_user.get("email"),
            "fecha_confirmacion": today_str(sede),
            "requiere_confirmacion": False
        }}
    )

    return {"success": True, "mensaje": "Cita confirmada", "cita_id": cita_id}

# =============================================================
# 🔹 REENVIAR CORREO DE CITA
# =============================================================

TIPOS_CORREO_VALIDOS = {"confirmacion", "reprogramacion", "cancelacion"}

@router.post("/{cita_id}/reenviar-correo", response_model=dict)
async def reenviar_correo_cita(
    cita_id: str,
    tipo: str = Query(
        default="confirmacion",
        description="Tipo de correo: confirmacion | reprogramacion | cancelacion"
    ),
    current_user: dict = Depends(get_current_user)
):
    """
    Reenvía correo de una cita al cliente (y opcionalmente al profesional).
    ✅ confirmacion  → usado tras crear o confirmar manualmente
    ✅ reprogramacion → usado tras editar fecha/hora
    ✅ cancelacion   → notifica que la cita fue cancelada
    """
    if current_user.get("rol") not in ["admin_sede", "super_admin", "call_center", "recepcionista"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    if tipo not in TIPOS_CORREO_VALIDOS:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo inválido. Usa: {', '.join(TIPOS_CORREO_VALIDOS)}"
        )

    cita = await resolve_cita_by_id(cita_id)
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    # Validar coherencia tipo ↔ estado
    estado_cita = cita.get("estado", "")
    if tipo == "cancelacion" and estado_cita not in {"cancelada"}:
        raise HTTPException(
            status_code=400,
            detail="Solo puedes enviar correo de cancelación si la cita está cancelada"
        )
    if tipo in {"confirmacion", "reprogramacion"} and estado_cita in {"cancelada"}:
        raise HTTPException(
            status_code=400,
            detail="No puedes enviar confirmación o reprogramación de una cita cancelada"
        )

    # Cargar datos relacionados
    sede = await collection_locales.find_one({"sede_id": cita.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    cliente_email = cita.get("cliente_email")
    cliente_nombre = cita.get("cliente_nombre", "Cliente")
    profesional_nombre = cita.get("profesional_nombre", "")
    profesional_id = cita.get("profesional_id")
    fecha_str = cita.get("fecha", "")
    hora_inicio = cita.get("hora_inicio", "")
    hora_fin = cita.get("hora_fin", "")
    sede_nombre = cita.get("sede_nombre") or sede.get("nombre", "")
    sede_direccion = sede.get("direccion", "")
    sede_telefono = sede.get("telefono", "No disponible")

    # Nombres de servicios
    servicios = cita.get("servicios", [])
    nombres_servicios = ", ".join(
        s.get("nombre", "Servicio") for s in servicios
    ) if servicios else cita.get("servicio_nombre", "Sin servicio")

    # Formatear fecha y hora para asunto
    meses_es = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ]
    try:
        fecha_dt = datetime.strptime(fecha_str, "%Y-%m-%d")
        fecha_limpia = f"{fecha_dt.day} {meses_es[fecha_dt.month - 1]}"
    except Exception:
        fecha_limpia = fecha_str

    try:
        hora_dt = datetime.strptime(hora_inicio, "%H:%M")
        hora_limpia = hora_dt.strftime("%I %p").lstrip("0").replace("AM", "Am").replace("PM", "Pm")
    except Exception:
        hora_limpia = hora_inicio

    # ─── Construir asunto y encabezado según tipo ───────────────────────
    configs = {
        "confirmacion": {
            "asunto": f"Confirmamos tu cita. Para el {fecha_limpia} {hora_limpia}",
            "titulo": "¡Cita Confirmada!",
            "subtitulo": "Tu reserva ha sido agendada exitosamente",
            "color_banner": "#000000",
            "instrucciones": True,
        },
        "reprogramacion": {
            "asunto": f"Tu cita fue reprogramada. Nueva fecha: {fecha_limpia} {hora_limpia}",
            "titulo": "Cita Reprogramada",
            "subtitulo": "Los detalles de tu cita han sido actualizados",
            "color_banner": "#1a1a2e",
            "instrucciones": True,
        },
        "cancelacion": {
            "asunto": f"Tu cita del {fecha_limpia} {hora_limpia} ha sido cancelada",
            "titulo": "Cita Cancelada",
            "subtitulo": "Lamentamos los inconvenientes",
            "color_banner": "#2d1b1b",
            "instrucciones": False,
        },
    }

    cfg = configs[tipo]

    # ─── Bloque de instrucciones (solo si aplica) ───────────────────────
    bloque_instrucciones = ""
    if cfg["instrucciones"]:
        bloque_instrucciones = """
        <div style="background-color:#fff0f6;padding:20px;border-radius:12px;border-left:5px solid #f198c0;margin-top:20px;">
            <div style="color:#f198c0;font-weight:bold;margin-bottom:10px;">📋 Recomendaciones importantes</div>
            <ul style="margin:0;padding-left:20px;color:#555;font-size:14px;">
                <li style="margin-bottom:8px;">Llega 10 minutos antes de tu cita</li>
                <li style="margin-bottom:8px;">En caso de servicio completo, traer cabello desenredado</li>
                <li style="margin-bottom:8px;">Notifica cualquier cancelación con al menos 24 horas de anticipación</li>
                <li style="margin-bottom:8px;">En caso de corte de cabello, traer el cabello limpio y desenredado</li>
            </ul>
        </div>
        """

    # ─── Bloque extra para cancelación ─────────────────────────────────
    bloque_cancelacion = ""
    if tipo == "cancelacion":
        bloque_cancelacion = f"""
        <div style="background-color:#fff5f5;padding:20px;border-radius:12px;border-left:5px solid #e53e3e;margin-top:20px;">
            <div style="color:#e53e3e;font-weight:bold;margin-bottom:8px;">¿Necesitas reagendar?</div>
            <p style="color:#555;font-size:14px;margin:0;">
                Puedes contactarnos al <strong>{sede_telefono}</strong> para agendar una nueva cita.
                Estaremos encantados de atenderte.
            </p>
        </div>
        """

    # ─── HTML del correo ────────────────────────────────────────────────
    mensaje_html = f"""
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#f4f4f4;margin:0;padding:0;">
        <div style="max-width:600px;margin:20px auto;background-color:#ffffff;border-radius:15px;overflow:hidden;box-shadow:0 4px 10px rgba(0,0,0,0.1);border:1px solid #f198c0;">

            <div style="background-color:#000000;color:#ffffff;padding:40px 20px;text-align:center;">
                <img src="https://rizosfelicesdata.s3.us-east-2.amazonaws.com/logo+principal+rosado+letra+blanco_Mesa+de+tra+(1).png"
                     alt="Rizos Felices" style="max-width:180px;margin-bottom:20px;">
                <h1 style="color:#f198c0;margin:0;font-size:28px;text-transform:uppercase;letter-spacing:2px;">
                    {cfg['titulo']}
                </h1>
                <p style="margin:10px 0 0;font-size:16px;opacity:0.9;">{cfg['subtitulo']}</p>
            </div>

            <div style="padding:30px;">
                <div style="color:#333;font-size:18px;font-weight:bold;margin-bottom:20px;
                            padding-bottom:10px;border-bottom:2px solid #f198c0;">
                    📅 Detalles de la cita
                </div>

                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:15px;margin-bottom:20px;">
                    <div style="background:#fff;padding:15px;border-radius:10px;border:1px solid #f198c0;">
                        <div style="color:#f198c0;font-size:12px;text-transform:uppercase;font-weight:bold;margin-bottom:5px;">Cliente</div>
                        <div style="color:#333;font-size:15px;font-weight:600;">{cliente_nombre}</div>
                    </div>
                    <div style="background:#fff;padding:15px;border-radius:10px;border:1px solid #f198c0;">
                        <div style="color:#f198c0;font-size:12px;text-transform:uppercase;font-weight:bold;margin-bottom:5px;">Servicio(s)</div>
                        <div style="color:#333;font-size:15px;font-weight:600;">{nombres_servicios}</div>
                    </div>
                    <div style="background:#fff;padding:15px;border-radius:10px;border:1px solid #f198c0;">
                        <div style="color:#f198c0;font-size:12px;text-transform:uppercase;font-weight:bold;margin-bottom:5px;">Profesional</div>
                        <div style="color:#333;font-size:15px;font-weight:600;">{profesional_nombre}</div>
                    </div>
                    <div style="background:#fff;padding:15px;border-radius:10px;border:1px solid #f198c0;">
                        <div style="color:#f198c0;font-size:12px;text-transform:uppercase;font-weight:bold;margin-bottom:5px;">Sede</div>
                        <div style="color:#333;font-size:15px;font-weight:600;">{sede_nombre}</div>
                        <small style="color:#888;">{sede_direccion}</small>
                    </div>
                    <div style="background:#fff;padding:15px;border-radius:10px;border:1px solid #f198c0;">
                        <div style="color:#f198c0;font-size:12px;text-transform:uppercase;font-weight:bold;margin-bottom:5px;">Fecha</div>
                        <div style="color:#333;font-size:15px;font-weight:600;">{fecha_str}</div>
                    </div>
                    <div style="background:#fff;padding:15px;border-radius:10px;border:1px solid #f198c0;">
                        <div style="color:#f198c0;font-size:12px;text-transform:uppercase;font-weight:bold;margin-bottom:5px;">Horario</div>
                        <div style="color:#333;font-size:15px;font-weight:600;">{hora_inicio} - {hora_fin}</div>
                    </div>
                </div>

                {bloque_instrucciones}
                {bloque_cancelacion}

                <div style="margin-top:20px;padding:20px;background:#fff;border-radius:12px;border:1px solid #f198c0;">
                    <div style="font-size:16px;font-weight:600;color:#f198c0;margin-bottom:8px;">📞 ¿Necesitas ayuda?</div>
                    <p style="color:#333;margin-bottom:5px;"><strong>{sede_nombre}:</strong> {sede_telefono}</p>
                </div>
            </div>

            <div style="background-color:#f9f9f9;padding:30px;text-align:center;color:#777;font-size:13px;">
                <p>© {datetime.now().year} Rizos Felices. Todos los derechos reservados.</p>
                <p style="margin-top:10px;font-size:12px;opacity:0.7;">Este es un correo automático, por favor no responder.</p>
            </div>
        </div>
    </body>
    </html>
    """

    # ─── Enviar correos ─────────────────────────────────────────────────
    enviados = []
    errores = []

    # Al cliente
    if cliente_email:
        try:
            enviar_correo(cliente_email, cfg["asunto"], mensaje_html)
            enviados.append(cliente_email)
        except Exception as e:
            errores.append({"destinatario": cliente_email, "error": str(e)})
    else:
        errores.append({"destinatario": "cliente", "error": "Sin email registrado"})

    # Al profesional (solo en confirmacion y reprogramacion)
    if tipo in {"confirmacion", "reprogramacion"} and profesional_id:
        try:
            profesional = await collection_estilista.find_one({"profesional_id": profesional_id})
            prof_email = profesional.get("email") if profesional else None
            if prof_email:
                asunto_prof = f"{'Nueva cita' if tipo == 'confirmacion' else 'Cita reprogramada'} - {fecha_str} {hora_inicio} - {cliente_nombre}"
                enviar_correo(prof_email, asunto_prof, mensaje_html)
                enviados.append(prof_email)
        except Exception as e:
            errores.append({"destinatario": "profesional", "error": str(e)})

    if not enviados:
        raise HTTPException(
            status_code=500,
            detail={"mensaje": "No se pudo enviar ningún correo", "errores": errores}
        )

    return {
        "success": True,
        "tipo": tipo,
        "cita_id": cita_id,
        "enviados": enviados,
        **({"advertencias": errores} if errores else {})
    }

SIMBOLOS_MONEDA = {
    "COP": "$",
    "USD": "USD ",
    "MXN": "MXN ",
}

def fmt(valor: float, moneda: str = "") -> str:
    """3800.0 → '3800', 38600.5 → '38600.5', con símbolo si se pasa moneda."""
    n = int(valor) if valor == int(valor) else valor
    simbolo = SIMBOLOS_MONEDA.get(moneda, "")
    return f"{simbolo}{n}"

def num(valor: float) -> int | float:
    """Devuelve int si es entero, float si tiene decimales reales."""
    return int(valor) if valor == int(valor) else valor

# =============================================================
# 🔹 ACTUALIZAR PAGO DE LA CITA
# =============================================================
@router.post("/citas/{cita_id}/pago")
async def registrar_pago(
    cita_id: str,
    data: PagoRequest,
    current_user: dict = Depends(get_current_user)
):
    cita = await collection_citas.find_one({"_id": ObjectId(cita_id)})
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    sede = await collection_locales.find_one({"sede_id": cita.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    if cita.get("estado_factura") == "facturado":
        raise HTTPException(status_code=400, detail="La cita ya fue facturada")

    moneda = cita.get("moneda", "COP")

    # Fuente de verdad: saldo_pendiente
    saldo_pendiente_actual = round(float(cita.get("saldo_pendiente", 0)), 2)

    if saldo_pendiente_actual <= 0:
        raise HTTPException(status_code=400, detail="La cita no tiene saldo pendiente")

    monto_solicitado = round(float(data.monto), 2)
    if monto_solicitado <= 0:
        raise HTTPException(status_code=400, detail="Monto inválido")

    if monto_solicitado > saldo_pendiente_actual:
        raise HTTPException(
            status_code=400,
            detail=f"El monto ({fmt(monto_solicitado, moneda)}) excede el saldo pendiente ({fmt(saldo_pendiente_actual, moneda)})"
        )

    # ═══════════════════════════════════════════════════════════════
    # ⭐ INTEGRACIÓN GIFTCARD — va PRIMERO para saber el monto real
    # ═══════════════════════════════════════════════════════════════
    monto_real = monto_solicitado
    codigo_giftcard_usado = None

    if data.metodo_pago == "giftcard":
        if not data.codigo_giftcard:
            raise HTTPException(
                status_code=400,
                detail="Debe enviar codigo_giftcard cuando el método de pago es 'giftcard'"
            )

        from app.database.mongo import collection_giftcards
        from app.giftcards.routes_giftcards import _estado_giftcard

        codigo_gc = data.codigo_giftcard.upper().strip()
        gc_doc = await collection_giftcards.find_one({"codigo": codigo_gc})

        if not gc_doc:
            raise HTTPException(status_code=404, detail=f"Giftcard '{codigo_gc}' no encontrada")

        estado_gc = _estado_giftcard(gc_doc)
        if estado_gc in ["cancelada", "vencida", "usada"]:
            raise HTTPException(status_code=400, detail=f"Giftcard no válida: estado '{estado_gc}'")

        saldo_gc = round(float(gc_doc.get("saldo_disponible", 0)), 2)
        if saldo_gc <= 0:
            raise HTTPException(status_code=400, detail="La giftcard no tiene saldo disponible")

        monto_real = round(min(monto_solicitado, saldo_gc), 2)

        nuevo_disponible_gc = round(saldo_gc - monto_real, 2)
        nuevo_reservado_gc = round(float(gc_doc.get("saldo_reservado", 0)) + monto_real, 2)

        movimiento_gc = {
            "tipo": "reserva",
            "cita_id": cita_id,
            "concepto": "pago_adicional",
            "monto": num(monto_real),
            "fecha": datetime.now(),
            "registrado_por": current_user.get("email"),
            "saldo_disponible_antes": num(saldo_gc),
            "saldo_disponible_despues": num(nuevo_disponible_gc),
        }

        await collection_giftcards.update_one(
            {"codigo": codigo_gc},
            {
                "$set": {
                    "saldo_disponible": num(nuevo_disponible_gc),
                    "saldo_reservado": num(nuevo_reservado_gc),
                },
                "$push": {"historial": movimiento_gc}
            }
        )

        codigo_giftcard_usado = codigo_gc
        print(f"🎁 Giftcard {codigo_gc}: reservados {fmt(monto_real, moneda)}")
    # ══ fin giftcard ══

    nuevo_saldo_pendiente = round(saldo_pendiente_actual - monto_real, 2)
    nuevo_abono = round(float(cita.get("abono", 0) or 0) + monto_real, 2)
    estado_pago = "pagado" if nuevo_saldo_pendiente <= 0 else "abonado"
    abono_previo = round(float(cita.get("abono", 0) or 0), 2)
    if abono_previo == 0:
        tipo_pago = "pago_completo" if nuevo_saldo_pendiente <= 0 else "abono_inicial"
    else:
        tipo_pago = "pago_adicional"

    nuevo_pago = {
        "fecha": today(sede).replace(tzinfo=None),
        "monto": num(monto_real),
        "metodo": data.metodo_pago,
        "tipo": tipo_pago,
        "registrado_por": current_user.get("email"),
        "saldo_despues": num(nuevo_saldo_pendiente),
        "notas": data.notas,
        **({"codigo_giftcard": codigo_giftcard_usado} if codigo_giftcard_usado else {})
    }

    update_set = {
        "abono": num(nuevo_abono),
        "saldo_pendiente": num(nuevo_saldo_pendiente),
        "estado_pago": estado_pago,
        "metodo_pago_actual": data.metodo_pago,
        "ultima_actualizacion": today(sede).replace(tzinfo=None)
    }
    if codigo_giftcard_usado and not cita.get("codigo_giftcard"):
        update_set["codigo_giftcard"] = codigo_giftcard_usado

    if cita.get("estado") == "pre_reservada" and monto_real > 0:
        update_set["estado"] = "confirmada"
        update_set["confirmada_por"] = current_user.get("email")
        update_set["fecha_confirmacion"] = today(sede).replace(tzinfo=None)
        update_set["requiere_confirmacion"] = False

    await collection_citas.update_one(
        {"_id": ObjectId(cita_id)},
        {"$set": update_set, "$push": {"historial_pagos": nuevo_pago}}
    )

    if cita.get("estado") == "pre_reservada" and monto_real > 0:
        try:
            cliente_email_dest = cita.get("cliente_email")
            if cliente_email_dest:
                meses_es = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                            "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]
                fecha_str_c = cita.get("fecha", "")
                hora_inicio_c = cita.get("hora_inicio", "")
                fecha_dt_c = datetime.strptime(fecha_str_c, "%Y-%m-%d")
                hora_dt_c = datetime.strptime(hora_inicio_c, "%H:%M")
                fecha_limpia_c = f"{fecha_dt_c.day} {meses_es[fecha_dt_c.month - 1]}"
                hora_limpia_c = hora_dt_c.strftime("%I %p").lstrip("0").replace("AM","Am").replace("PM","Pm")
                asunto_confirmacion = f"Confirmamos tu cita. Para el {fecha_limpia_c} {hora_limpia_c}"

                # Reutilizar el helper de reenvío que ya tienes
                from app.scheduling.utils import construir_html_confirmacion
                html_conf = construir_html_confirmacion(cita, sede)
                enviar_correo(cliente_email_dest, asunto_confirmacion, html_conf)
                print(f"📧 Correo de confirmación enviado tras primer pago: {cliente_email_dest}")
        except Exception as e:
            print(f"⚠️ Error enviando correo de confirmación post-pago: {e}")

    respuesta = {
        "success": True,
        "abono": num(nuevo_abono),
        "saldo_pendiente": num(nuevo_saldo_pendiente),
        "estado_pago": estado_pago,
        "metodo_pago_usado": data.metodo_pago,
        "moneda": moneda,
        "giftcard_reservada": bool(codigo_giftcard_usado),
        "mensaje": f"Pago de {fmt(monto_real, moneda)} registrado vía {data.metodo_pago}"
    }

    if codigo_giftcard_usado and monto_real < monto_solicitado:
        faltante = round(monto_solicitado - monto_real, 2)
        respuesta["giftcard_info"] = {
            "monto_cubierto": num(monto_real),
            "monto_pendiente": num(faltante),
            "aviso": f"La giftcard cubrió {fmt(monto_real, moneda)}. Quedan {fmt(faltante, moneda)} en saldo pendiente."
        }

    return respuesta

# =============================================================
# 🔹 MOSTRAR PAGO ACTUALIZADO
# =============================================================
@router.get("/citas/{cita_id}/pago")
async def obtener_estado_pago(cita_id: str):
    cita = await collection_citas.find_one(
        {"_id": ObjectId(cita_id)},
        {
            "abono": 1,
            "valor_total": 1,
            "saldo_pendiente": 1,
            "estado_pago": 1,
            "moneda": 1,
            "metodo_pago": 1 
        }
    )

    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    return {
        "abono": cita.get("abono", 0),
        "valor_total": cita["valor_total"],
        "saldo_pendiente": cita["saldo_pendiente"],
        "estado_pago": cita["estado_pago"],
        "moneda": cita.get("moneda", "USD"),
        "metodo_pago": cita.get("metodo_pago") 
    }

# =============================================================
# 🔹 MARCAR COMPLETADA (solo cuando se factura - ver routes_quotes)
# =============================================================
@router.post("/{cita_id}/completar", response_model=dict)
async def completar_cita(cita_id: str, current_user: dict = Depends(get_current_user)):
    """
    ⚠️ DEPRECADO: Usar el endpoint de facturación en routes_quotes.py
    Este endpoint se mantiene por compatibilidad pero no genera comisiones.
    """
    cita = await resolve_cita_by_id(cita_id)
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    sede = await collection_locales.find_one({"sede_id": cita.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    await collection_citas.update_one({"_id": ObjectId(cita["_id"])}, {"$set": {
        "estado": "finalizado",
        "finalizado_por": current_user.get("email"),
        "fecha_finalizacion": today(sede).replace(tzinfo=None)
    }})

    return {"success": True, "mensaje": "Cita finalizada", "cita_id": cita_id}

# =============================================================
# 🔹 MARCAR NO ASISTIÓ
# =============================================================
@router.post("/{cita_id}/no-asistio", response_model=dict)
async def no_asistio(cita_id: str, current_user: dict = Depends(get_current_user)):
    cita = await resolve_cita_by_id(cita_id)
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    sede = await collection_locales.find_one({"sede_id": cita.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    await collection_citas.update_one({"_id": ObjectId(cita["_id"])}, {"$set": {
        "estado": "no_asistio",
        "marcada_no_asistio_por": current_user.get("email"),
        "fecha_no_asistio": today(sede).replace(tzinfo=None)
    }})

    return {"success": True, "mensaje": "Marcada como no asistió", "cita_id": cita_id}


# ============================================================
# 📅 Obtener citas del estilista autenticado - VERSIÓN OPTIMIZADA
# ✅ Sin cambios en el frontend
# ✅ De N*3 queries → 3 queries totales
# ✅ Filtro de fecha automático (30 días atrás - 60 días adelante)
# ============================================================

@router.get("/citas/estilista", response_model=list)
async def get_citas_estilista(
    current_user: dict = Depends(get_current_user),
    fecha_desde: Optional[str] = Query(default=None, description="DD-MM-YYYY"),
    fecha_hasta: Optional[str] = Query(default=None, description="DD-MM-YYYY"),
):
    if current_user["rol"] != "estilista":
        raise HTTPException(status_code=403, detail="Solo los estilistas pueden ver sus citas")

    estilista = await collection_estilista.find_one({"email": current_user["email"]})
    if not estilista:
        raise HTTPException(status_code=404, detail="No se encontró el profesional asociado a este usuario")

    profesional_id = estilista.get("profesional_id")

    hoy = datetime.utcnow()
    dt_desde = fecha_a_datetime(fecha_desde) if fecha_desde else hoy - timedelta(days=30)
    dt_hasta = (fecha_a_datetime(fecha_hasta) + timedelta(days=1)) if fecha_hasta else hoy + timedelta(days=60)

    str_desde = dt_desde.strftime("%Y-%m-%d")
    str_hasta = (dt_hasta - timedelta(days=1)).strftime("%Y-%m-%d")

    todos_ids = [profesional_id] + current_user.get("profesional_id_asociados", [])

    # Sede activa: la del header X-Sede-Id o null para ver todas
    sede_activa = current_user.get("sede_id")
    if sede_activa:
        # get_current_user ya resolvió la sede del header → filtrar solo esa
        sedes_visibles = [sede_activa]
    else:
        # sin header: el profesional ve todas sus sedes (fallback)
        sedes_visibles = current_user.get("sedes_permitidas") or []

    match_sede = (
        {"sede_id": {"$in": sedes_visibles}} if sedes_visibles
        else {}  # sin filtro si no hay sedes definidas (fallback seguro)
    )

    pipeline = [
        {
            "$match": {
                "$or": [
                    {"estilista_id": profesional_id},
                    {"profesional_id": profesional_id}
                ],
                "fecha": {"$gte": str_desde, "$lte": str_hasta},
                **match_sede   # ← agrega el filtro de sede si existe
            }
        },
        {"$sort": {"fecha": 1}},
        {
            "$lookup": {
                "from": collection_clients.name,
                "localField": "cliente_id",
                "foreignField": "cliente_id",
                "as": "_cliente_data"
            }
        },
        {
            "$lookup": {
                "from": collection_locales.name,
                "localField": "sede_id",
                "foreignField": "sede_id",
                "as": "_sede_data"
            }
        },
        {
            "$addFields": {
                "_cliente": {"$arrayElemAt": ["$_cliente_data", 0]},
                "_sede":    {"$arrayElemAt": ["$_sede_data", 0]}
            }
        },
        {"$project": {"_cliente_data": 0, "_sede_data": 0}}
    ]

    citas = await collection_citas.aggregate(pipeline).to_list(None)

    # Pre-cargar todos los servicios necesarios en una sola query
    todos_servicio_ids = set()
    for c in citas:
        for serv_item in c.get("servicios", []):
            if serv_item.get("servicio_id"):
                todos_servicio_ids.add(serv_item.get("servicio_id"))
        if c.get("servicio_id"):
            todos_servicio_ids.add(c.get("servicio_id"))

    servicios_db_map = {}
    if todos_servicio_ids:
        servicios_db_list = await collection_servicios.find({
            "$or": [
                {"servicio_id": {"$in": list(todos_servicio_ids)}},
                {"unique_id":   {"$in": list(todos_servicio_ids)}}
            ]
        }).to_list(None)
        for s in servicios_db_list:
            if s.get("servicio_id"): servicios_db_map[s["servicio_id"]] = s
            if s.get("unique_id"):   servicios_db_map[s["unique_id"]] = s

    def detectar_formato(c: dict) -> str:
        servicios_arr = c.get("servicios")
        if isinstance(servicios_arr, list) and len(servicios_arr) > 0:
            return "nuevo"
        if c.get("servicio_id") or c.get("servicio_nombre") or c.get("valor_total"):
            return "antiguo"
        return "vacio"

    def resolver_precio_item(serv_item: dict, servicio_db) -> tuple:
        val = serv_item.get("precio_personalizado")
        es_personalizado = False
        try:
            if val is not None and val is not False and float(val) > 0:
                es_personalizado = True
        except (TypeError, ValueError):
            pass

        if es_personalizado:
            return float(val), True

        precio_item = serv_item.get("precio")
        if precio_item not in (None, 0, "", False):
            try:
                return float(precio_item), False
            except (TypeError, ValueError):
                pass

        if servicio_db:
            precio_bd = servicio_db.get("precio")
            if precio_bd not in (None, 0):
                try:
                    return float(precio_bd), False
                except (TypeError, ValueError):
                    pass

        return 0.0, False

    respuesta = []

    for c in citas:
        formato = detectar_formato(c)

        # CLIENTE
        cliente_raw = c.get("_cliente") or {}
        nombre   = cliente_raw.get("nombre", "")
        apellido = cliente_raw.get("apellido", "")

        if not nombre:
            nombre_embebido = c.get("cliente_nombre", "").strip()
            if nombre_embebido:
                partes   = nombre_embebido.split(" ", 1)
                nombre   = partes[0]
                apellido = partes[1] if len(partes) > 1 else ""

        cliente_data = {
            "cliente_id": c.get("cliente_id", ""),
            "nombre":     nombre   or "Desconocido",
            "apellido":   apellido or "",
            "telefono":   cliente_raw.get("telefono") or c.get("cliente_telefono", ""),
            "email":      cliente_raw.get("email")    or c.get("cliente_email", ""),
        }

        # SERVICIOS Y PRECIO
        servicios_data = []
        precio_total   = 0.0

        if formato == "nuevo":
            for serv_item in c.get("servicios", []):
                servicio_id = serv_item.get("servicio_id")
                servicio_db = servicios_db_map.get(servicio_id) if servicio_id else None
                precio, es_personalizado = resolver_precio_item(serv_item, servicio_db)
                precio_total += precio

                nombre_serv = (
                    serv_item.get("nombre")
                    or (servicio_db.get("nombre") if servicio_db else None)
                    or "Servicio sin nombre"
                )
                servicios_data.append({
                    "servicio_id":          servicio_id or "",
                    "nombre":               nombre_serv,
                    "precio":               precio,
                    "precio_personalizado": es_personalizado
                })

        elif formato == "antiguo":
            servicio_id = c.get("servicio_id")
            servicio_db = servicios_db_map.get(servicio_id) if servicio_id else None

            precio_total = float(
                c.get("valor_total")
                or c.get("precio_total")
                or (servicio_db.get("precio") if servicio_db else 0)
                or 0
            )

            nombre_serv = (
                c.get("servicio_nombre")
                or (servicio_db.get("nombre") if servicio_db else None)
                or "Servicio sin nombre"
            )

            servicios_data.append({
                "servicio_id":          servicio_id or "",
                "nombre":               nombre_serv,
                "precio":               precio_total,
                "precio_personalizado": False
            })

        # SEDE
        sede_raw = c.get("_sede") or {}
        sede_data = {
            "sede_id": c.get("sede_id", ""),
            "nombre":  (
                sede_raw.get("nombre")
                or c.get("sede_nombre")
                or "Sede desconocida"
            )
        }

        respuesta.append({
            "cita_id":                    str(c.get("_id")),
            "cliente":                    cliente_data,
            "servicios":                  servicios_data,
            "sede":                       sede_data,
            "estilista_id":               profesional_id,
            "fecha":                      c.get("fecha"),
            "hora_inicio":                c.get("hora_inicio"),
            "hora_fin":                   c.get("hora_fin"),
            "estado":                     c.get("estado"),
            "estado_pago":                c.get("estado_pago"),
            "notas":                      c.get("notas", None),
            "precio_total":               precio_total,
            "cantidad_servicios":         len(servicios_data),
            "tiene_precio_personalizado": any(s["precio_personalizado"] for s in servicios_data)
        })

    return respuesta

def fix_mongo_id(doc):
    doc["_id"] = str(doc["_id"])
    return doc

# ============================================================
# 📅 Obtener todas las citas de la sede del admin autenticado
# ============================================================
@router.get("/citas-sede", response_model=dict)
async def get_citas_sede(current_user: dict = Depends(get_current_user)):
    if current_user["rol"] not in ["admin_sede", "admin", "call_center", "recepcionista"]:
        raise HTTPException(
            status_code=403,
            detail="Solo los administradores de sede pueden ver esta información"
        )

    sede_id = current_user.get("sede_id")
    if not sede_id:
        raise HTTPException(
            status_code=400,
            detail="El administrador no tiene asignada una sede"
        )

    # 🔥 Filtrar directamente en MongoDB solo las citas finalizadas
    query = {
        "sede_id": sede_id,
        "estado": "finalizado"
    }

    citas = await collection_citas.find(query).to_list(None)

    # 🔥 Convertir todos los ObjectId a string
    citas = [fix_mongo_id(c) for c in citas]

    return {
        "total": len(citas),
        "sede_id": sede_id,
        "citas": citas
    }


# ============================================================
# 📦 Agregar productos a una cita - CON COMISIÓN SEGÚN ROL
# ============================================================
@router.post("/cita/{cita_id}/agregar-productos", response_model=dict)
async def agregar_productos_a_cita(
    cita_id: str,
    productos: List[ProductoItem],
    current_user: dict = Depends(get_current_user)
):
    """
    Agrega productos a una cita usando el precio según la moneda de la sede.
    ⭐ Solo comisiona si lo agrega un ESTILISTA, no si es admin_sede.
    """
    # Solo admin sede, admin o estilista
    if current_user["rol"] not in ["admin_sede", "admin", "estilista", "call_center", "recepcionista"]:
        raise HTTPException(
            status_code=403,
            detail="No tienes permisos para agregar productos"
        )

    # Información del usuario que agrega
    rol_usuario = current_user["rol"]
    email_usuario = current_user.get("email")
    profesional_id = current_user.get("profesional_id")

    # Buscar cita
    cita = await collection_citas.find_one({"_id": ObjectId(cita_id)})
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    # Obtener moneda de la cita
    moneda_cita = cita.get("moneda")
    if not moneda_cita:
        raise HTTPException(
            status_code=400,
            detail="Esta cita no tiene moneda asignada. Contacta soporte."
        )

    # Obtener reglas de comisión de la sede
    sede = await collection_locales.find_one({"sede_id": cita["sede_id"]})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")
    
    reglas_comision = sede.get("reglas_comision", {"tipo": "servicios"})
    tipo_comision = reglas_comision.get("tipo", "servicios")
    
    # Verificar si la sede permite comisión de productos
    permite_comision_productos = tipo_comision in ["productos", "mixto"]
    
    # ⭐ REGLA: Solo comisiona si es ESTILISTA, recepcionista, call_center, admin_sede
    ROLES_CON_COMISION_PRODUCTOS = {"estilista", "recepcionista", "call_center", "admin_sede"}
    aplica_comision = permite_comision_productos and rol_usuario in ROLES_CON_COMISION_PRODUCTOS

    vendedor_doc = None
    profesional_id_comision = profesional_id
    if aplica_comision:
        if rol_usuario == "estilista":
            vendedor_doc = await collection_estilista.find_one(
                {"profesional_id": profesional_id}
            )
        else:
            vendedor_doc = await collection_auth.find_one(
                {"correo_electronico": email_usuario}
            )
            if vendedor_doc:
                profesional_id_comision = str(vendedor_doc["_id"])

    # Productos actuales
    productos_actuales = cita.get("productos", [])

    # Procesar nuevos productos
    nuevos_productos = []
    total_productos = 0
    total_comision_productos = 0
    unidades_en_agregado_actual = 0

    for p in productos:
        # Buscar producto en BD
        producto_db = await collection_products.find_one({"id": p.producto_id})
        
        if not producto_db:
            raise HTTPException(
                status_code=404,
                detail=f"Producto con ID '{p.producto_id}' no encontrado"
            )
        
        # Obtener precio en la moneda correcta
        precios_producto = producto_db.get("precios", {})
        
        if moneda_cita not in precios_producto:
            raise HTTPException(
                status_code=400,
                detail=f"El producto '{producto_db.get('nombre')}' no tiene precio configurado en {moneda_cita}"
            )
        
        precio_unitario = round(precios_producto[moneda_cita], 2)
        subtotal = round(p.cantidad * precio_unitario, 2)
        
        # Calcular comisión (solo si es estilista)
        comision_porcentaje = 0
        comision_producto = 0
        
        if aplica_comision:
            inventario_db = await collection_inventarios.find_one(
                {"producto_id": p.producto_id, "sede_id": cita["sede_id"]}
            )
            config = resolver_config_comision(
                producto_db,
                vendedor_doc,
                inventario_db,
                sede,
            )
            ctx = await construir_contexto(
                profesional_id=profesional_id_comision,
                sede_id=cita["sede_id"],
                cantidad_actual=p.cantidad,
                moneda_sede=moneda_cita,
                vendedor_nombre=(vendedor_doc or {}).get("nombre"),
            )
            ctx.cantidad_acumulada_periodo += unidades_en_agregado_actual
            resultado = calcular_comision(config, subtotal, ctx)
            comision_producto = resultado.valor
            if config.tipo in ("porcentaje", "fijo", "por_unidad"):
                comision_porcentaje = config.valor
            elif config.tipo == "escalonado" and resultado.nivel_nuevo:
                comision_porcentaje = resultado.nivel_nuevo.valor
            elif config.tipo == "escalonado":
                total = ctx.cantidad_acumulada_periodo + ctx.cantidad_actual
                tramo_activo = next(
                    (t for t in sorted(config.tramos, key=lambda t: t.desde)
                    if total >= t.desde and (t.hasta is None or total <= t.hasta)),
                    None
                )
                comision_porcentaje = tramo_activo.valor if tramo_activo else 0
            total_comision_productos += comision_producto
            unidades_en_agregado_actual += p.cantidad
        
        # Construir objeto producto
        nuevo_producto = {
            "producto_id": p.producto_id,
            "nombre": producto_db.get("nombre"),
            "cantidad": p.cantidad,
            "precio_unitario": precio_unitario,
            "subtotal": subtotal,
            "moneda": moneda_cita,
            "comision_porcentaje": comision_porcentaje,
            "comision_valor": comision_producto,
            "agregado_por_email": email_usuario,
            "agregado_por_rol": rol_usuario,
            "fecha_agregado": today_str(sede),
        }
        
        # Si es estilista, guardar su profesional_id para comisiones
        if rol_usuario == "estilista" and profesional_id:
            nuevo_producto["profesional_id"] = profesional_id
        
        nuevos_productos.append(nuevo_producto)
        total_productos += subtotal

    # Redondear totales
    total_productos = round(total_productos, 2)
    total_comision_productos = round(total_comision_productos, 2)

    # Agregar productos a la cita
    productos_final = productos_actuales + nuevos_productos

    # Recalcular totales
    nuevo_total = round(cita.get("valor_total", 0) + total_productos, 2)
    abono_actual = round(cita.get("abono", 0), 2)
    nuevo_saldo = round(nuevo_total - abono_actual, 2)

    # Recalcular estado de pago
    if nuevo_saldo <= 0:
        nuevo_estado_pago = "pagado"
    elif abono_actual > 0:
        nuevo_estado_pago = "abonado"
    else:
        nuevo_estado_pago = "pendiente"

    # Actualizar cita
    await collection_citas.update_one(
        {"_id": ObjectId(cita_id)},
        {
            "$set": {
                "productos": productos_final,
                "valor_total": nuevo_total,
                "saldo_pendiente": nuevo_saldo,
                "estado_pago": nuevo_estado_pago,
                "ultima_actualizacion": today(sede).replace(tzinfo=None)
            }
        }
    )

    # Obtener cita actualizada
    cita_actualizada = await collection_citas.find_one({"_id": ObjectId(cita_id)})
    cita_actualizada["_id"] = str(cita_actualizada["_id"])

    return {
        "success": True,
        "message": "Productos agregados correctamente",
        "productos_agregados": len(nuevos_productos),
        "total_productos": total_productos,
        "total_comision_productos": total_comision_productos,
        "aplica_comision": aplica_comision,
        "agregado_por": {
            "email": email_usuario,
            "rol": rol_usuario
        },
        "moneda": moneda_cita,
        "cita": cita_actualizada
    }


# ============================================================
# 🗑️ Eliminar producto de una cita
# ============================================================
@router.delete("/cita/{cita_id}/productos/{producto_id}", response_model=dict)
async def eliminar_producto_de_cita(
    cita_id: str,
    producto_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Elimina un producto específico de una cita y recalcula totales.
    ⭐ Recalcula el total RESTANDO solo el producto eliminado.
    ⭐ Aplica redondeo para corregir errores de punto flotante.
    """
    # Solo admin sede, admin o estilista
    if current_user["rol"] not in ["admin_sede", "admin", "estilista", "call_center", "recepcionista"]:
        raise HTTPException(
            status_code=403,
            detail="No tienes permisos para eliminar productos"
        )

    # Buscar cita
    cita = await collection_citas.find_one({"_id": ObjectId(cita_id)})
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    sede = await collection_locales.find_one({"sede_id": cita.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    # Verificar que la cita tenga productos
    productos_actuales = cita.get("productos", [])
    if not productos_actuales:
        raise HTTPException(
            status_code=400,
            detail="Esta cita no tiene productos agregados"
        )

    # Buscar y filtrar el producto a eliminar
    producto_encontrado = None
    productos_filtrados = []
    
    for producto in productos_actuales:
        if producto.get("producto_id") == producto_id:
            producto_encontrado = producto
        else:
            productos_filtrados.append(producto)

    # Validar que el producto existe en la cita
    if not producto_encontrado:
        raise HTTPException(
            status_code=404,
            detail=f"Producto con ID '{producto_id}' no encontrado en esta cita"
        )

    # Calcular totales después de eliminar
    total_productos_restante = round(sum(p.get("subtotal", 0) for p in productos_filtrados), 2)
    
    # Recalcular totales de la cita
    valor_servicios = round(cita.get("valor_total", 0) - sum(p.get("subtotal", 0) for p in productos_actuales), 2)
    nuevo_total = round(valor_servicios + total_productos_restante, 2)
    abono_actual = round(cita.get("abono", 0), 2)
    nuevo_saldo = round(nuevo_total - abono_actual, 2)

    # Recalcular estado de pago
    if nuevo_saldo <= 0:
        nuevo_estado_pago = "pagado"
    elif abono_actual > 0:
        nuevo_estado_pago = "abonado"
    else:
        nuevo_estado_pago = "pendiente"

    # Actualizar cita (sin historial)
    await collection_citas.update_one(
        {"_id": ObjectId(cita_id)},
        {
            "$set": {
                "productos": productos_filtrados,
                "valor_total": nuevo_total,
                "saldo_pendiente": nuevo_saldo,
                "estado_pago": nuevo_estado_pago,
                "ultima_actualizacion": today(sede).replace(tzinfo=None)
            }
        }
    )

    # Obtener cita actualizada
    cita_actualizada = await collection_citas.find_one({"_id": ObjectId(cita_id)})
    cita_actualizada["_id"] = str(cita_actualizada["_id"])

    return {
        "success": True,
        "message": "Producto eliminado correctamente",
        "productos_restantes": len(productos_filtrados),
        "nuevo_total_cita": nuevo_total,
        "nuevo_saldo": nuevo_saldo,
        "moneda": cita.get("moneda"),
        "cita": cita_actualizada
    }


# ============================================================
# 🗑️ Eliminar TODOS los productos de una cita
# ============================================================
@router.delete("/cita/{cita_id}/productos", response_model=dict)
async def eliminar_todos_productos_de_cita(
    cita_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Elimina TODOS los productos de una cita y recalcula totales.
    """
    # Solo admin sede, admin o estilista
    if current_user["rol"] not in ["admin_sede", "admin", "estilista", "call_center", "recepcionista"]:
        raise HTTPException(
            status_code=403,
            detail="No tienes permisos para eliminar productos"
        )

    # Buscar cita
    cita = await collection_citas.find_one({"_id": ObjectId(cita_id)})
    if not cita:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    sede = await collection_locales.find_one({"sede_id": cita.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    # Verificar que la cita tenga productos
    productos_actuales = cita.get("productos", [])
    if not productos_actuales:
        raise HTTPException(
            status_code=400,
            detail="Esta cita no tiene productos agregados"
        )

    # Calcular totales eliminados
    total_productos_eliminados = round(sum(p.get("subtotal", 0) for p in productos_actuales), 2)
    cantidad_productos = len(productos_actuales)

    # Recalcular totales de la cita (solo servicios)
    valor_servicios = round(cita.get("valor_total", 0) - total_productos_eliminados, 2)
    nuevo_total = valor_servicios
    abono_actual = round(cita.get("abono", 0), 2)
    nuevo_saldo = round(nuevo_total - abono_actual, 2)

    # Recalcular estado de pago
    if nuevo_saldo <= 0:
        nuevo_estado_pago = "pagado"
    elif abono_actual > 0:
        nuevo_estado_pago = "abonado"
    else:
        nuevo_estado_pago = "pendiente"

    # Actualizar cita
    await collection_citas.update_one(
        {"_id": ObjectId(cita_id)},
        {
            "$set": {
                "productos": [],
                "valor_total": nuevo_total,
                "saldo_pendiente": nuevo_saldo,
                "estado_pago": nuevo_estado_pago,
                "ultima_actualizacion": today(sede).replace(tzinfo=None)
            }
        }
    )

    # Obtener cita actualizada
    cita_actualizada = await collection_citas.find_one({"_id": ObjectId(cita_id)})
    cita_actualizada["_id"] = str(cita_actualizada["_id"])

    return {
        "success": True,
        "message": f"Se eliminaron {cantidad_productos} productos correctamente",
        "productos_eliminados": cantidad_productos,
        "nuevo_total_cita": nuevo_total,
        "nuevo_saldo": nuevo_saldo,
        "moneda": cita.get("moneda"),
        "cita": cita_actualizada
    }
# ============================================
# ✅ Finalizar servicio con PDF
# ============================================
@router.put("/citas/{cita_id}/finalizar", response_model=dict)
async def finalizar_servicio_con_pdf(
    cita_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user["rol"] not in ["admin_sede", "estilista"]:
        raise HTTPException(status_code=403, detail="No tienes permisos para finalizar servicios")

    cita = await collection_citas.find_one({"_id": ObjectId(cita_id)})
    if not cita:
        raise HTTPException(status_code=404, detail="La cita no existe")

    if cita.get("estado") == "finalizado":
        raise HTTPException(status_code=400, detail="Esta cita ya fue finalizada")

    sede = await collection_locales.find_one({"sede_id": cita.get("sede_id")})
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    now = today(sede).replace(tzinfo=None)

    await collection_citas.update_one(
        {"_id": ObjectId(cita_id)},
        {"$set": {
            "estado":             "finalizado",
            "fecha_finalizacion": now,
            "finalizado_por":     current_user.get("email"),
        }}
    )

    # ── Analytics (siempre) ───────────────────────────────────────────────
    cliente_id = cita.get("cliente_id")
    if cliente_id:
        try:
            analytics = await calcular_analytics_cliente(cliente_id, now)
            if analytics:
                await collection_clients.update_one(
                    {"cliente_id": cliente_id},
                    {"$set": analytics}
                )
        except Exception as e:
            logger.warning(f"Analytics no actualizados para {cliente_id}: {e}")

    # ── Ficha técnica (opcional) ──────────────────────────────────────────
    ficha = await collection_card.find_one({"datos_especificos.cita_id": cita_id})

    if not ficha:
        return {
            "success":      True,
            "message":      "Servicio finalizado correctamente (sin ficha técnica)",
            "cita_id":      cita_id,
            "estado":       "finalizado",
            "pdf_generado": False,
            "pdf_enviado":  False,
        }

    await collection_card.update_one(
        {"_id": ficha["_id"]},
        {"$set": {"estado": "finalizado"}}
    )

    ficha_actualizada = await collection_card.find_one({"_id": ficha["_id"]})
    pdf_result = await generar_y_enviar_pdf_ficha(ficha_actualizada, cita_id)

    await collection_citas.update_one(
        {"_id": ObjectId(cita_id)},
        {"$set": {
            "pdf_generado":         pdf_result["pdf_generado"],
            "pdf_fecha_generacion": now,
            "pdf_enviado":          pdf_result["pdf_enviado"],
        }}
    )

    return {
        "success": True,
        "message": "Servicio finalizado correctamente",
        "cita_id": cita_id,
        "estado":  "finalizado",
        **pdf_result,
    }