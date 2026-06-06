from pydantic import BaseModel, Field, field_validator, validator
from datetime import datetime, time, date
from typing import Optional, List, Dict, Any

# === SERVICIO ===
class Servicio(BaseModel):
    nombre: str
    duracion_minutos: int
    precio: float
    categoria: Optional[str] = None
    comision_estilista: Optional[float] = 0
    requiere_producto: Optional[bool] = False
    descripcion: Optional[str] = None
    sede_id: str

    
# === SUBMODELO: Día de la semana ===
class DiaDisponible(BaseModel):
    dia_semana: int = Field(..., ge=1, le=7, description="1=lunes ... 7=domingo")
    hora_inicio: str = Field(..., description="Hora inicio HH:MM")
    hora_fin: str = Field(..., description="Hora fin HH:MM")
    activo: bool = Field(default=True)

    @field_validator("hora_inicio", "hora_fin")
    @classmethod
    def validar_formato_hora(cls, v: str):
        try:
            time.fromisoformat(v)
        except Exception:
            raise ValueError("El formato debe ser HH:MM (24h)")
        return v

# === HORARIO (usa profesional_id) ===
class Horario(BaseModel):
    profesional_id: str = Field(..., description="ID del profesional ej: P001")
    sede_id: str = Field(..., description="ID de sede ej: 001") 
    disponibilidad: List[DiaDisponible]

class RepeatRule(BaseModel):
    type: str  # "weekly"
    days_of_week: List[int]  # 0=lunes ... 6=domingo
    until: Optional[date] = None
    exclude_dates: List[date] = []
    include_dates: List[date] = []

class Bloqueo(BaseModel):
    profesional_id: str
    sede_id: str
    start_date: date
    start_time: str  # "HH:MM"
    end_time: str
    repeat: RepeatRule
    motivo: Optional[str] = None

class ServicioEnCita(BaseModel):
    servicio_id: str
    precio_personalizado: Optional[float] = None  # Puede ser None, 0, o un número positivo
    cantidad: Optional[int] = 1
    
    @validator('precio_personalizado')
    def validar_precio(cls, v):
        # Si es 0, convertir a None (significa "usar precio de BD")
        if v is not None and v == 0:
            return None
        return v

    @validator('cantidad')
    def validar_cantidad(cls, v):
        if v is None:
            return 1
        if v < 1:
            raise ValueError("La cantidad debe ser mayor o igual a 1")
        return v

# === CITA ===
class Cita(BaseModel):
    cliente_id: str
    profesional_id: str
    sede_id: str
    servicios: List[ServicioEnCita]  # ⭐ NUEVO: Lista de servicios con precios opcionales
    fecha: date
    hora_inicio: str
    hora_fin: str
    estado: Optional[str] = "pendiente"  # pendiente | confirmada | cancelada | completada
    metodo_pago_inicial: Optional[str] = "sin_pago"
    abono: Optional[float] = 0
    notas: Optional[str] = None
    codigo_giftcard: Optional[str] = None   # ⭐ NUEVO: código si paga con giftcard

class ServicioEnFicha(BaseModel):
    """Servicio dentro de una ficha técnica"""
    servicio_id: str
    nombre: Optional[str] = None
    precio: Optional[float] = None


class FichaCreate(BaseModel):
    cliente_id: str
    sede_id: str
    profesional_id: str
    
    # ⭐ CAMBIO: Ahora puede recibir uno o múltiples servicios
    servicio_id: Optional[str] = None  # Mantener para compatibilidad
    servicios: Optional[List[ServicioEnFicha]] = None  # NUEVO
    
    servicio_nombre: Optional[str] = None
    profesional_nombre: Optional[str] = None
    
    fecha_ficha: Optional[str] = None
    fecha_reserva: str
    
    email: Optional[str] = None
    nombre: Optional[str] = None
    apellido: Optional[str] = None
    cedula: Optional[str] = None
    telefono: Optional[str] = None
    
    precio: Optional[float] = None
    estado: str = "completada"
    estado_pago: str = "pendiente"
    
    tipo_ficha: str
    datos_especificos: Dict[str, Any] = {}
    descripcion_servicio: Optional[str] = None
    respuestas: Optional[List[Dict]] = []
    
    fotos_antes: Optional[List[str]] = []
    fotos_despues: Optional[List[str]] = []
    
    autorizacion_publicacion: bool = False
    comentario_interno: Optional[str] = None

    class Config:
        arbitrary_types_allowed = True


class ProductoItem(BaseModel):
    producto_id: str
    nombre: str
    cantidad: int
    precio_unitario: float

class PagoRequest(BaseModel):
    monto: float
    metodo_pago: Optional[str] = "efectivo"
    notas: Optional[str] = None
    codigo_giftcard: Optional[str] = None  # ⭐ requerido si metodo_pago == "giftcard"
