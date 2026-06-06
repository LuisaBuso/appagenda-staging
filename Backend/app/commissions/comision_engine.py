# app/commissions/comision_engine.py
from __future__ import annotations
from typing import Literal, Optional, Any
from datetime import date, datetime, timedelta
from pydantic import BaseModel, Field, model_validator
from bson import ObjectId
from dataclasses import dataclass


# ══════════════════════════════════════════════════════════════
# PERÍODO — config guardada en collection_locales
# ══════════════════════════════════════════════════════════════

class PeriodoConfig(BaseModel):
    """
    Define cómo se corta el período de acumulación de ventas.
    Se guarda en sede["comision_periodo_config"].

    Ejemplos:
      {"tipo": "dia_fijo", "dia_inicio": 6}
        → del 6 de cada mes al 5 del siguiente

      {"tipo": "quincenal"}
        → 1-15 y 16-fin de mes

      {"tipo": "mensual"}
        → del 1 al último día del mes
    """
    tipo: Literal["dia_fijo", "quincenal", "mensual"] = "mensual"
    dia_inicio: int = 1   # solo para tipo="dia_fijo"


def get_periodo_actual(config: PeriodoConfig, hoy: date) -> tuple[date, date]:

    if config.tipo == "mensual":
        inicio = hoy.replace(day=1)
        if hoy.month == 12:
            fin = hoy.replace(day=31)
        else:
            fin = hoy.replace(month=hoy.month + 1, day=1) - timedelta(days=1)
        return inicio, fin

    if config.tipo == "quincenal":
        if hoy.day <= 15:
            return hoy.replace(day=1), hoy.replace(day=15)
        else:
            if hoy.month == 12:
                fin = hoy.replace(day=31)
            else:
                fin = hoy.replace(month=hoy.month + 1, day=1) - timedelta(days=1)
            return hoy.replace(day=16), fin

    if config.tipo == "dia_fijo":
        d = config.dia_inicio

        # ── fin = primer día del mes siguiente al d, menos 1 día ──
        # Esto resuelve d=1 (fin=último día del mes) y cualquier otro d
        def _primer_dia_mes_siguiente(año: int, mes: int) -> date:
            if mes == 12:
                return date(año + 1, 1, 1)
            return date(año, mes + 1, 1)

        if hoy.day >= d:
            inicio = hoy.replace(day=d)
            fin = _primer_dia_mes_siguiente(hoy.year, hoy.month) + timedelta(days=d - 2)
            # ej: d=6 → fin = 1ro mes siguiente + 4 días = día 5 mes siguiente ✓
            # ej: d=1 → fin = 1ro mes siguiente + (-1) día = último día mes actual ✓
        else:
            mes_ant = hoy.month - 1 if hoy.month > 1 else 12
            año_ant = hoy.year if hoy.month > 1 else hoy.year - 1
            inicio = date(año_ant, mes_ant, d)
            fin = hoy.replace(day=d) - timedelta(days=1)
            # ej: d=6, hoy=3 abril → inicio=6 marzo, fin=5 abril ✓
            # ej: d=1, hoy nunca entra aquí porque hoy.day >= 1 siempre

        return inicio, fin

    return hoy.replace(day=1), hoy


# ══════════════════════════════════════════════════════════════
# SCHEMA — ComisionConfig con discriminated union
# ══════════════════════════════════════════════════════════════

class ComisionPorcentaje(BaseModel):
    tipo: Literal["porcentaje"] = "porcentaje"
    valor: float = Field(..., ge=0, le=100, description="Porcentaje 0-100")


class ComisionFijo(BaseModel):
    tipo: Literal["fijo"] = "fijo"
    valor: float = Field(..., ge=0, description="Monto fijo de comisión")
    moneda: str = "COP"


class Tramo(BaseModel):
    """Un nivel dentro de una comisión escalonada por cantidad."""
    desde: int   = Field(..., ge=0, description="Unidades mínimas del tramo (inclusive)")
    hasta: Optional[int] = Field(None, description="Unidades máximas (None = sin techo)")
    tipo:  Literal["porcentaje", "fijo"]
    valor: float = Field(..., ge=0)

    @model_validator(mode="after")
    def hasta_mayor_que_desde(self) -> "Tramo":
        if self.hasta is not None and self.hasta <= self.desde:
            raise ValueError("hasta debe ser mayor que desde")
        return self


