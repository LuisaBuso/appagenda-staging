# ============================================================
# routes_cash.py - REFACTORIZADO CON LÓGICA CONTABLE CORRECTA
# Ubicación: app/cash/routes_cash.py
# ============================================================

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import logging

# Importar lógica contable separada
from .accounting_logic import (
    calcular_resumen_dia,
    obtener_ventas_dia,        # ← NUEVO
    obtener_egresos_dia,          # ← NUEVO
    obtener_movimientos_efectivo_dia  # ← NUEVO
)

# Importar generador de Excel
from .excel_generator import generar_reporte_excel_caja_completo, generar_nombre_archivo_excel

# Importar modelos y utilidades
from .models_cash import (
    AperturaCajaRequest, RegistroEgresoRequest, RegistroIngresoRequest, CierreCajaRequest,
    EgresoResponse, IngresoResponse, CierreResponse, EditarEgresoRequest, EditarIngresoRequest
)
from .utils_cash import (
    generar_cierre_id, generar_egreso_id, generar_ingreso_id, generar_apertura_id,
    calcular_diferencia, validar_diferencia_aceptable,
    construir_filtro_fecha, convertir_mongo_a_json, normalizar_fecha
)

# Importar autenticación
from app.auth.routes import get_current_user

# Importar colecciones
from app.database.mongo import (
    db,
    collection_locales as locales
)

router = APIRouter(prefix="/cash", tags=["Cash Management"])
logger = logging.getLogger(__name__)

# Colecciones
cash_expenses = db["cash_expenses"]
cash_closures = db["cash_closures"]
cash_incomes = db["cash_ingresos"]

# ============================================================
# HELPERS COMPARTIDOS PARA EDICIÓN/ELIMINACIÓN
# ============================================================

async def _validar_dia_no_cerrado(sede_id: str, fecha: str) -> None:
    """Lanza 409 si el día ya tiene cierre registrado."""
    cierre = await cash_closures.find_one({
        "sede_id": sede_id,
        "fecha": fecha,
        "tipo": "cierre"
    })
    if cierre:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La caja del {fecha} ya está cerrada. No se pueden modificar registros de un día cerrado."
        )


def _validar_rol_admin(current_user: dict) -> None:
    """Solo admin_sede y super_admin pueden editar registros de caja."""
    if current_user.get("rol") not in ["admin_sede", "super_admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores pueden editar o eliminar registros de caja."
        )


def _campos_auditoria(current_user: dict, motivo: Optional[str] = None) -> dict:
    """Genera el bloque de auditoría estándar para ediciones."""
    return {
        "editado_por": current_user.get("email"),
        "editado_por_nombre": current_user.get("nombre"),
        "editado_por_rol": current_user.get("rol"),
        "editado_en": datetime.now(),
        **({"motivo_edicion": motivo} if motivo else {})
    }


# ============================================================
# 1. CALCULAR EFECTIVO DEL DÍA (REFACTORIZADO ✅)
# ============================================================

@router.get("/efectivo-dia")
async def calcular_efectivo_dia_endpoint(
    sede_id: str = Query(..., description="ID de la sede"),
    fecha: Optional[str] = Query(None, description="Fecha (YYYY-MM-DD), default: hoy"),
    current_user: dict = Depends(get_current_user)
):
    """
    Calcula el efectivo del día con criterio contable correcto.
    
    ✅ CRITERIO CONTABLE:
    - Solo suma pagos con metodo == "efectivo" del historial_pagos
    - NO suma valor_total completo
    - NO duplica productos (ya están en historial_pagos)
    - Discrimina ingresos por método de pago
    
    Returns:
        {
            "sede_id": "SD-88809",
            "fecha": "2026-02-09",
            "efectivo_inicial": 100000,
            "ingresos_efectivo": {
                "citas": 127400,
                "ventas": 77400,
                "total": 204800
            },
            "ingresos_otros_metodos": {
                "tarjeta": 185000,
                "transferencia": 0,
                "total": 185000
            },
            "egresos": {...},
            "efectivo_esperado": 304800,
            "total_vendido": 389800
        }
    """
    
    if not fecha:
        fecha = datetime.now().strftime("%d-%m-%Y")

    fecha = normalizar_fecha(fecha)
    
    # Usar lógica contable separada
    resumen = await calcular_resumen_dia(sede_id, fecha)
    
    # Verificar si hay cierre
    cierre = await cash_closures.find_one({
        "sede_id": sede_id,
        "fecha": fecha,
        "tipo": "cierre"
    })
    
    if cierre:
        resumen["efectivo_contado"] = cierre.get("efectivo_contado")
        resumen["diferencia"] = cierre.get("diferencia")
        resumen["estado"] = cierre.get("estado")
    
    return resumen


def _parse_date(value: str, field_name: str) -> datetime:
    try:
        return datetime.strptime(normalizar_fecha(value), "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"'{field_name}' debe tener formato DD-MM-YYYY o YYYY-MM-DD"
        ) from exc

def _normalize_range(fecha_inicio: str, fecha_fin: str) -> tuple[str, str]:
    inicio_dt = _parse_date(fecha_inicio, "fecha_inicio")
    fin_dt = _parse_date(fecha_fin, "fecha_fin")
    if inicio_dt <= fin_dt:
        return fecha_inicio, fecha_fin
    return fecha_fin, fecha_inicio


def _as_datetime(value: Any, fallback: Optional[datetime] = None) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
    return fallback or datetime.now()


