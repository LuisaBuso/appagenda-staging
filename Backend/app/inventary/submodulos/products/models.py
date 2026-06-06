from pydantic import BaseModel, Field
from typing import Optional, Dict
from datetime import datetime

class Producto(BaseModel):
    nombre: str = Field(..., description="Nombre del producto")
    codigo: Optional[str] = Field(None, description="Código del producto")
    descripcion: Optional[str] = Field(None, description="Descripción del producto")
    categoria: Optional[str] = Field(None, description="Categoría del producto")
    comision: Optional[float] = None # Porcentaje de comisión para el producto
    
    # Precios en diferentes monedas (escalable)
    precios: Dict[str, float] = Field(
        ...,
        description="Precios en diferentes monedas: {'COP': 250000, 'USD': 62.50, 'MXN': 1125.00}",
        example={"COP": 250000, "USD": 62.50, "MXN": 1125.00}
    )
    
    stock_actual: int = Field(default=0, ge=0, description="Stock actual")
    stock_minimo: int = Field(default=5, ge=0, description="Stock mínimo")
    sede_id: Optional[str] = Field(None, description="ID de la sede")
    franquicia_id: Optional[str] = Field(None, description="ID de la franquicia")
    fecha_creacion: Optional[datetime] = Field(None, description="Fecha de creación")
    
    class Config:
        json_schema_extra = {
            "example": {
                "nombre": "SHAMPOO MEN SALON",
                "codigo": "1050",
                "descripcion": "Shampoo profesional para hombres",
                "categoria": "USO SALON",
                "comision": 5,
                "precios": {
                    "COP": 250000,
                    "USD": 62.50,
                    "MXN": 1125.00
                },
                "stock_actual": 50,
                "stock_minimo": 5
            }
        }