from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class ItemEntrada(BaseModel):
    producto_id: str
    cantidad: int  # siempre positivo


class Entrada(BaseModel):
    motivo: str  # "Compra a proveedor" | "Ajuste manual" | "Devolución cliente" | "Transferencia" | "Stock inicial"
    sede_id: Optional[str] = None
    items: List[ItemEntrada]
    observaciones: Optional[str] = None
    fecha_creacion: Optional[datetime] = None