def _as_date_string(value: Any, fallback: Optional[str] = None) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, str) and value.strip():
        return value.strip()[:10]
    return fallback or datetime.now().strftime("%Y-%m-%d")

# ============================================================
# 2. REGISTRAR EGRESO (SIN CAMBIOS)
# ============================================================

@router.post("/egreso", response_model=EgresoResponse, status_code=status.HTTP_201_CREATED)
async def registrar_egreso(
    egreso: RegistroEgresoRequest,
    current_user: dict = Depends(get_current_user)
):
    """Registra un egreso de efectivo."""
    
    fecha = normalizar_fecha(egreso.fecha) if egreso.fecha else datetime.now().strftime("%Y-%m-%d")
    
    sede = await locales.find_one({"sede_id": egreso.sede_id})
    sede_nombre = sede.get("nombre") if sede else None
    
    egreso_doc = {
        "egreso_id": generar_egreso_id(),
        "sede_id": egreso.sede_id,
        "tipo": egreso.tipo.value,
        "concepto": egreso.concepto,
        "descripcion": egreso.descripcion,
        "monto": egreso.monto,
        "moneda": egreso.moneda.value,
        "metodo_pago": egreso.metodo_pago.value,
        "fecha": fecha,
        "registrado_por": current_user["email"],
        "registrado_por_nombre": current_user.get("nombre"),
        "registrado_por_rol": current_user.get("rol"),
        "comprobante_numero": egreso.comprobante_numero,
        "comprobante_tipo": egreso.comprobante_tipo,
        "categoria": egreso.categoria,
        "creado_en": datetime.now(),
        "actualizado_en": datetime.now()
    }
    
    resultado = await cash_expenses.insert_one(egreso_doc)
    
    if not resultado.inserted_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al registrar el egreso"
        )
    
    return EgresoResponse(
        egreso_id=egreso_doc["egreso_id"],
        sede_id=egreso_doc["sede_id"],
        sede_nombre=sede_nombre,
        tipo=egreso_doc["tipo"],
        concepto=egreso_doc["concepto"],
        descripcion=egreso_doc["descripcion"],
        monto=egreso_doc["monto"],
        moneda=egreso_doc["moneda"],
        metodo_pago=egreso_doc["metodo_pago"],
        fecha=egreso_doc["fecha"],
        registrado_por=egreso_doc["registrado_por"],
        registrado_por_nombre=egreso_doc.get("registrado_por_nombre"),
        comprobante_numero=egreso_doc.get("comprobante_numero"),
        creado_en=egreso_doc["creado_en"]
    )

# ============================================================
# EDITAR EGRESO
# ============================================================

