from datetime import date, datetime, time, timedelta
from typing import List, Optional
from uuid import uuid4

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth.routes import get_current_user
from app.database.mongo import collection_block

router = APIRouter()

ALLOWED_CREATE_ROLES = {"admin_sede", "admin_franquicia", "super_admin", "superadmin", "estilista", "recepcionista", "call_center"}
SUPERADMIN_ROLES = {"super_admin", "superadmin"}


class BloqueoCreatePayload(BaseModel):
    profesional_id: str
    sede_id: str
    fecha: Optional[date] = None
    hora_inicio: str
    hora_fin: str
    motivo: Optional[str] = None
    recurrente: bool = False
    dias_semana: List[int] = Field(default_factory=list)
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None

class BloqueoUpdatePayload(BaseModel):
    hora_inicio: Optional[str] = None
    hora_fin: Optional[str] = None
    motivo: Optional[str] = None
    # Solo para series recurrentes
    fecha_fin_regla: Optional[date] = None
    # Si True y el bloqueo es parte de una serie → edita TODOS los de la serie
    editar_serie: bool = False

def _parse_time(value: str, field_name: str) -> str:
    raw = (value or "").strip()
    try:
        parsed = time.fromisoformat(raw)
    except Exception:
        raise HTTPException(status_code=400, detail=f"{field_name} inválida. Usa formato HH:MM")
    return parsed.strftime("%H:%M")


def _to_object_id(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=400, detail="ID de bloqueo inválido")


