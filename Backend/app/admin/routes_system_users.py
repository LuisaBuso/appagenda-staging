from datetime import datetime
from typing import Optional
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.auth.controllers import pwd_context
from app.auth.routes import get_current_user
from app.database.mongo import collection_auth, collection_locales

router = APIRouter(prefix="/superadmin/system-users", tags=["SuperAdmin - System Users"])

ALLOWED_INPUT_ROLES = {"superadmin", "admin", "admin_sede", "call_center"}
SUPERADMIN_ROLES = {"super_admin", "superadmin"}


def _is_superadmin(current_user: dict) -> bool:
    return (current_user.get("rol") or "").strip().lower() in SUPERADMIN_ROLES


def _normalize_input_role(role: str) -> str:
    normalized = role.strip().lower().replace(" ", "_")
    if normalized in {"recepcionista", "adminsede"}:
        normalized = "admin_sede"
    if normalized == "soporte":
        normalized = "call_center"
    if normalized not in ALLOWED_INPUT_ROLES:
        raise HTTPException(status_code=400, detail="Rol inválido")
    return normalized


def _to_storage_role(input_role: str) -> str:
    # Mantiene compatibilidad con el resto del sistema.
    if input_role == "superadmin":
        return "super_admin"
    if input_role == "call_center":
        return "soporte"
    return input_role


def _to_public_role(storage_role: str) -> str:
    if storage_role == "super_admin":
        return "superadmin"
    if storage_role in {"recepcionista", "adminsede", "admin_sede"}:
        return "admin_sede"
    if storage_role in {"soporte", "callcenter", "call_center", "call center"}:
        return "call_center"
    return storage_role


def _generate_secure_password(length: int = 16) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_"
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(char.isupper() for char in candidate)
            and any(char.islower() for char in candidate)
            and any(char.isdigit() for char in candidate)
        ):
            return candidate


class SystemUserCreate(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    role: str
    sede_id: Optional[str] = None
    sedes_permitidas: Optional[list[str]] = Field(default_factory=list)
    comision: Optional[float] = None
    especialidades: list[str] = Field(default_factory=list)
    password: Optional[str] = Field(default=None, min_length=6, max_length=128)
    horario: Optional[dict] = None
    activo: Optional[bool] = True

    @field_validator("nombre", mode="before")
    @classmethod
    def validate_nombre(cls, value):
        if isinstance(value, str):
            value = value.strip()
        if not value:
            raise ValueError("El nombre es obligatorio")
        return value

    @field_validator("role", mode="before")
    @classmethod
    def validate_role(cls, value):
        if not isinstance(value, str):
            raise ValueError("Rol inválido")
        return _normalize_input_role(value)

    @field_validator("sede_id", mode="before")
    @classmethod
    def normalize_sede(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("comision")
    @classmethod
    def validate_comision(cls, value):
        if value is None:
            return None
        if value < 0 or value > 100:
            raise ValueError("La comisión debe estar entre 0 y 100")
        return round(float(value), 2)

    @field_validator("especialidades", mode="before")
    @classmethod
    def normalize_especialidades(cls, value):
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("Especialidades inválidas")

        cleaned = []
        seen = set()
        for item in value:
            if not isinstance(item, str):
                continue
            normalized = item.strip()
            if not normalized or normalized in seen:
                continue
            cleaned.append(normalized)
            seen.add(normalized)

        return cleaned

    @field_validator("password", mode="before")
    @classmethod
    def normalize_password(cls, value):
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Contraseña inválida")
        normalized = value.strip()
        return normalized or None


@router.get("/", response_model=list[dict])
async def list_system_users(current_user: dict = Depends(get_current_user)):
    if not _is_superadmin(current_user):
        raise HTTPException(status_code=403, detail="No autorizado")

    query = {
        "rol": {
            "$in": [
                "super_admin",
                "superadmin",
                "admin",
                "admin_sede",
                "recepcionista",
                "soporte",
                "call_center",
                "callcenter",
                "adminsede",
            ]
        },
        "$or": [{"user_type": "system"}, {"user_type": {"$exists": False}}],
    }

    projection = {
        "_id": 1,
        "nombre": 1,
        "correo_electronico": 1,
        "rol": 1,
        "sede_id": 1,
        "comision": 1,
        "especialidades": 1,
        "activo": 1,
        "fecha_creacion": 1,
        "creado_por": 1,
        "user_type": 1,
    }

    users = await collection_auth.find(query, projection).sort("nombre", 1).to_list(None)
    result = []
    for user in users:
        result.append(
            {
                "_id": str(user["_id"]),
                "nombre": user.get("nombre", ""),
                "email": user.get("correo_electronico", ""),
                "role": _to_public_role(user.get("rol", "")),
                "sede_id": user.get("sede_id"),
                "comision": user.get("comision"),
                "especialidades": user.get("especialidades", []),
                "activo": bool(user.get("activo", True)),
                "user_type": user.get("user_type", "system"),
                "fecha_creacion": user.get("fecha_creacion"),
                "creado_por": user.get("creado_por"),
            }
        )

    return result


@router.post("/", response_model=dict)
async def create_system_user(payload: SystemUserCreate, current_user: dict = Depends(get_current_user)):
    if not _is_superadmin(current_user):
        raise HTTPException(status_code=403, detail="No autorizado")

    role_input = _normalize_input_role(payload.role)
    storage_role = _to_storage_role(role_input)
    email = payload.email.strip().lower()

    existing_user = await collection_auth.find_one({"correo_electronico": email})
    if existing_user:
        raise HTTPException(status_code=400, detail="El email ya está registrado")

    if not payload.sede_id:
        raise HTTPException(status_code=400, detail="La sede es obligatoria")

    sede = await collection_locales.find_one({"sede_id": payload.sede_id})
    if not sede:
        raise HTTPException(status_code=404, detail=f"Sede no encontrada: {payload.sede_id}")

    password_to_hash = payload.password or _generate_secure_password()
    hashed_password = pwd_context.hash(password_to_hash)

    data = {
        "nombre": payload.nombre.strip(),
        "correo_electronico": email,
        "hashed_password": hashed_password,
        "rol": storage_role,
        "sede_id": payload.sede_id,
        "comision": payload.comision,
        "especialidades": payload.especialidades,
        "horario": payload.horario,
        "franquicia_id": None,
        "activo": bool(payload.activo if payload.activo is not None else True),
        "fecha_creacion": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "creado_por": current_user.get("email"),
        "user_type": "system",
    }

    result = await collection_auth.insert_one(data)

    return {
        "success": True,
        "user": {
            "_id": str(result.inserted_id),
            "nombre": data["nombre"],
            "email": data["correo_electronico"],
            "role": role_input,
            "sede_id": data["sede_id"],
            "comision": data["comision"],
            "especialidades": data["especialidades"],
            "activo": data["activo"],
            "user_type": data["user_type"],
            "fecha_creacion": data["fecha_creacion"],
            "creado_por": data["creado_por"],
        },
    }
