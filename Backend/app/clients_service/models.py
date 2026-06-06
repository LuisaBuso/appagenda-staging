from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List, Literal
from datetime import datetime


class ClienteLigero(BaseModel):
    id: str
    cliente_id: str
    nombre: str
    correo: Optional[str] = None
    telefono: Optional[str] = None
    sede_id: Optional[str] = None
    fecha_registro: Optional[datetime] = None

# Modelo para metadata de paginación
class MetadataPaginacion(BaseModel):
    total: int
    pagina: int
    limite: int
    total_paginas: int
    tiene_siguiente: bool
    tiene_anterior: bool
    rango_inicio: int
    rango_fin: int

# Modelo para la respuesta completa
class ClientesPaginados(BaseModel):
    clientes: List[dict]
    metadata: MetadataPaginacion


class NotaCliente(BaseModel):
    contenido: str          # ← was "nota", frontend sends "contenido"
    autor: Optional[str] = None

class Cliente(BaseModel):
    cliente_id: Optional[str] = None
    nombre: str
    correo: Optional[EmailStr] = None
    telefono: Optional[str] = None
    cedula: Optional[str] = None
    ciudad: Optional[str] = None
    fecha_de_nacimiento: Optional[str] = None
    sede_id: Optional[str] = None
    notas: Optional[str] = None
    fecha_creacion: Optional[datetime] = None
    ultima_visita: Optional[str] = None         # ← new, ISO date string
    total_gastado: Optional[float] = None        # ← new
    ticket_promedio: Optional[float] = None      # ← new
    dias_sin_visitar: Optional[int] = None       # ← new

    @field_validator("nombre", mode="before")
    @classmethod
    def validar_nombre(cls, v):
        if v is None:
            raise ValueError("El nombre es obligatorio")
        if isinstance(v, str):
            nombre_limpio = v.strip()
            if not nombre_limpio:
                raise ValueError("El nombre es obligatorio")
            return nombre_limpio
        return v

    @field_validator(
        "correo",
        "telefono",
        "cedula",
        "ciudad",
        "fecha_de_nacimiento",
        "sede_id",
        "notas",
        mode="before",
    )
    @classmethod
    def normalizar_opcionales(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("fecha_de_nacimiento")
    @classmethod
    def validar_fecha(cls, v):
        if v is None:
            return v
        """try:
            datetime.strptime(v, "%Y-%m-%d")
        except:
            raise ValueError("Formato de fecha inválido. Use YYYY-MM-DD")"""
        return v

# ─── MODELO ─────────────────────────────────────────────────────
CalificacionValor = Literal["excelente", "bueno", "regular", "malo", "no_se_atiende"]

class CalificacionRequest(BaseModel):
    calificacion: CalificacionValor
    cita_id: Optional[str] = None   # para trazabilidad
    nota: Optional[str] = ""        # comentario libre opcion