def _to_iso_date(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        if "T" in raw:
            return raw.split("T")[0]
        if " " in raw:
            return raw.split(" ")[0]
        return raw
    return None


def _to_hhmm(value) -> str:
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return ""
        try:
            return time.fromisoformat(raw).strftime("%H:%M")
        except Exception:
            return raw[:5]
    return ""


def _js_weekday(value: date) -> int:
    # Python: lunes=0 ... domingo=6
    # Frontend requerido: domingo=0, lunes=1 ... sábado=6
    return (value.weekday() + 1) % 7


def _serialize_bloqueo(doc: dict) -> dict:
    repeat = doc.get("repeat") or {}
    fecha = _to_iso_date(doc.get("fecha")) or _to_iso_date(doc.get("start_date")) or ""
    fecha_creacion = doc.get("fecha_creacion")
    if isinstance(fecha_creacion, datetime):
        fecha_creacion = fecha_creacion.isoformat()
    elif isinstance(fecha_creacion, date):
        fecha_creacion = datetime.combine(fecha_creacion, time.min).isoformat()

    return {
        "_id": str(doc.get("_id", "")),
        "profesional_id": str(doc.get("profesional_id", "")),
        "sede_id": str(doc.get("sede_id", "")),
        "fecha": fecha,
        "hora_inicio": _to_hhmm(doc.get("hora_inicio") or doc.get("start_time")),
        "hora_fin": _to_hhmm(doc.get("hora_fin") or doc.get("end_time")),
        "motivo": doc.get("motivo") or "Bloqueo de agenda",
        "recurrente": bool(doc.get("recurrente") or doc.get("serie_id")),
        "serie_id": doc.get("serie_id"),
        "dias_semana": doc.get("dias_semana") or repeat.get("days_of_week", []),
        "fecha_inicio_regla": _to_iso_date(doc.get("fecha_inicio_regla") or doc.get("start_date")),
        "fecha_fin_regla": _to_iso_date(doc.get("fecha_fin_regla") or repeat.get("until")),
        "creado_por": doc.get("creado_por"),
        "fecha_creacion": fecha_creacion,
    }


def _assert_delete_permissions(current_user: dict, bloqueo: dict) -> None:
    rol = str(current_user.get("rol", "")).strip().lower()

    if rol in SUPERADMIN_ROLES:
        return

    if rol == "admin_franquicia":
        return

    if rol == "admin_sede":
        if bloqueo.get("sede_id") != current_user.get("sede_id"):
            raise HTTPException(status_code=403, detail="No autorizado para eliminar este bloqueo")
        return

    if rol == "estilista":
        if bloqueo.get("profesional_id") != current_user.get("profesional_id"):
            raise HTTPException(status_code=403, detail="No autorizado para eliminar este bloqueo")
        # ✅ No validar sede aquí — si es su propio bloqueo, puede gestionarlo
        return

    raise HTTPException(status_code=403, detail="No autorizado para eliminar bloqueos")


@router.post("/", response_model=dict)
async def crear_bloqueo(
    payload: BloqueoCreatePayload,
    current_user: dict = Depends(get_current_user)
):
    rol = str(current_user.get("rol", "")).strip().lower()
    if rol not in ALLOWED_CREATE_ROLES:
        raise HTTPException(status_code=403, detail="No autorizado")

    profesional_id = payload.profesional_id.strip()
    sede_id = payload.sede_id.strip()
    if not profesional_id:
        raise HTTPException(status_code=400, detail="El profesional es obligatorio")
    if not sede_id:
        raise HTTPException(status_code=400, detail="La sede es obligatoria")

    if rol == "estilista":
        user_profesional = str(current_user.get("profesional_id", "")).strip()
        user_sede = str(current_user.get("sede_id", "")).strip()
        sedes_permitidas = current_user.get("sedes_permitidas") or []

        if not user_profesional or user_profesional != profesional_id:
            raise HTTPException(status_code=403, detail="No autorizado para crear bloqueos de otro profesional")

        # Sede válida si es la sede activa O está en sedes_permitidas
        sedes_validas = set(sedes_permitidas)
        if user_sede:
            sedes_validas.add(user_sede)

        if sede_id not in sedes_validas:
            raise HTTPException(status_code=403, detail="No autorizado para crear bloqueos fuera de tu sede")

    if rol == "admin_sede":
        user_sede = str(current_user.get("sede_id", "")).strip()
        if not user_sede:
            raise HTTPException(status_code=400, detail="No se pudo determinar tu sede")
        # Sobreescribir siempre con la sede del admin — el frontend puede mandar
        # la sede principal del profesional pero el bloqueo debe crearse en la sede activa
        sede_id = user_sede

    hora_inicio = _parse_time(payload.hora_inicio, "hora_inicio")
    hora_fin = _parse_time(payload.hora_fin, "hora_fin")
    if time.fromisoformat(hora_fin) <= time.fromisoformat(hora_inicio):
        raise HTTPException(status_code=400, detail="La hora de fin debe ser mayor a la hora de inicio")

    motivo = (payload.motivo or "").strip() or "Bloqueo de agenda"

    if payload.recurrente:
        fecha_inicio = payload.fecha_inicio or payload.fecha
        fecha_fin = payload.fecha_fin
        if not fecha_inicio:
            raise HTTPException(status_code=400, detail="La fecha de inicio es obligatoria para bloqueos recurrentes")
        if not fecha_fin:
            raise HTTPException(status_code=400, detail="La fecha límite es obligatoria para bloqueos recurrentes")
        if fecha_fin < fecha_inicio:
            raise HTTPException(status_code=400, detail="La fecha límite no puede ser menor a la fecha inicial")

        dias_semana = sorted(set(payload.dias_semana))
        if not dias_semana:
            raise HTTPException(status_code=400, detail="Debes seleccionar al menos un día de la semana")
        if any(day < 0 or day > 6 for day in dias_semana):
            raise HTTPException(status_code=400, detail="Los días de la semana deben estar entre 0 y 6")
    else:
        fecha_unica = payload.fecha or payload.fecha_inicio
        if not fecha_unica:
            raise HTTPException(status_code=400, detail="La fecha es obligatoria")
        fecha_inicio = fecha_unica
        fecha_fin = fecha_unica
        dias_semana = [_js_weekday(fecha_unica)]

    fechas_programadas: List[date] = []
    cursor = fecha_inicio
    while cursor <= fecha_fin:
        if _js_weekday(cursor) in dias_semana:
            fechas_programadas.append(cursor)
        cursor += timedelta(days=1)

    if not fechas_programadas:
        raise HTTPException(status_code=400, detail="No hay fechas válidas para crear bloqueos")

    serie_id = str(uuid4()) if payload.recurrente else None
    creador = current_user.get("email") or current_user.get("correo_electronico") or current_user.get("nombre")

    documentos_a_crear = []
    omitidos_duplicado: List[str] = []
    omitidos_solape: List[str] = []

    for fecha_actual in fechas_programadas:
        fecha_iso = fecha_actual.isoformat()

        conflicto = await collection_block.find_one(
            {
                "profesional_id": profesional_id,
                "fecha": fecha_iso,
                "hora_inicio": {"$lt": hora_fin},
                "hora_fin": {"$gt": hora_inicio},
            }
        )

        if conflicto:
            if (
                str(conflicto.get("hora_inicio", "")) == hora_inicio
                and str(conflicto.get("hora_fin", "")) == hora_fin
            ):
                omitidos_duplicado.append(fecha_iso)
            else:
                omitidos_solape.append(fecha_iso)
            continue

        documentos_a_crear.append(
            {
                "profesional_id": profesional_id,
                "sede_id": sede_id,
                "fecha": fecha_iso,
                "hora_inicio": hora_inicio,
                "hora_fin": hora_fin,
                "motivo": motivo,
                "recurrente": bool(payload.recurrente),
                "serie_id": serie_id,
                "dias_semana": dias_semana if payload.recurrente else [],
                "fecha_inicio_regla": fecha_inicio.isoformat() if payload.recurrente else None,
                "fecha_fin_regla": fecha_fin.isoformat() if payload.recurrente else None,
                "creado_por": creador,
                "fecha_creacion": datetime.utcnow(),
            }
        )

    if not documentos_a_crear:
        if payload.recurrente:
            raise HTTPException(
                status_code=400,
                detail="No se crearon bloqueos: todos los horarios seleccionados ya estaban bloqueados o en conflicto",
            )
        raise HTTPException(status_code=400, detail="El profesional ya tiene un bloqueo en ese horario")

    if len(documentos_a_crear) == 1:
        result = await collection_block.insert_one(documentos_a_crear[0])
        documentos_a_crear[0]["_id"] = result.inserted_id
    else:
        result = await collection_block.insert_many(documentos_a_crear, ordered=False)
        for doc, inserted_id in zip(documentos_a_crear, result.inserted_ids):
            doc["_id"] = inserted_id

    bloqueos_creados = [_serialize_bloqueo(doc) for doc in documentos_a_crear]

    if payload.recurrente:
        solicitados = len(fechas_programadas)
        creados = len(bloqueos_creados)
        omitidos = solicitados - creados
        return {
            "msg": "Bloqueos recurrentes creados correctamente",
            "resumen": {
                "solicitados": solicitados,
                "creados": creados,
                "omitidos": omitidos,
                "omitidos_por_duplicado": len(omitidos_duplicado),
                "omitidos_por_solape": len(omitidos_solape),
                "fecha_inicio": fecha_inicio.isoformat(),
                "fecha_fin": fecha_fin.isoformat(),
                "dias_semana": dias_semana,
            },
            "bloqueos": bloqueos_creados,
        }

    return {"msg": "Bloqueo creado correctamente", "bloqueo": bloqueos_creados[0]}


@router.get("/{profesional_id}", response_model=List[dict])
async def listar_bloqueos_profesional(
    profesional_id: str,
    current_user: dict = Depends(get_current_user),
    sede_id: Optional[str] = None,  # query param explícito como fallback
):
    from app.utils.scope import get_profesional_ids, expand_profesional_filter
    rol = str(current_user.get("rol", "")).strip().lower()
    todos_ids = get_profesional_ids(current_user)

    if rol == "estilista" and profesional_id not in todos_ids:
        raise HTTPException(status_code=403, detail="No autorizado")

    filtro = {
        "profesional_id": expand_profesional_filter(profesional_id, current_user)
    }

    # Prioridad: query param > sede_activa del token > sin filtro (super_admin)
    sede_filtro = sede_id or current_user.get("sede_id")

    if sede_filtro and rol not in SUPERADMIN_ROLES:
        filtro["sede_id"] = sede_filtro.strip()

    bloqueos = await collection_block.find(filtro).sort(
        [("fecha", 1), ("hora_inicio", 1)]
    ).to_list(None)

    return [_serialize_bloqueo(b) for b in bloqueos]

# Nota: las siguientes rutas de edición y eliminación reutilizan la misma lógica de permisos, por eso no se repite la validación de rol sino que se delega a una función común.

# ==== Edición de bloqueos ====
@router.patch("/{bloqueo_id}", response_model=dict)
async def editar_bloqueo(
    bloqueo_id: str,
    payload: BloqueoUpdatePayload,
    current_user: dict = Depends(get_current_user)
):
    """
    Edita un bloqueo existente.

    ⭐ REGLAS:
    - Si el bloqueo es parte de una serie y editar_serie=True → actualiza TODOS los de la serie
    - Si editar_serie=False (default) → actualiza solo ese bloqueo puntual
    - Valida que la nueva hora_fin > hora_inicio
    - Valida que no haya conflicto con otro bloqueo del mismo profesional en la misma fecha
    """

    bloqueo_oid = _to_object_id(bloqueo_id)
    bloqueo = await collection_block.find_one({"_id": bloqueo_oid})
    if not bloqueo:
        raise HTTPException(status_code=404, detail="Bloqueo no encontrado")

    # Reutilizar la misma lógica de permisos que el delete
    _assert_delete_permissions(current_user, bloqueo)

    # Construir campos a actualizar
    update_fields: dict = {}

    # --- HORA INICIO / FIN ---
    hora_inicio_final = bloqueo.get("hora_inicio")
    hora_fin_final    = bloqueo.get("hora_fin")

    if payload.hora_inicio is not None:
        hora_inicio_final = _parse_time(payload.hora_inicio, "hora_inicio")
        update_fields["hora_inicio"] = hora_inicio_final

    if payload.hora_fin is not None:
        hora_fin_final = _parse_time(payload.hora_fin, "hora_fin")
        update_fields["hora_fin"] = hora_fin_final

    if time.fromisoformat(hora_fin_final) <= time.fromisoformat(hora_inicio_final):
        raise HTTPException(
            status_code=400,
            detail="La hora de fin debe ser mayor a la hora de inicio"
        )

    # --- MOTIVO ---
    if payload.motivo is not None:
        motivo = payload.motivo.strip() or "Bloqueo de agenda"
        update_fields["motivo"] = motivo

    # --- FECHA FIN REGLA (solo para series) ---
    serie_id = bloqueo.get("serie_id")
    if payload.fecha_fin_regla is not None:
        if not serie_id:
            raise HTTPException(
                status_code=400,
                detail="fecha_fin_regla solo aplica para bloqueos recurrentes"
            )
        fecha_inicio_regla = bloqueo.get("fecha_inicio_regla")
        if fecha_inicio_regla and payload.fecha_fin_regla.isoformat() < fecha_inicio_regla:
            raise HTTPException(
                status_code=400,
                detail="La fecha límite no puede ser menor a la fecha de inicio de la regla"
            )
        update_fields["fecha_fin_regla"] = payload.fecha_fin_regla.isoformat()

    if not update_fields:
        raise HTTPException(status_code=400, detail="No se enviaron campos para actualizar")

    # --- VALIDAR CONFLICTO (solo si cambia horario) ---
    cambia_horario = "hora_inicio" in update_fields or "hora_fin" in update_fields

    if cambia_horario:
        profesional_id = bloqueo.get("profesional_id")

        # Obtener fechas afectadas para validar conflictos
        if payload.editar_serie and serie_id:
            # Todas las fechas de la serie
            docs_serie = await collection_block.find(
                {"serie_id": serie_id}
            ).to_list(None)
            fechas_a_validar = [
                (_to_iso_date(d.get("fecha")), str(d.get("_id")))
                for d in docs_serie
            ]
        else:
            fechas_a_validar = [
                (_to_iso_date(bloqueo.get("fecha")), bloqueo_id)
            ]

        for fecha_iso, doc_id_str in fechas_a_validar:
            if not fecha_iso:
                continue
            conflicto = await collection_block.find_one({
                "_id":            {"$ne": ObjectId(doc_id_str)},
                "profesional_id": profesional_id,
                "fecha":          fecha_iso,
                "hora_inicio":    {"$lt": hora_fin_final},
                "hora_fin":       {"$gt": hora_inicio_final},
            })
            if conflicto:
                raise HTTPException(
                    status_code=400,
                    detail=f"El profesional ya tiene un bloqueo en conflicto el {fecha_iso}"
                )

    # --- EJECUTAR ACTUALIZACIÓN ---
    if payload.editar_serie and serie_id:
        # Actualizar todos los documentos de la serie
        result = await collection_block.update_many(
            {"serie_id": serie_id},
            {"$set": update_fields}
        )
        modificados = result.modified_count

        # Si cambió fecha_fin_regla, eliminar las ocurrencias que caigan después de la nueva fecha
        if "fecha_fin_regla" in update_fields:
            nueva_fecha_fin = update_fields["fecha_fin_regla"]
            await collection_block.delete_many({
                "serie_id": serie_id,
                "fecha":    {"$gt": nueva_fecha_fin}
            })

        return {
            "msg": f"Serie actualizada correctamente ({modificados} bloqueos modificados)",
            "serie_id": serie_id,
            "campos_actualizados": list(update_fields.keys())
        }

    else:
        # Actualizar solo este bloqueo
        result = await collection_block.update_one(
            {"_id": bloqueo_oid},
            {"$set": update_fields}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Bloqueo no encontrado")

        bloqueo_actualizado = await collection_block.find_one({"_id": bloqueo_oid})
        return {
            "msg": "Bloqueo actualizado correctamente",
            "bloqueo": _serialize_bloqueo(bloqueo_actualizado)
        }

@router.patch("/{bloqueo_id}/exclude-day", response_model=dict)
async def excluir_dia_bloqueo(
    bloqueo_id: str,
    fecha: date,
    current_user: dict = Depends(get_current_user)
):
    bloqueo_oid = _to_object_id(bloqueo_id)
    bloqueo = await collection_block.find_one({"_id": bloqueo_oid})
    if not bloqueo:
        raise HTTPException(status_code=404, detail="Bloqueo no encontrado")

    _assert_delete_permissions(current_user, bloqueo)

    fecha_iso = fecha.isoformat()
    serie_id = bloqueo.get("serie_id")
    profesional_id = bloqueo.get("profesional_id")

    if serie_id:
        result = await collection_block.delete_one(
            {"serie_id": serie_id, "profesional_id": profesional_id, "fecha": fecha_iso}
        )
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="No se encontró bloqueo de la serie para la fecha indicada")
        return {"msg": "Día excluido del bloqueo", "eliminados": result.deleted_count}

    if _to_iso_date(bloqueo.get("fecha")) == fecha_iso:
        result = await collection_block.delete_one({"_id": bloqueo_oid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Bloqueo no encontrado")
        return {"msg": "Día excluido del bloqueo", "eliminados": result.deleted_count}

    raise HTTPException(status_code=400, detail="Este bloqueo no corresponde a la fecha indicada")


@router.delete("/{bloqueo_id}", response_model=dict)
async def eliminar_bloqueo(
    bloqueo_id: str,
    current_user: dict = Depends(get_current_user)
):
    bloqueo_oid = _to_object_id(bloqueo_id)
    bloqueo = await collection_block.find_one({"_id": bloqueo_oid})

    if not bloqueo:
        raise HTTPException(status_code=404, detail="Bloqueo no encontrado")

    _assert_delete_permissions(current_user, bloqueo)

    result = await collection_block.delete_one({"_id": bloqueo_oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bloqueo no encontrado")

    return {"msg": "Bloqueo eliminado correctamente"}