class ComisionEscalonado(BaseModel):
    """
    Comisión escalonada basada en cantidad de unidades vendidas en el período.
    El nivel se determina por el acumulado del vendedor, no por el subtotal.

    Ejemplo del enunciado:
      tramos = [
        {"desde": 1,  "hasta": 5,  "tipo": "porcentaje", "valor": 2},
        {"desde": 6,  "hasta": 10, "tipo": "porcentaje", "valor": 3},
        {"desde": 11, "hasta": 20, "tipo": "porcentaje", "valor": 4},
        {"desde": 21, "hasta": null,"tipo": "porcentaje", "valor": 5},
      ]
    """
    tipo: Literal["escalonado"] = "escalonado"
    tramos: list[Tramo] = Field(..., min_length=1)

    @model_validator(mode="after")
    def tramos_sin_gaps(self) -> "ComisionEscalonado":
        ordenados = sorted(self.tramos, key=lambda t: t.desde)
        for i, tramo in enumerate(ordenados[:-1]):
            siguiente = ordenados[i + 1]
            if tramo.hasta is None:
                raise ValueError("Solo el último tramo puede tener hasta=None")
            if tramo.hasta + 1 != siguiente.desde:
                raise ValueError(
                    f"Gap entre tramos: {tramo.hasta} → {siguiente.desde}"
                )
        return self


class ComisionPorUnidad(BaseModel):
    """
    Monto fijo por cada unidad vendida, independiente del precio.
    Ej: 2000 COP por cada unidad vendida.
    """
    tipo: Literal["por_unidad"] = "por_unidad"
    valor: float = Field(..., ge=0, description="Monto fijo por unidad")
    moneda: str = "COP"


# Union discriminada — Pydantic elige el modelo correcto por el campo "tipo"
from typing import Annotated, Union
ComisionConfig = Annotated[
    Union[
        ComisionPorcentaje,
        ComisionFijo,
        ComisionEscalonado,
        ComisionPorUnidad,
        # → agregar nuevos tipos aquí, el resto no cambia
    ],
    Field(discriminator="tipo")
]


# ══════════════════════════════════════════════════════════════
# CONTEXTO — datos async pre-cargados antes de calcular
# ══════════════════════════════════════════════════════════════

class ComisionContexto(BaseModel):
    """
    Datos que requieren consulta async a MongoDB.
    Se construye ANTES de llamar a calcular_comision() para que
    la función de cálculo permanezca pura y testeable.
    """
    cantidad_actual: int = 1              # unidades de esta transacción
    cantidad_acumulada_periodo: int = 0   # unidades ya vendidas en el período
    moneda_sede: str = "COP"


# ══════════════════════════════════════════════════════════════
# FUNCIÓN PURA — calcular_comision
# ══════════════════════════════════════════════════════════════

@dataclass
class ResultadoComision:
    valor: float
    hubo_cambio_nivel: bool = False
    nivel_nuevo: Tramo | None = None


def obtener_tramo_escalonado(config: ComisionEscalonado, cantidad_total: int) -> Tramo | None:
    tramos = sorted(config.tramos, key=lambda t: t.desde)
    return next(
        (
            t for t in tramos
            if cantidad_total >= t.desde and (t.hasta is None or cantidad_total <= t.hasta)
        ),
        None
    )


def calcular_valor_comision_item(
    *,
    tipo: str,
    valor: float,
    subtotal: float,
    cantidad: int = 1,
) -> float:
    if tipo == "porcentaje":
        return round((float(subtotal) * float(valor)) / 100, 2)
    if tipo in ("por_unidad", "fijo"):
        return round(float(valor) * max(int(cantidad or 1), 1), 2)
    return 0.0


