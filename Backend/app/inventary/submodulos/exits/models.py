from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime


class ItemSalida(BaseModel):
    producto_id: str
    cantidad: int  # positivo; el backend lo convierte a descuento


class Salida(BaseModel):
    motivo: str  # "Venta" | "Uso interno" | "Obsequio" | "Muestra" | "Pérdida" | "Ajuste manual"
    sede_id: Optional[str] = None
    items: List[ItemSalida]
    observaciones: Optional[str] = None
    fecha_creacion: Optional[datetime] = None
