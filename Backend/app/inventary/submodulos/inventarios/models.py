from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class Inventario(BaseModel):
    producto_id: str = Field(..., description="ID del producto del catálogo maestro")
    sede_id: str = Field(..., description="ID de la sede (ej: SD-88809)")
    stock_actual: int = Field(default=0, ge=0, description="Stock actual en esta sede")
    stock_minimo: int = Field(default=5, ge=0, description="Stock mínimo para alertas")
    fecha_creacion: Optional[datetime] = None
    fecha_ultima_actualizacion: Optional[datetime] = None
    creado_por: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {
                "producto_id": "P001",
                "sede_id": "SD-88809",
                "stock_actual": 50,
                "stock_minimo": 10
            }
        }


class AjusteInventario(BaseModel):
    """
    Ajuste manual de stock.
    - cantidad_ajuste positivo → entrada
    - cantidad_ajuste negativo → salida
    - motivo es opcional; si se omite se trata como ajuste rápido
    """
    cantidad_ajuste: int = Field(..., description="Cantidad a sumar (+) o restar (-)")
    motivo: Optional[str] = Field(
        None,
        description="Razón del ajuste: 'Compra', 'Pérdida', 'Corrección', etc."
    )
    observaciones: Optional[str] = Field(None, description="Notas adicionales opcionales")