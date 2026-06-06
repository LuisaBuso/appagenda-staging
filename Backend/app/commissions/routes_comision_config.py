# app/commissions/routes_comision_config.py
from fastapi import APIRouter, HTTPException, Depends
from typing import Annotated, Union
from pydantic import BaseModel, Field
from app.auth.routes import get_current_user
from app.commissions.comision_engine import (
    ComisionPorcentaje, ComisionFijo, ComisionEscalonado, ComisionPorUnidad,
    PeriodoConfig
)
from app.database.mongo import collection_locales, collection_inventarios

router = APIRouter(prefix="/config/comision", tags=["Configuración de comisiones"])

# El mismo union discriminado — FastAPI lo convierte en schema OpenAPI
# con oneOf, lo que muchos frontends (Swagger, Redoc) muestran como selector
ComisionConfigInput = Annotated[
    Union[ComisionPorcentaje, ComisionFijo, ComisionEscalonado, ComisionPorUnidad],
    Field(discriminator="tipo")
]

class ConfigComisionSedeRequest(BaseModel):
    comision_config: ComisionConfigInput
    periodo_config: PeriodoConfig | None = None   # si se quiere actualizar también el período


@router.put("/sede/{sede_id}")
async def configurar_comision_sede(
    sede_id: str,
    body: ConfigComisionSedeRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Configura la comisión por defecto de una sede.
    El campo `tipo` determina qué parámetros son válidos:
      - porcentaje  → { tipo, valor }
      - fijo        → { tipo, valor, moneda }
      - escalonado  → { tipo, tramos: [{desde, hasta, tipo, valor}] }
      - por_unidad  → { tipo, valor, moneda }
    """
    if current_user["rol"] != "super_admin":
        raise HTTPException(status_code=403, detail="Solo super_admin")

    update = {"comision_config_sede": body.comision_config.model_dump()}
    if body.periodo_config:
        update["comision_periodo_config"] = body.periodo_config.model_dump()

    result = await collection_locales.update_one(
        {"sede_id": sede_id},
        {"$set": update}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    return {"success": True, "config_aplicada": body.comision_config.model_dump()}


@router.put("/inventario/{sede_id}/{producto_id}")
async def configurar_comision_inventario(
    sede_id: str,
    producto_id: str,
    config: ComisionConfigInput,
    current_user: dict = Depends(get_current_user)
):
    """Override de comisión para un producto específico en una sede."""
    if current_user["rol"] not in ["super_admin", "admin_sede"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    result = await collection_inventarios.update_one(
        {"sede_id": sede_id, "producto_id": producto_id},
        {"$set": {"comision_config": config.model_dump()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Inventario no encontrado")

    return {"success": True, "config_aplicada": config.model_dump()}