def calcular_comision(
    config: ComisionPorcentaje | ComisionFijo | ComisionEscalonado | ComisionPorUnidad,
    subtotal: float,
    ctx: ComisionContexto,
) -> ResultadoComision:
    """
    Función pura. Siempre retorna ResultadoComision.
    hubo_cambio_nivel=True solo en escalonado cuando el vendedor sube de nivel.
    """
    if config.tipo == "porcentaje":
        return ResultadoComision(
            valor=round((subtotal * config.valor) / 100, 2)
        )

    elif config.tipo == "fijo":
        return ResultadoComision(
            valor=calcular_valor_comision_item(
                tipo=config.tipo,
                valor=config.valor,
                subtotal=subtotal,
                cantidad=ctx.cantidad_actual,
            )
        )

    elif config.tipo == "por_unidad":
        return ResultadoComision(
            valor=round(config.valor * ctx.cantidad_actual, 2)
        )

    elif config.tipo == "escalonado":
        total_antes   = ctx.cantidad_acumulada_periodo
        total_despues = ctx.cantidad_acumulada_periodo + ctx.cantidad_actual
        nivel_antes = obtener_tramo_escalonado(config, total_antes)
        nivel_despues = obtener_tramo_escalonado(config, total_despues)

        if nivel_despues is None:
            return ResultadoComision(valor=0.0)

        valor = calcular_valor_comision_item(
            tipo=nivel_despues.tipo,
            valor=nivel_despues.valor,
            subtotal=subtotal,
            cantidad=ctx.cantidad_actual,
        )

        hubo_cambio = (
            nivel_antes is None or nivel_antes.valor != nivel_despues.valor
        )

        return ResultadoComision(
            valor=valor,
            hubo_cambio_nivel=hubo_cambio,
            nivel_nuevo=nivel_despues if hubo_cambio else None
        )

    return ResultadoComision(valor=0.0)

# ══════════════════════════════════════════════════════════════
# HELPERS — compatibilidad legacy
# ══════════════════════════════════════════════════════════════

def config_desde_dict(raw: dict | None) -> ComisionPorcentaje | ComisionFijo | ComisionEscalonado | ComisionPorUnidad | None:
    if not raw or not isinstance(raw, dict):
        return None
    try:
        tipo = raw.get("tipo", "porcentaje")
        if tipo == "porcentaje":
            return ComisionPorcentaje(**raw)
        elif tipo == "fijo":
            return ComisionFijo(**raw)
        elif tipo == "escalonado":
            return ComisionEscalonado(**raw)
        elif tipo == "por_unidad":
            return ComisionPorUnidad(**raw)
    except Exception:
        return None


def config_desde_legacy_float(valor: float | None) -> ComisionPorcentaje | None:
    """Convierte el campo legacy `comision: float` — permite migración gradual."""
    if valor is None:
        return None
    try:
        v = float(valor)
    except (TypeError, ValueError):
        return None
    return ComisionPorcentaje(tipo="porcentaje", valor=v) if v > 0 else None


def resolver_config_comision(
    producto_db: dict,
    vendedor_doc: dict | None = None,
    inventario_db: dict | None = None,
    sede_doc: dict | None = None,
):
    # ── BLOQUE 1: configs explícitas nuevas (comision_config) ──────
    # Solo ganan si fueron configuradas intencionalmente con el nuevo engine

    if vendedor_doc:
        c = config_desde_dict(vendedor_doc.get("comision_config"))
        if c: return c

    if inventario_db:
        c = config_desde_dict(inventario_db.get("comision_config"))
        if c: return c

    if producto_db:
        c = config_desde_dict(producto_db.get("comision_config"))
        if c: return c

    if sede_doc:
        c = config_desde_dict(sede_doc.get("comision_config_sede"))
        if c: return c

    # ── BLOQUE 2: legacy floats — último recurso ────────────────────
    # Solo aplican si NINGÚN nivel tiene config explícita nueva.
    # Evita que un campo viejo comision_productos: 45 le gane al
    # escalonado configurado en la sede.

    if vendedor_doc:
        c = config_desde_legacy_float(vendedor_doc.get("comision_productos"))
        if c: return c

    if inventario_db:
        c = config_desde_legacy_float(inventario_db.get("comision"))
        if c: return c

    c = config_desde_legacy_float(producto_db.get("comision"))
    if c: return c

    return ComisionPorcentaje(tipo="porcentaje", valor=0)
