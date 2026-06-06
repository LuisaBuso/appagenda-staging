from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

# ==============================================================
# Modelo de detalle de servicio dentro de la comisión
# ⭐ ACTUALIZADO: Separa comisiones de servicios y productos
# ==============================================================
class ServicioDetalle(BaseModel):
    servicio_id: str
    servicio_nombre: str
    valor_servicio: float
    porcentaje: float
    valor_comision_servicio: float  # ⭐ Comisión del servicio
    valor_comision_productos: float = 0  # ⭐ Comisión de productos vendidos
    valor_comision_total: float  # ⭐ Total (servicio + productos)
    fecha: str
    numero_comprobante: Optional[str] = None
    tipo_comision_sede: str = "servicios"  # ⭐ "servicios" | "productos" | "mixto"

# ==============================================================
# Modelo de comisión completa (estructura en DB)
# ==============================================================
class Comision(BaseModel):
    profesional_id: str
    profesional_nombre: str
    sede_id: str
    moneda: str  # ⭐ Sin default, debe venir de la sede
    tipo_comision: str = "servicios"  # ⭐ NUEVO: Tipo de comisión de la sede
    total_servicios: int
    total_comisiones: float
    servicios_detalle: List[ServicioDetalle]
    productos_detalle: List[dict] = Field(default_factory=list)
    creado_en: datetime
    periodo_inicio: str
    periodo_fin: str
    estado: str = "pendiente"
    liquidada_por: Optional[str] = None
    liquidada_en: Optional[datetime] = None

# ==============================================================
# Modelo para liquidar comisiones
# ==============================================================
class LiquidarComisionRequest(BaseModel):
    comision_id: str
    notas: Optional[str] = None

# ==============================================================
# Modelo de respuesta para listado de comisiones
# ==============================================================
class ComisionResponse(BaseModel):
    id: str
    profesional_id: str
    profesional_nombre: str

    sede_id: str
    sede_nombre: str  # ⭐ NUEVO

    moneda: Optional[str] = None
    tipo_comision: Optional[str] = "servicios"
    total_servicios: int
    total_comisiones: float
    periodo_inicio: str
    periodo_fin: str
    estado: str
    creado_en: datetime
    liquidada_por: Optional[str] = None
    liquidada_en: Optional[datetime] = None

# ==============================================================
# Modelo de respuesta detallada (incluye servicios)
# ==============================================================
class ComisionDetalleResponse(BaseModel):
    id: str
    profesional_id: str
    profesional_nombre: str
    sede_id: str
    moneda: Optional[str] = None  # ⭐ Opcional para comisiones viejas
    tipo_comision: Optional[str] = "servicios"  # ⭐ NUEVO
    total_servicios: int
    total_comisiones: float
    total_comisiones_servicios: float = 0  # ⭐ NUEVO: Total solo de servicios
    total_comisiones_productos: float = 0  # ⭐ NUEVO: Total solo de productos
    servicios_detalle: List[ServicioDetalle]
    productos_detalle: List[dict] = Field(default_factory=list)
    periodo_inicio: str
    periodo_fin: str
    estado: str
    creado_en: datetime
    liquidada_por: Optional[str] = None
    liquidada_en: Optional[datetime] = None

# ==============================================================
# Filtros para búsqueda de comisiones
# ==============================================================
class FiltrosComision(BaseModel):
    profesional_id: Optional[str] = None
    sede_id: Optional[str] = None
    estado: Optional[str] = None
    periodo_inicio: Optional[str] = None
    periodo_fin: Optional[str] = None
    tipo_comision: Optional[str] = None  # ⭐ NUEVO: Filtrar por tipo

# ==============================================================
# ⭐ NUEVO: Modelo para resumen de comisiones por tipo
# ==============================================================
class ResumenComisionPorTipo(BaseModel):
    """Resumen de comisiones desglosadas por tipo"""
    profesional_id: str
    profesional_nombre: str
    sede_id: str
    moneda: str
    tipo_comision_sede: str
    
    # Totales generales
    total_servicios: int
    total_comisiones: float
    
    # Desglose por tipo
    comisiones_por_servicios: float
    comisiones_por_productos: float
    
    # Porcentajes
    porcentaje_servicios: float
    porcentaje_productos: float
    
    estado: str
    periodo_inicio: str
    periodo_fin: str