@router.patch("/egresos/{egreso_id}", response_model=dict)
async def editar_egreso(
    egreso_id: str,
    cambios: EditarEgresoRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Edita un egreso existente.

    ✅ Restricciones:
    - Solo admin_sede y super_admin
    - No permitido si el día ya tiene cierre registrado
    - Requiere motivo_edicion obligatorio (auditoría)
    - Guarda snapshot del valor anterior en historial_ediciones
    """
    _validar_rol_admin(current_user)

    egreso = await cash_expenses.find_one({"egreso_id": egreso_id})
    if not egreso:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Egreso {egreso_id} no encontrado.")

    await _validar_dia_no_cerrado(egreso["sede_id"], egreso["fecha"])

    # Snapshot del estado anterior para historial
    snapshot_anterior = {
        "monto":              egreso.get("monto"),
        "concepto":           egreso.get("concepto"),
        "descripcion":        egreso.get("descripcion"),
        "tipo":               egreso.get("tipo"),
        "metodo_pago":        egreso.get("metodo_pago"),
        "comprobante_numero": egreso.get("comprobante_numero"),
        "editado_en":         datetime.now().isoformat(),
        "revertido_por":      current_user.get("email"),
        "motivo":             cambios.motivo_edicion,
    }

    # Construir $set solo con los campos enviados
    campos_a_actualizar = {
        k: v for k, v in cambios.dict(exclude={"motivo_edicion"}).items()
        if v is not None
    }

    if not campos_a_actualizar:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se enviaron campos para actualizar."
        )

    campos_a_actualizar.update(_campos_auditoria(current_user, cambios.motivo_edicion))
    campos_a_actualizar["actualizado_en"] = datetime.now()

    await cash_expenses.update_one(
        {"egreso_id": egreso_id},
        {
            "$set": campos_a_actualizar,
            "$push": {"historial_ediciones": snapshot_anterior}  # audit trail
        }
    )

    egreso_actualizado = await cash_expenses.find_one({"egreso_id": egreso_id})

    return {
        "ok": True,
        "mensaje": "Egreso actualizado correctamente.",
        "egreso_id": egreso_id,
        "campos_modificados": list(campos_a_actualizar.keys()),
        "monto_anterior": snapshot_anterior["monto"],
        "monto_nuevo": egreso_actualizado.get("monto"),
    }

# ============================================================
# 3. REGISTRAR INGRESO MANUAL (NUEVO)
# ============================================================

@router.post("/ingreso", response_model=IngresoResponse, status_code=status.HTTP_201_CREATED)
async def registrar_ingreso(
    ingreso: RegistroIngresoRequest,
    current_user: dict = Depends(get_current_user)
):
    """Registra un ingreso manual de caja."""
    fecha = ingreso.fecha or datetime.now().strftime("%Y-%m-%d")

    sede = await locales.find_one({"sede_id": ingreso.sede_id})
    if not sede:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sede {ingreso.sede_id} no encontrada"
        )

    ingreso_doc = {
        "ingreso_id": generar_ingreso_id(),
        "sede_id": ingreso.sede_id,
        "fecha": fecha,
        "monto": ingreso.monto,
        "metodo_pago": ingreso.metodo_pago.value,
        "motivo": ingreso.motivo,
        "moneda": ingreso.moneda.value,
        "registrado_por": current_user.get("user_id") or current_user["email"],
        "registrado_por_nombre": current_user.get("nombre"),
        "registrado_por_email": current_user.get("email"),
        "registrado_por_rol": current_user.get("rol"),
        "creado_en": datetime.now(),
        "actualizado_en": datetime.now(),
    }

    resultado = await cash_incomes.insert_one(ingreso_doc)
    if not resultado.inserted_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al registrar el ingreso"
        )

    return IngresoResponse(
        ingreso_id=ingreso_doc["ingreso_id"],
        sede_id=ingreso_doc["sede_id"],
        sede_nombre=sede.get("nombre"),
        monto=ingreso_doc["monto"],
        metodo_pago=ingreso_doc["metodo_pago"],
        motivo=ingreso_doc["motivo"],
        moneda=ingreso_doc["moneda"],
        fecha=ingreso_doc["fecha"],
        registrado_por=str(ingreso_doc["registrado_por"]),
        registrado_por_nombre=ingreso_doc.get("registrado_por_nombre"),
        creado_en=ingreso_doc["creado_en"],
    )


@router.patch("/ingresos/{ingreso_id}", response_model=dict)
async def editar_ingreso(
    ingreso_id: str,
    cambios: EditarIngresoRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Edita un ingreso manual.

    ✅ Restricciones idénticas a editar egreso.
    """
    _validar_rol_admin(current_user)

    ingreso = await cash_incomes.find_one({"ingreso_id": ingreso_id})
    if not ingreso:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Ingreso {ingreso_id} no encontrado.")

    if ingreso.get("eliminado"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Este ingreso fue eliminado y no puede editarse.")

    await _validar_dia_no_cerrado(ingreso["sede_id"], ingreso["fecha"])

    snapshot_anterior = {
        "monto":       ingreso.get("monto"),
        "metodo_pago": ingreso.get("metodo_pago"),
        "motivo":      ingreso.get("motivo"),
        "editado_en":  datetime.now().isoformat(),
        "editado_por": current_user.get("email"),
        "motivo_edicion": cambios.motivo_edicion,
    }

    campos_a_actualizar = {
        k: v for k, v in cambios.dict(exclude={"motivo_edicion"}).items()
        if v is not None
    }

    if not campos_a_actualizar:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No se enviaron campos para actualizar.")

    campos_a_actualizar.update(_campos_auditoria(current_user, cambios.motivo_edicion))
    campos_a_actualizar["actualizado_en"] = datetime.now()

    await cash_incomes.update_one(
        {"ingreso_id": ingreso_id},
        {
            "$set": campos_a_actualizar,
            "$push": {"historial_ediciones": snapshot_anterior}
        }
    )

    return {
        "ok": True,
        "mensaje": "Ingreso actualizado correctamente.",
        "ingreso_id": ingreso_id,
        "monto_anterior": snapshot_anterior["monto"],
        "monto_nuevo": campos_a_actualizar.get("monto", ingreso.get("monto")),
    }

# ============================================================
# 4. LISTAR INGRESOS MANUALES (NUEVO)
# ============================================================

@router.get("/ingresos", response_model=List[IngresoResponse])
async def listar_ingresos(
    sede_id: str = Query(...),
    fecha_inicio: str = Query(...),
    fecha_fin: str = Query(...),
    current_user: dict = Depends(get_current_user)
):
    """Lista ingresos manuales por rango de fechas."""
    try:
        inicio, fin = _normalize_range(fecha_inicio, fecha_fin)
        filtro = {
            "sede_id": sede_id,
            "fecha": {"$gte": inicio, "$lte": fin},
            "eliminado": {"$ne": True},
        }
        ingresos_list = await cash_incomes.find(filtro).sort("creado_en", -1).to_list(None)

        if not ingresos_list:
            return []

        sede = await locales.find_one({"sede_id": sede_id})
        sede_nombre = sede.get("nombre") if sede else None

        return [
            IngresoResponse(
                ingreso_id=i.get("ingreso_id") or str(i.get("_id")),
                sede_id=i.get("sede_id") or sede_id,
                sede_nombre=sede_nombre,
                monto=float(i.get("monto", 0) or 0),
                metodo_pago=str(i.get("metodo_pago", "otros")),
                motivo=i.get("motivo") or i.get("descripcion") or "Ingreso manual",
                moneda=str(i.get("moneda", "COP")),
                fecha=_as_date_string(i.get("fecha"), inicio),
                registrado_por=str(i.get("registrado_por") or i.get("registrado_por_email") or "sistema"),
                registrado_por_nombre=i.get("registrado_por_nombre"),
                creado_en=_as_datetime(i.get("creado_en"), _as_datetime(i.get("fecha"))),
            )
            for i in ingresos_list
        ]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error listando ingresos manuales")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al listar ingresos: {str(exc)}"
        ) from exc

# ============================================================
# DELETE /cash/ingresos/{ingreso_id}  — Eliminar ingreso manual
# ============================================================

@router.delete("/ingresos/{ingreso_id}", status_code=status.HTTP_200_OK)
async def eliminar_ingreso(
    ingreso_id: str,
    motivo: str = Query(..., description="Motivo obligatorio de eliminación"),
    current_user: dict = Depends(get_current_user)
):
    """Soft delete de un ingreso manual con las mismas reglas que egresos."""
    _validar_rol_admin(current_user)

    ingreso = await cash_incomes.find_one({"ingreso_id": ingreso_id})
    if not ingreso:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Ingreso {ingreso_id} no encontrado.")

    if ingreso.get("eliminado"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Este ingreso ya fue eliminado.")

    await _validar_dia_no_cerrado(ingreso["sede_id"], ingreso["fecha"])

    await cash_incomes.update_one(
        {"ingreso_id": ingreso_id},
        {"$set": {
            "eliminado": True,
            "eliminado_por": current_user.get("email"),
            "eliminado_por_nombre": current_user.get("nombre"),
            "eliminado_en": datetime.now(),
            "motivo_eliminacion": motivo,
            "actualizado_en": datetime.now(),
        }}
    )

    return {
        "ok": True,
        "mensaje": f"Ingreso {ingreso_id} eliminado correctamente.",
        "ingreso_id": ingreso_id,
        "motivo": motivo,
    }

# ============================================================
# 5. LISTAR EGRESOS
# ============================================================

@router.get("/egresos", response_model=List[EgresoResponse])
async def listar_egresos(
    sede_id: str = Query(...),
    fecha_inicio: str = Query(...),
    fecha_fin: str = Query(...),
    tipo: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """Lista los egresos por rango de fechas."""
    try:
        inicio, fin = _normalize_range(fecha_inicio, fecha_fin)
        filtro: Dict[str, Any] = {
            "sede_id": sede_id,
            "fecha": {"$gte": inicio, "$lte": fin},
            "eliminado": {"$ne": True},
            # Excluir documentos de ingreso y flujo migrado de efectivo.
            "$or": [
                {"categoria": {"$exists": False}},
                {"categoria": None},
                {"categoria": {"$in": ["EGRESO", "egreso"]}},
                {"tipo": {"$in": ["compra_interna", "gasto_operativo", "retiro_caja", "otro", "Egresos"]}},
            ],
        }

        if tipo:
            filtro["tipo"] = tipo

        egresos_list = await cash_expenses.find(filtro).sort("creado_en", -1).to_list(None)
        if not egresos_list:
            return []

        sede = await locales.find_one({"sede_id": sede_id})
        sede_nombre = sede.get("nombre") if sede else None

        return [
            EgresoResponse(
                egreso_id=e.get("egreso_id") or str(e.get("_id")),
                sede_id=e.get("sede_id") or sede_id,
                sede_nombre=sede_nombre,
                tipo=e.get("tipo") or "otro",
                concepto=e.get("concepto") or e.get("descripcion") or e.get("motivo") or "Sin concepto",
                descripcion=e.get("descripcion") or e.get("motivo"),
                monto=float(e.get("monto", 0) or 0),
                moneda=str(e.get("moneda", "COP")),
                metodo_pago=str(e.get("metodo_pago", "efectivo")),
                fecha=_as_date_string(e.get("fecha"), inicio),
                registrado_por=str(e.get("registrado_por") or e.get("usuario_modificacion") or "sistema"),
                registrado_por_nombre=e.get("registrado_por_nombre"),
                comprobante_numero=e.get("comprobante_numero") or e.get("nro_comprobante"),
                creado_en=_as_datetime(e.get("creado_en"), _as_datetime(e.get("fecha"))),
            )
            for e in egresos_list
        ]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error listando egresos")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al listar egresos: {str(exc)}"
        ) from exc

# ============================================================
# 4. APERTURA DE CAJA (SIN CAMBIOS)
# ============================================================

@router.post("/apertura", status_code=status.HTTP_201_CREATED)
async def apertura_caja(
    apertura: AperturaCajaRequest,
    current_user: dict = Depends(get_current_user)
):
    """Registra la apertura de caja del día."""
    
    apertura_existente = await cash_closures.find_one({
        "sede_id": apertura.sede_id,
        "fecha": apertura.fecha,
        "tipo": "apertura"
    })
    
    if apertura_existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ya existe una apertura de caja para {apertura.sede_id} el {apertura.fecha}"
        )
    
    sede = await locales.find_one({"sede_id": apertura.sede_id})
    sede_nombre = sede.get("nombre") if sede else None
    
    apertura_doc = {
        "apertura_id": generar_apertura_id(apertura.sede_id, apertura.fecha),
        "tipo": "apertura",
        "sede_id": apertura.sede_id,
        "sede_nombre": sede_nombre,
        "fecha": apertura.fecha,
        "efectivo_inicial": apertura.efectivo_inicial,
        "moneda": apertura.moneda.value,
        "observaciones": apertura.observaciones,
        "abierto_por": current_user["email"],
        "abierto_por_nombre": current_user.get("nombre"),
        "abierto_por_rol": current_user.get("rol"),
        "creado_en": datetime.now()
    }
    
    resultado = await cash_closures.insert_one(apertura_doc)
    
    if not resultado.inserted_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al registrar la apertura de caja"
        )
    
    return {
        "ok": True,
        "mensaje": f"Caja abierta exitosamente para {apertura.sede_id} el {apertura.fecha}",
        "apertura_id": apertura_doc["apertura_id"],
        "efectivo_inicial": apertura_doc["efectivo_inicial"]
    }

