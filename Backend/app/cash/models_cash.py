# ============================================================
# models_cash.py - Modelos Pydantic para cierre de caja
# ============================================================

from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict
from datetime import datetime, date
from enum import Enum

# ============================================================
# ENUMS
# ============================================================

class TipoEgreso(str, Enum):
    COMPRA_INTERNA = "compra_interna"
    GASTO_OPERATIVO = "gasto_operativo"
    RETIRO_CAJA = "retiro_caja"
    OTRO = "otro"

class MetodoPagoIngreso(str, Enum):
    EFECTIVO = "efectivo"
    TARJETA_CREDITO = "tarjeta_credito"
    TARJETA_DEBITO = "tarjeta_debito"
    POS = "pos"
    TRANSFERENCIA = "transferencia"
    LINK_DE_PAGO = "link_de_pago"
    LINK_PAGO = "link_pago"  # <-- nuevo método de pago para link de pago, se acepta ambos nombres por compatibilidad
    GIFTCARD = "giftcard"
    ADDI = "addi"
    ABONOS = "abonos"
    ABONO_TRANSFERENCIA = "abono_transferencia"   # ← nuevo
    OTROS = "otros"
    DESCUENTO_POR_NOMINA = "descuento_por_nomina"
    DESCUENTO_NOMINA = "descuento_nomina"

class EstadoCierre(str, Enum):
    ABIERTO = "abierto"
    CERRADO = "cerrado"
    REVISADO = "revisado"
    APROBADO = "aprobado"

class Moneda(str, Enum):
    USD = "USD"
    COP = "COP"
    EUR = "EUR"
    MXN = "MXN"

# ============================================================
# REQUEST MODELS
# ============================================================

class AperturaCajaRequest(BaseModel):
    sede_id: str = Field(..., description="ID de la sede")
    efectivo_inicial: float = Field(..., ge=0, description="Efectivo inicial en caja")
    fecha: str = Field(..., description="Fecha de apertura (DD-MM-YYYY)")
    moneda: Moneda = Field(default=Moneda.COP)
    observaciones: Optional[str] = None
    
    @validator('fecha')
    def transformar_fecha(cls, v):
        # Definimos los formatos que queremos soportar
        formatos = ["%d-%m-%Y", "%Y-%m-%d"]
    
        for formato in formatos:
            try:
                # Si logra parsearlo con el formato actual, lo devuelve como YYYY-MM-DD
                return datetime.strptime(v, formato).strftime("%Y-%m-%d")
            except ValueError:
                # Si falla, salta al siguiente formato de la lista
                continue
            
        # Si llega aquí es porque no cumplió con ninguno de los dos
        raise ValueError("Formato de fecha inválido. Use DD-MM-YYYY o YYYY-MM-DD")

class RegistroEgresoRequest(BaseModel):
    sede_id: str = Field(..., description="ID de la sede")
    tipo: TipoEgreso = Field(..., description="Tipo de egreso")
    monto: float = Field(..., gt=0, description="Monto del egreso")
    concepto: str = Field(..., min_length=3, max_length=200, description="Concepto del gasto")
    descripcion: Optional[str] = Field(None, max_length=1000, description="Descripción detallada")
    fecha: Optional[str] = Field(None, description="Fecha del egreso (default: hoy)")
    moneda: Moneda = Field(default=Moneda.COP)
    metodo_pago: MetodoPagoIngreso = Field(default=MetodoPagoIngreso.EFECTIVO, description="Método de pago del egreso")  # ← NUEVO
    comprobante_numero: Optional[str] = None
    comprobante_tipo: Optional[str] = None
    categoria: Optional[str] = None

class RegistroIngresoRequest(BaseModel):
    sede_id: str = Field(..., description="ID de la sede")
    monto: float = Field(..., gt=0, description="Monto del ingreso")
    metodo_pago: MetodoPagoIngreso = Field(..., description="Método de pago del ingreso")
    motivo: str = Field(..., min_length=3, max_length=200, description="Motivo del ingreso")
    fecha: Optional[str] = Field(None, description="Fecha del ingreso (default: hoy)")
    moneda: Moneda = Field(default=Moneda.COP)
    registrado_por: Optional[str] = Field(None, description="Usuario que registra (opcional)")

    @validator('fecha')
    def validar_y_formatear(cls, v):
        if not v:
            return date.today().strftime("%Y-%m-%d") # Default hoy si no viene
        try:
            # Convierte de DD-MM-YYYY a objeto fecha y luego a string ISO
            return datetime.strptime(v, "%d-%m-%Y").date().isoformat()
        except ValueError:
            raise ValueError("Formato inválido. Usa DD-MM-YYYY")

class DesgloseFisicoItem(BaseModel):
    denominacion: str = Field(..., description="Ej: 'billete_100', 'moneda_0.25'")
    cantidad: int = Field(..., ge=0)
    valor_unitario: float = Field(..., gt=0)
    subtotal: float = Field(..., ge=0)

