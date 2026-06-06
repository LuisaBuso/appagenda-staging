from typing import List, Dict
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class ItemPedido(BaseModel):
    nombre: str
    producto_id: str
    cantidad: int

class Pedido(BaseModel):
    proveedor: Optional[str] = None
    sede_id: Optional[str] = None
    items: List[ItemPedido]
    estado: str = "pendiente"  # pendiente | recibido | cancelado
    fecha_creacion: Optional[datetime] = None