# ============================================================
# 5. CERRAR CAJA (REFACTORIZADO ✅)
# ============================================================

@router.post("/cierre", response_model=CierreResponse, status_code=status.HTTP_201_CREATED)
async def cerrar_caja(
    cierre: CierreCajaRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Cierra la caja del día con criterio contable correcto.
    
    ✅ Usa la lógica contable refactorizada
    """
    
    cierre_existente = await cash_closures.find_one({
        "sede_id": cierre.sede_id,
        "fecha": cierre.fecha,
        "tipo": "cierre"
    })
    
    if cierre_existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ya existe un cierre de caja para {cierre.sede_id} el {cierre.fecha}"
        )
    
    # Usar lógica contable refactorizada
    resumen = await calcular_resumen_dia(cierre.sede_id, cierre.fecha)
    
    diferencia = calcular_diferencia(resumen["efectivo_esperado"], cierre.efectivo_contado)
    es_aceptable, mensaje_validacion = validar_diferencia_aceptable(diferencia)
    
    if cierre.desglose_fisico:
        total_desglose = sum(item.subtotal for item in cierre.desglose_fisico)
        if abs(total_desglose - cierre.efectivo_contado) > 0.01:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El desglose físico no coincide con el efectivo contado"
            )
    
    cierre_doc = {
        "cierre_id": generar_cierre_id(cierre.sede_id, cierre.fecha),
        "tipo": "cierre",
        "sede_id": cierre.sede_id,
        "sede_nombre": resumen["sede_nombre"],
        "fecha": cierre.fecha,
        "moneda": cierre.moneda.value,
        "efectivo_inicial": resumen["efectivo_inicial"],
        "total_ingresos": resumen["total_vendido"],
        "total_ingresos_efectivo": resumen["ingresos_efectivo"]["total"],
        "total_egresos": resumen["egresos"]["total"],
        "efectivo_esperado": resumen["efectivo_esperado"],
        "efectivo_contado": cierre.efectivo_contado,
        "diferencia": diferencia,
        "ingresos_detalle": resumen["ingresos_efectivo"],
        "ingresos_otros_metodos": resumen["ingresos_otros_metodos"],
        "egresos_detalle": resumen["egresos"],
        "desglose_fisico": [item.dict() for item in cierre.desglose_fisico] if cierre.desglose_fisico else None,
        "estado": "cerrado",
        "diferencia_aceptable": es_aceptable,
        "mensaje_validacion": mensaje_validacion,
        "observaciones": cierre.observaciones,
        "cerrado_por": current_user["email"],
        "cerrado_por_nombre": current_user.get("nombre"),
        "cerrado_por_rol": current_user.get("rol"),
        "creado_en": datetime.now(),
        "aprobado_por": None,
        "aprobado_en": None
    }
    
    resultado = await cash_closures.insert_one(cierre_doc)
    
    if not resultado.inserted_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al registrar el cierre de caja"
        )
    
    return CierreResponse(
        cierre_id=cierre_doc["cierre_id"],
        sede_id=cierre_doc["sede_id"],
        sede_nombre=cierre_doc["sede_nombre"],
        fecha=cierre_doc["fecha"],
        moneda=cierre_doc["moneda"],
        efectivo_inicial=cierre_doc["efectivo_inicial"],
        total_ingresos=cierre_doc["total_ingresos"],
        total_egresos=cierre_doc["total_egresos"],
        efectivo_esperado=cierre_doc["efectivo_esperado"],
        efectivo_contado=cierre_doc["efectivo_contado"],
        diferencia=cierre_doc["diferencia"],
        estado=cierre_doc["estado"],
        observaciones=cierre_doc.get("observaciones"),
        cerrado_por=cierre_doc["cerrado_por"],
        cerrado_por_nombre=cierre_doc.get("cerrado_por_nombre"),
        creado_en=cierre_doc["creado_en"],
        aprobado_por=cierre_doc.get("aprobado_por"),
        aprobado_en=cierre_doc.get("aprobado_en")
    )

# ============================================================
# 6. LISTAR CIERRES (SIN CAMBIOS)
# ============================================================

@router.get("/cierres", response_model=List[CierreResponse])
async def listar_cierres(
    sede_id: str = Query(...),
    fecha: Optional[str] = Query(None),
    fecha_inicio: Optional[str] = Query(None),
    fecha_fin: Optional[str] = Query(None),
    estado: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """Lista los cierres de caja."""
    
    filtro = {"sede_id": sede_id, "tipo": "cierre"}
    filtro.update(construir_filtro_fecha(fecha, fecha_inicio, fecha_fin))
    
    if estado:
        filtro["estado"] = estado
    
    cierres_list = await cash_closures.find(filtro).sort("creado_en", -1).to_list(None)
    
    return [
        CierreResponse(
            cierre_id=c["cierre_id"],
            sede_id=c["sede_id"],
            sede_nombre=c.get("sede_nombre"),
            fecha=c["fecha"],
            moneda=c["moneda"],
            efectivo_inicial=c["efectivo_inicial"],
            total_ingresos=c["total_ingresos"],
            total_egresos=c["total_egresos"],
            efectivo_esperado=c["efectivo_esperado"],
            efectivo_contado=c["efectivo_contado"],
            diferencia=c["diferencia"],
            estado=c["estado"],
            observaciones=c.get("observaciones"),
            cerrado_por=c["cerrado_por"],
            cerrado_por_nombre=c.get("cerrado_por_nombre"),
            creado_en=c["creado_en"],
            aprobado_por=c.get("aprobado_por"),
            aprobado_en=c.get("aprobado_en")
        )
        for c in cierres_list
    ]

# ============================================================
# 7. VER DETALLE DE CIERRE (SIN CAMBIOS)
# ============================================================

@router.get("/cierres/{cierre_id}")
async def obtener_cierre(
    cierre_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Obtiene el detalle completo de un cierre."""
    
    cierre = await cash_closures.find_one({"cierre_id": cierre_id})
    
    if not cierre:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cierre {cierre_id} no encontrado"
        )
    
    cierre = convertir_mongo_a_json(cierre)
    
    return cierre