class CierreCajaRequest(BaseModel):
    sede_id: str = Field(..., description="ID de la sede")
    fecha: str = Field(..., description="Fecha del cierre (DD-MM-YYYY)")
    efectivo_contado: float = Field(..., ge=0, description="Efectivo físico contado")
    desglose_fisico: Optional[List[DesgloseFisicoItem]] = None
    observaciones: Optional[str] = None
    moneda: Moneda = Field(default=Moneda.COP)

class ConsultaEfectivoRequest(BaseModel):
    sede_id: str
    fecha_inicio: Optional[str] = None
    fecha_fin: Optional[str] = None
    
    @validator('fecha_inicio', 'fecha_fin')
    def validar_fecha(cls, v):
        if v is None:
            return v
        try:
            datetime.strptime(v, "%d-%m-%Y")
            return v
        except ValueError:
            raise ValueError("Formato de fecha inválido. Use DD-MM-YYYY")

# ============================================================
# RESPONSE MODELS
# ============================================================

class DetalleIngresos(BaseModel):
    citas: Dict[str, float] = Field(default={"total": 0, "cantidad": 0})
    ventas: Dict[str, float] = Field(default={"total": 0, "cantidad": 0})
    productos_citas: Dict[str, float] = Field(default={"total": 0, "cantidad": 0})
    total: float = 0

class DetalleEgresos(BaseModel):
    compras_internas: Dict[str, float] = Field(default={"total": 0, "cantidad": 0})
    gastos_operativos: Dict[str, float] = Field(default={"total": 0, "cantidad": 0})
    retiros_caja: Dict[str, float] = Field(default={"total": 0, "cantidad": 0})
    otros: Dict[str, float] = Field(default={"total": 0, "cantidad": 0})
    total: float = 0

class ResumenEfectivoResponse(BaseModel):
    sede_id: str
    sede_nombre: Optional[str] = None
    fecha: str
    moneda: str
    efectivo_inicial: float = 0
    ingresos: DetalleIngresos
    egresos: DetalleEgresos
    efectivo_esperado: float
    efectivo_contado: Optional[float] = None
    diferencia: Optional[float] = None
    estado: Optional[str] = None

class EgresoResponse(BaseModel):
    egreso_id: str
    sede_id: str
    sede_nombre: Optional[str] = None
    tipo: str
    concepto: str
    descripcion: Optional[str]
    monto: float
    moneda: str
    metodo_pago: str
    fecha: str
    registrado_por: str
    registrado_por_nombre: Optional[str]
    comprobante_numero: Optional[str]
    creado_en: datetime

class IngresoResponse(BaseModel):
    ingreso_id: str
    sede_id: str
    sede_nombre: Optional[str] = None
    monto: float
    metodo_pago: str
    motivo: str
    moneda: str
    fecha: str
    registrado_por: str
    registrado_por_nombre: Optional[str]
    creado_en: datetime

class CierreResponse(BaseModel):
    cierre_id: str
    sede_id: str
    sede_nombre: Optional[str]
    fecha: str
    moneda: str
    efectivo_inicial: float
    total_ingresos: float
    total_egresos: float
    efectivo_esperado: float
    efectivo_contado: float
    diferencia: float
    estado: str
    observaciones: Optional[str]
    cerrado_por: str
    cerrado_por_nombre: Optional[str]
    creado_en: datetime
    aprobado_por: Optional[str] = None
    aprobado_en: Optional[datetime] = None

# ============================================================
# INTERNAL MODELS (para cálculos)
# ============================================================

class TransaccionCita(BaseModel):
    cita_id: str
    cliente_nombre: str
    servicios: List[str]
    monto: float
    metodo_pago: str
    fecha: str
    hora: str

class TransaccionVenta(BaseModel):
    venta_id: str
    cliente_nombre: str
    productos: List[str]
    monto: float
    metodo_pago: str
    fecha: datetime

# ============================================================
# EDITION MODELS
# ============================================================

class EditarEgresoRequest(BaseModel):
    concepto:           Optional[str]   = None
    descripcion:        Optional[str]   = None
    monto:              Optional[float] = None
    tipo:               Optional[str]   = None
    categoria:          Optional[str]   = None
    metodo_pago:        Optional[str]   = None
    comprobante_numero: Optional[str]   = None
    comprobante_tipo:   Optional[str]   = None
    motivo_edicion:     Optional[str]   = None          # explica por qué se edita


class EditarIngresoRequest(BaseModel):
    monto:          Optional[float] = None
    metodo_pago:    Optional[str]   = None
    motivo:         Optional[str]   = None  # campo del ingreso
    moneda:         Optional[str]   = None
    motivo_edicion: Optional[str]   = None                   # auditoría, siempre requerido