# ============================================================
# DELETE /cash/egresos/{egreso_id}  — Eliminar egreso (reforzado)
# REEMPLAZA el endpoint existente en la sección 8
# ============================================================

@router.delete("/egresos/{egreso_id}", status_code=status.HTTP_200_OK)
async def eliminar_egreso(
    egreso_id: str,
    motivo: str = Query(..., description="Motivo obligatorio de eliminación"),
    current_user: dict = Depends(get_current_user)
):
    """
    Elimina (soft delete) un egreso.

    ✅ Diferencias respecto al endpoint anterior:
    - Requiere motivo obligatorio
    - Bloquea si el día ya tiene cierre
    - Soft delete: marca como eliminado en lugar de borrar físicamente
    - Solo admin_sede y super_admin
    """
    _validar_rol_admin(current_user)

    egreso = await cash_expenses.find_one({"egreso_id": egreso_id})
    if not egreso:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Egreso {egreso_id} no encontrado.")

    if egreso.get("eliminado"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Este egreso ya fue eliminado.")

    await _validar_dia_no_cerrado(egreso["sede_id"], egreso["fecha"])

    await cash_expenses.update_one(
        {"egreso_id": egreso_id},
        {"$set": {
            "eliminado": True,
            "eliminado_por": current_user.get("email"),
            "eliminado_por_nombre": current_user.get("nombre"),
            "eliminado_en": datetime.now(),
            "motivo_eliminacion": motivo,
            "actualizado_en": datetime.now(),
        }}
    )

    return {
        "ok": True,
        "mensaje": f"Egreso {egreso_id} eliminado correctamente.",
        "egreso_id": egreso_id,
        "eliminado_por": current_user.get("email"),
        "motivo": motivo,
    }

# ============================================================
# 9. REPORTE DE PERIODO (CORREGIDO)
# ============================================================

@router.get("/reporte-periodo")
async def reporte_periodo(
    sede_id: str = Query(...),
    fecha_inicio: str = Query(...),
    fecha_fin: str = Query(...),
    current_user: dict = Depends(get_current_user)
):
    """Genera un reporte consolidado para un periodo de fechas."""
    inicio, fin = _normalize_range(fecha_inicio, fecha_fin)
    reporte = await _build_period_report_data(sede_id, inicio, fin)
    resumen = reporte["resumen"]

    cierres_list = await cash_closures.find({
        "sede_id": sede_id,
        "fecha": {"$gte": inicio, "$lte": fin},
        "tipo": "cierre"
    }).sort("fecha", 1).to_list(None)
    cierres_list = [convertir_mongo_a_json(c) for c in cierres_list]

    total_ingresos = float(resumen.get("total_vendido", 0) or 0)
    total_egresos = float(resumen.get("egresos", {}).get("total", 0) or 0)
    total_diferencias = sum(float(c.get("diferencia", 0) or 0) for c in cierres_list)

    return {
        "sede_id": sede_id,
        "periodo": {
            "inicio": inicio,
            "fin": fin,
            "dias": len(_build_date_list(inicio, fin))
        },
        "totales": {
            "ingresos": total_ingresos,
            "egresos": total_egresos,
            "neto": total_ingresos - total_egresos,
            "diferencias_acumuladas": total_diferencias
        },
        "resumen": resumen,
        "cierres": cierres_list
    }

# ============================================================
# 10. DESCARGAR REPORTE EXCEL (NUEVO ⭐)
# ============================================================

def _parse_date_yyyy_mm_dd(value: str, field_name: str) -> datetime:
    try:
        return datetime.strptime(normalizar_fecha(value), "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"'{field_name}' debe tener formato DD-MM-YYYY o YYYY-MM-DD"
        ) from exc


def _build_date_list(fecha_inicio: str, fecha_fin: str) -> List[str]:
    inicio_dt = _parse_date_yyyy_mm_dd(fecha_inicio, "fecha_inicio")
    fin_dt = _parse_date_yyyy_mm_dd(fecha_fin, "fecha_fin")

    if inicio_dt > fin_dt:
        inicio_dt, fin_dt = fin_dt, inicio_dt

    dias = (fin_dt - inicio_dt).days + 1
    return [
        (inicio_dt + timedelta(days=offset)).strftime("%Y-%m-%d")
        for offset in range(dias)
    ]


def _sort_items_by_fecha(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def parse_item_date(item: Dict[str, Any]) -> datetime:
        fecha_value = item.get("fecha")
        if isinstance(fecha_value, datetime):
            return fecha_value
        if isinstance(fecha_value, str):
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
                try:
                    return datetime.strptime(fecha_value, fmt)
                except ValueError:
                    continue
        return datetime.min

    return sorted(items, key=parse_item_date)


async def _build_period_report_data(
    sede_id: str,
    fecha_inicio: str,
    fecha_fin: str
) -> Dict[str, Any]:
    fechas = _build_date_list(fecha_inicio, fecha_fin)
    if not fechas:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Rango de fechas inválido"
        )

    resumenes: List[Dict[str, Any]] = []
    ventas: List[Dict[str, Any]] = []
    egresos: List[Dict[str, Any]] = []
    movimientos: List[Dict[str, Any]] = []

    saldo_inicial = 0.0

    for index, fecha_actual in enumerate(fechas):
        resumen_dia = await calcular_resumen_dia(sede_id, fecha_actual)
        resumenes.append(resumen_dia)

        ventas.extend(await obtener_ventas_dia(sede_id, fecha_actual))
        egresos.extend(await obtener_egresos_dia(sede_id, fecha_actual))

        movimientos_dia = await obtener_movimientos_efectivo_dia(sede_id, fecha_actual)
        if index == 0:
            saldo_inicial = float(
                movimientos_dia.get("saldo_inicial", resumen_dia.get("efectivo_inicial", 0)) or 0
            )
        movimientos.extend(movimientos_dia.get("movimientos", []))

    resumen_ref = resumenes[0]

    ingresos_otros_keys = [
        "tarjeta_credito",
        "tarjeta_debito",
        "abonos",
        "link_de_pago",
        "link_pago",
        "giftcard",
        "addi",
        "pos",
        "transferencia",
        "otros",
        "descuento_por_nomina",
        "descuento_nomina"
    ]

    resumen_total: Dict[str, Any] = {
        "sede_id": sede_id,
        "sede_nombre": resumen_ref.get("sede_nombre", "Sede desconocida"),
        "fecha": fechas[-1],
        "fecha_inicio": fechas[0],
        "fecha_fin": fechas[-1],
        "moneda": resumen_ref.get("moneda", "COP"),
        "efectivo_inicial": float(resumen_ref.get("efectivo_inicial", 0) or 0),
        "ingresos_efectivo": {
            "appointments_no_facturadas": 0.0,
            "sales_facturadas": 0.0,
            "total": 0.0,
            "fuente": "periodo",
        },
        "ingresos_otros_metodos": {key: 0.0 for key in ingresos_otros_keys},
        "egresos": {
            "compras_internas": {"total": 0.0, "cantidad": 0},
            "gastos_operativos": {"total": 0.0, "cantidad": 0},
            "retiros_caja": {"total": 0.0, "cantidad": 0},
            "otros": {"total": 0.0, "cantidad": 0},
            "total": 0.0,
        },
        "egresos_por_metodo": {   # ← NUEVO
            "efectivo": 0.0, "tarjeta_credito": 0.0, "tarjeta_debito": 0.0,
            "pos": 0.0, "transferencia": 0.0, "link_de_pago": 0.0, "link_pago": 0.0,
            "giftcard": 0.0, "addi": 0.0, "abonos": 0.0, "otros": 0.0, "descuento_por_nomina": 0.0, "descuento_nomina": 0.0
        },
        "efectivo_esperado": 0.0,
        "total_vendido": 0.0,
        "efectivo_contado": None,
        "diferencia": None,
        "estado": "abierto",
    }

    for resumen_dia in resumenes:
        ingresos_efectivo = resumen_dia.get("ingresos_efectivo", {})
        resumen_total["ingresos_efectivo"]["appointments_no_facturadas"] += float(
            ingresos_efectivo.get("appointments_no_facturadas", 0) or 0
        )
        resumen_total["ingresos_efectivo"]["sales_facturadas"] += float(
            ingresos_efectivo.get("sales_facturadas", 0) or 0
        )
        resumen_total["ingresos_efectivo"]["total"] += float(
            ingresos_efectivo.get("total", 0) or 0
        )

        ingresos_otros = resumen_dia.get("ingresos_otros_metodos", {})
        for key in ingresos_otros_keys:
            resumen_total["ingresos_otros_metodos"][key] += float(
                ingresos_otros.get(key, 0) or 0
            )
        
        egresos_metodo_dia = resumen_dia.get("egresos_por_metodo", 
                            resumen_dia.get("egresos", {}).get("por_metodo", {}))
        for metodo in resumen_total["egresos_por_metodo"]:
            resumen_total["egresos_por_metodo"][metodo] += float(
                egresos_metodo_dia.get(metodo, 0) or 0
            )

        egresos_dia = resumen_dia.get("egresos", {})
        for categoria in ["compras_internas", "gastos_operativos", "retiros_caja", "otros"]:
            info_cat = egresos_dia.get(categoria, {})
            resumen_total["egresos"][categoria]["total"] += float(info_cat.get("total", 0) or 0)
            resumen_total["egresos"][categoria]["cantidad"] += int(info_cat.get("cantidad", 0) or 0)

        resumen_total["total_vendido"] += float(resumen_dia.get("total_vendido", 0) or 0)

    resumen_total["ingresos_otros_metodos"]["total"] = sum(
        resumen_total["ingresos_otros_metodos"][key] for key in ingresos_otros_keys
    )
    resumen_total["egresos"]["total"] = sum(
        resumen_total["egresos"][categoria]["total"]
        for categoria in ["compras_internas", "gastos_operativos", "retiros_caja", "otros"]
    )

    movimientos = _sort_items_by_fecha(movimientos)
    saldo_corrido = float(saldo_inicial)
    for movimiento in movimientos:
        ingreso = float(movimiento.get("ingreso", 0) or 0)
        egreso = float(movimiento.get("egreso", 0) or 0)
        saldo_corrido += ingreso - egreso
        movimiento["saldo"] = saldo_corrido

    if movimientos:
        resumen_total["efectivo_esperado"] = saldo_corrido
    else:
        resumen_total["efectivo_esperado"] = (
            resumen_total["efectivo_inicial"]
            + resumen_total["ingresos_efectivo"]["total"]
            - resumen_total["egresos"]["total"]
        )

    return {
        "resumen": resumen_total,
        "ventas": _sort_items_by_fecha(ventas),
        "egresos": _sort_items_by_fecha(egresos),
        "movimientos_efectivo": {
            "saldo_inicial": saldo_inicial,
            "movimientos": movimientos,
            "saldo_final": resumen_total["efectivo_esperado"],
        },
        "fecha_inicio": fechas[0],
        "fecha_fin": fechas[-1],
    }


@router.get("/reporte-excel")
async def descargar_reporte_excel(
    sede_id: str = Query(..., description="ID de la sede"),
    fecha: Optional[str] = Query(None, description="Fecha del cierre (DD-MM-YYYY o YYYY-MM-DD)"),
    fecha_inicio: Optional[str] = Query(None, description="Fecha inicio (DD-MM-YYYY o YYYY-MM-DD)"),
    fecha_fin: Optional[str] = Query(None, description="Fecha fin (DD-MM-YYYY o YYYY-MM-DD)"),
    current_user: dict = Depends(get_current_user)
):
    """
    Descarga el reporte de cierre de caja en formato Excel con 4 hojas:
    
    1. Resumen de Caja - Efectivo inicial, ingresos/egresos, saldo final
    2. Flujo de Ingresos - TODAS las ventas (todos los métodos de pago) desde sales
    3. Flujo de Egresos - Todos los egresos del día
    4. Movimientos Efectivo - Solo efectivo con saldo corrido
    
    ✅ Usa collection_sales (compatible con datos nuevos y migrados)
    ✅ Formato contable profesional
    ✅ Archivo descargable
    """
    
    usar_rango = bool(fecha_inicio or fecha_fin)

    if usar_rango and (not fecha_inicio or not fecha_fin):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Debes enviar 'fecha_inicio' y 'fecha_fin' para descargar por período"
        )

    if not usar_rango and not fecha:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Debes enviar 'fecha' o 'fecha_inicio' y 'fecha_fin'"
        )

    if usar_rango:
        reporte_periodo = await _build_period_report_data(sede_id, fecha_inicio, fecha_fin)
        resumen = reporte_periodo["resumen"]
        ventas = reporte_periodo["ventas"]
        egresos = reporte_periodo["egresos"]
        movimientos_efectivo = reporte_periodo["movimientos_efectivo"]
        periodo_inicio = reporte_periodo["fecha_inicio"]
        periodo_fin = reporte_periodo["fecha_fin"]
        fecha_para_nombre = f"{periodo_inicio}_a_{periodo_fin}"
    else:
        _parse_date_yyyy_mm_dd(fecha, "fecha")

        # 1. Obtener resumen del día
        resumen = await calcular_resumen_dia(sede_id, fecha)
        
        # 3. Obtener todas las ventas del día (todos los métodos) desde SALES
        ventas = await obtener_ventas_dia(sede_id, fecha)
        
        # 4. Obtener todos los egresos del día
        egresos = await obtener_egresos_dia(sede_id, fecha)
        
        # 5. Obtener movimientos en efectivo con saldo corrido
        movimientos_efectivo = await obtener_movimientos_efectivo_dia(sede_id, fecha)
        fecha_para_nombre = fecha
        periodo_inicio = fecha
        periodo_fin = fecha

    # Asegurar metadata de período para el generador (útil en rango y compatible en día)
    resumen["fecha_inicio"] = periodo_inicio
    resumen["fecha_fin"] = periodo_fin
    
    # 2. Obtener información completa de la sede
    sede = await locales.find_one({"sede_id": sede_id})
    if not sede:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sede {sede_id} no encontrada"
        )
    
    sede_info = {
        "razon_social": sede.get("razon_social", "SALÓN RIZOS FELICES CL SAS"),
        "direccion": sede.get("direccion", ""),
        "ciudad": sede.get("ciudad", ""),
        "pais": sede.get("pais", "")
    }
    
    # 6. Agregar quien genera el reporte
    resumen["generado_por"] = current_user.get("email")
    
    # 7. Generar Excel con 4 hojas
    excel_file = generar_reporte_excel_caja_completo(
        resumen=resumen,
        sede_info=sede_info,
        facturas=ventas,  # ← Ahora son ventas de sales, no facturas de invoices
        egresos=egresos,
        movimientos_efectivo=movimientos_efectivo
    )
    
    # 8. Nombre del archivo
    nombre_sede = sede.get("nombre", sede_id).replace(" ", "_")
    filename = generar_nombre_archivo_excel(nombre_sede, fecha_para_nombre)
    
    # 9. Retornar como descarga
    return StreamingResponse(
        excel_file,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )
