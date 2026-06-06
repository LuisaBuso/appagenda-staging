from fastapi import APIRouter, HTTPException, Depends, Query
from app.clients_service.models import Cliente, NotaCliente, ClientesPaginados, CalificacionRequest, CalificacionValor
from app.database.mongo import (
    collection_clients, collection_citas, collection_card,
    collection_servicios, collection_locales, collection_estilista, collection_sales
)
from app.auth.routes import get_current_user
from app.id_generator.generator import generar_id
from pymongo.errors import DuplicateKeyError
from datetime import datetime, timedelta
from typing import List, Optional
from bson import ObjectId
import logging
import re

from rapidfuzz import fuzz

logger = logging.getLogger(__name__)

router = APIRouter()


def cliente_to_dict(c: dict) -> dict:
    c["_id"] = str(c["_id"])
    if "cliente_id" not in c or not c["cliente_id"]:
        c["cliente_id"] = str(c["_id"])
    return c


def cita_to_dict(c: dict) -> dict:
    c["_id"] = str(c["_id"])
    return c


async def verificar_duplicado_cliente(
    correo: Optional[str] = None,
    telefono: Optional[str] = None,
    exclude_id: Optional[str] = None
):
    if not correo and not telefono:
        return None

    query = {"$or": []}
    if correo:
        query["$or"].append({"correo": correo})
    if telefono:
        query["$or"].append({"telefono": telefono})

    if exclude_id:
        try:
            query["_id"] = {"$ne": ObjectId(exclude_id)}
        except:
            pass

    return await collection_clients.find_one(query)


async def _get_franquicia_id_de_sede(sede_id: str) -> Optional[str]:
    """Obtiene el franquicia_id de una sede. Utilidad reutilizable."""
    if not sede_id:
        return None
    sede = await collection_locales.find_one(
        {"sede_id": sede_id},
        {"franquicia_id": 1, "_id": 0}
    )
    return sede.get("franquicia_id") if sede else None

# ============================================================
# ✅ HELPERS DE BÚSQUEDA INTELIGENTE
# ============================================================
 
def _solo_digitos(texto: str) -> str:
    """Extrae solo los dígitos de un string. Útil para normalizar teléfonos y cédulas."""
    return re.sub(r"\D", "", texto)
 
 
def _tipo_busqueda(termino: str) -> str:
    # ── Correo electrónico: detección prioritaria ──────────────────────
    if "@" in termino:
        return "correo"
    
    digitos = _solo_digitos(termino)
    tiene_letras = bool(re.search(r"[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]", termino))
    tiene_digitos = bool(digitos)

    if tiene_letras and not tiene_digitos:
        return "nombre"
    if not tiene_letras and tiene_digitos:
        return "telefono_o_cedula"
    if tiene_letras and tiene_digitos:
        return "mixto"
    return "nombre"
 
 
def _normalizar_telefono(tel: str) -> str:
    """
    Normaliza teléfono: quita +, espacios, guiones, prefijos de país comunes.
    +573001234567 → 3001234567
    57 300 123 4567 → 3001234567
    """
    digitos = _solo_digitos(tel)
    # Quitar prefijos de país comunes (57=Colombia, 1=USA, 52=México, 34=España, 56=Chile)
    for prefijo in ["57", "1", "52", "34", "56", "51", "593", "591", "595", "598"]:
        if digitos.startswith(prefijo) and len(digitos) > len(prefijo) + 6:
            sin_prefijo = digitos[len(prefijo):]
            # Solo quitar el prefijo si lo que queda parece un número local válido (7-10 dígitos)
            if 7 <= len(sin_prefijo) <= 10:
                digitos = sin_prefijo
                break
    return digitos
 
 
def _score_nombre(termino: str, nombre: str) -> int:
    t = termino.lower().strip()
    n = nombre.lower().strip()

    tokens_termino = t.split()
    tokens_nombre  = n.split()

    if len(tokens_termino) == 1:
        base = max(fuzz.token_set_ratio(t, n), fuzz.partial_ratio(t, n))
    else:
        base = max(fuzz.token_set_ratio(t, n), fuzz.token_sort_ratio(t, n))

    if tokens_termino:
        ultimo_token = tokens_termino[-1]
        if len(ultimo_token) >= 2:
            prefijo_match = any(p.startswith(ultimo_token) for p in tokens_nombre)
            if prefijo_match:
                tokens_previos = tokens_termino[:-1]
                contexto_ok = all(
                    any(fuzz.ratio(tp, tn) >= 70 for tn in tokens_nombre)
                    for tp in tokens_previos
                ) if tokens_previos else True
                boost = 22 if contexto_ok else 10
                base = min(100, base + boost)

    # ✅ FIX: umbral subido de 70 → 82 en el coverage check.
    # Con 70, fuzz.ratio("dios", "rios") = 75 contaba como cobertura válida,
    # haciendo que "Juan Jose Rios De La Ossa" pasara sin penalización.
    # Con 82, solo coincidencias reales cuentan.
    if len(tokens_termino) >= 2:
        tokens_cubiertos = sum(
            1 for tt in tokens_termino
            if any(fuzz.ratio(tt, tn) >= 82 or tn.startswith(tt) or tt.startswith(tn)
                   for tn in tokens_nombre)
        )
        cobertura = tokens_cubiertos / len(tokens_termino)
        penalizacion = round((1 - cobertura) * 50)
        base = max(0, base - penalizacion)

    if tokens_termino and tokens_nombre:
        primer_token = tokens_termino[0]
        if len(primer_token) >= 3:
            mejor_match_primer = max(
                fuzz.ratio(primer_token, tn) for tn in tokens_nombre
            )
            if mejor_match_primer >= 85:
                base = min(100, base + 10)
            elif mejor_match_primer < 55:
                base = max(0, base - 30)

    return base
 
def _umbral_dinamico(termino: str) -> int:
    """
    Ajusta el umbral según la longitud del término.
    Términos cortos necesitan umbral más bajo para no perder resultados válidos.
    """
    n = len(termino.strip())
    if n <= 3:
        return 55   # "Ana" → acepta "Ana María"
    if n <= 6:
        return 65   # "luisa" → acepta "Luisa Fernanda"
    if n <= 12:
        return 72   # "luisa bust" → más específico
    return 78       # términos largos: exigir mayor precisión
 
 
def _aplicar_fuzzy_nombres(clientes: List[dict], termino: str) -> List[dict]:
    """
    Filtra y ordena clientes por similitud de nombre con rapidfuzz.
    Umbral dinámico según longitud del término.
    """
    umbral = _umbral_dinamico(termino)
    scored = []
    for cliente in clientes:
        nombre = cliente.get("nombre") or ""
        score = _score_nombre(termino, nombre)
        if score >= umbral:
            scored.append((score, cliente))
    scored.sort(key=lambda x: (-x[0], (x[1].get("nombre") or "").lower()))
    return [c for _, c in scored]
 
 
def _aplicar_filtro_telefono(clientes: List[dict], termino: str) -> List[dict]:
    """
    Filtra clientes por teléfono normalizando ambos lados.
    Busca si el número normalizado del término está contenido en el teléfono normalizado
    o viceversa. Así '3001234567' encuentra '+57 300 123 4567'.
    """
    termino_norm = _normalizar_telefono(termino)
    if len(termino_norm) < 4:
        return []
 
    resultado = []
    for cliente in clientes:
        tel = cliente.get("telefono") or ""
        tel_norm = _normalizar_telefono(tel)
        # Match si uno contiene al otro (maneja prefijos y sufijos)
        if termino_norm in tel_norm or tel_norm in termino_norm:
            resultado.append(cliente)
    return resultado
 
 
def _aplicar_filtro_cedula(clientes: List[dict], termino: str) -> List[dict]:
    """Filtra clientes por cédula normalizando dígitos."""
    termino_norm = _solo_digitos(termino)
    if len(termino_norm) < 4:
        return []
    resultado = []
    for cliente in clientes:
        cedula = _solo_digitos(cliente.get("cedula") or "")
        if termino_norm in cedula or cedula in termino_norm:
            resultado.append(cliente)
    return resultado
 
 
async def _get_query_base(rol: str, current_user: dict) -> dict:
    """Construye el filtro base de franquicia/sede según el rol."""
    """query_base = {}
    if rol in ["admin_sede", "estilista", "call_center", "recepcionista"]:
        sede_id = current_user.get("sede_id")
        if not sede_id:
            raise HTTPException(400, "Tu usuario no tiene sede asignada")
        franquicia_id = await _get_franquicia_id_de_sede(sede_id)
        if franquicia_id:
            query_base["franquicia_id"] = franquicia_id
        else:
            query_base["sede_id"] = sede_id
    return query_base"""
    return {}  # ← DESACTIVADO: por ahora no filtramos por sede/franquicia para no romper funcionalidades existentes. Se puede reactivar cuando se implemente el control total de acceso a clientes por sede/franquicia.
 
 
# Stopwords de nombres en español — no aportan discriminación
_STOPWORDS_NOMBRES = {"de", "del", "la", "las", "los", "el", "y", "e", "o", "en", "al", "con"}


async def _buscar_candidatos(
    query_base: dict,
    termino: str,
    tipo: str,
    projection: dict,
    max_candidatos: int = 5000
) -> List[dict]:

    if tipo == "nombre":
        partes = [t for t in termino.split() if len(t) >= 2]

        if not partes:
            return await (
                collection_clients.find(query_base, projection)
                .limit(max_candidatos).to_list(max_candidatos)
            )

        tokens_escaped = [re.escape(t) for t in partes]

        # ── Tokens significativos: excluyen stopwords para el $and de precisión ──
        # "juan de dios" → significativos: ["juan", "dios"]
        # Esto garantiza que "Juan de Dios García" aparezca en candidatos
        # aunque el $or amplio no lo incluya en los primeros 2000.
        tokens_significativos = [
            re.escape(t) for t in partes
            if t.lower() not in _STOPWORDS_NOMBRES
        ]

        # ── Query de PRECISIÓN: $and sobre tokens significativos ──────────────
        # Solo se ejecuta si hay 2+ tokens significativos.
        # Ejemplo: "juan dios" → nombre contiene "juan" AND "dios"
        candidatos_precision: List[dict] = []
        if len(tokens_significativos) >= 2:
            query_precision = {
                **query_base,
                "$and": [
                    {"nombre": {"$regex": t, "$options": "i"}}
                    for t in tokens_significativos
                ]
            }
            candidatos_precision = await (
                collection_clients.find(query_precision, projection)
                .limit(max_candidatos).to_list(max_candidatos)
            )
            logger.info(f"[BUSCAR] precisión ($and significativos): {len(candidatos_precision)}")

        # ── Query AMPLIA: $or sobre todos los tokens ───────────────────────────
        # Red ancha para cubrir coincidencias parciales. Los falsos positivos
        # los elimina _score_nombre en la siguiente etapa.
        query_amplia = {
            **query_base,
            "$or": [
                {"nombre": {"$regex": t, "$options": "i"}}
                for t in tokens_escaped
            ]
        }
        candidatos_amplia = await (
            collection_clients.find(query_amplia, projection)
            .limit(max_candidatos).to_list(max_candidatos)
        )
        logger.info(f"[BUSCAR] amplia ($or): {len(candidatos_amplia)}")

        # ── Merge: precisión primero, luego amplia, sin duplicados ────────────
        ids_vistos: set = set()
        candidatos: List[dict] = []
        for c in candidatos_precision + candidatos_amplia:
            cid = str(c.get("_id", ""))
            if cid not in ids_vistos:
                ids_vistos.add(cid)
                candidatos.append(c)
                if len(candidatos) >= max_candidatos:
                    break

        # ── Fallback total si aún hay muy pocos ───────────────────────────────
        if len(candidatos) < 3:
            candidatos = await (
                collection_clients.find(query_base, projection)
                .limit(max_candidatos).to_list(max_candidatos)
            )

        return candidatos

    elif tipo == "correo":
        query = {
            **query_base,
            "correo": {"$regex": re.escape(termino), "$options": "i"}
        }

    elif tipo == "telefono_o_cedula":
        digitos = _solo_digitos(termino)
        if not digitos:
            return []
        regex_digitos = {"$regex": digitos, "$options": "i"}
        query = {
            **query_base,
            "$or": [
                {"telefono": regex_digitos},
                {"cedula": regex_digitos},
                {"cliente_id": {"$regex": re.escape(termino), "$options": "i"}},
            ]
        }

    else:  # mixto
        query = {
            **query_base,
            "$or": [
                {"cliente_id": {"$regex": re.escape(termino), "$options": "i"}},
                {"nombre":     {"$regex": re.escape(termino), "$options": "i"}},
            ]
        }

    candidatos = await (
        collection_clients.find(query, projection)
        .limit(max_candidatos).to_list(max_candidatos)
    )

    if len(candidatos) < 3 and tipo == "nombre":
        candidatos = await (
            collection_clients.find(query_base, projection)
            .limit(max_candidatos).to_list(max_candidatos)
        )

    return candidatos
 
 
def _puntuar_y_ordenar(candidatos: List[dict], termino: str, tipo: str) -> List[dict]:
    if tipo == "nombre":
        return _aplicar_fuzzy_nombres(candidatos, termino)

    elif tipo == "correo":                                   # ← NUEVO
        # Ordenar por qué tan al inicio del correo aparece el término
        termino_lower = termino.lower()
        def score_correo(c):
            correo = (c.get("correo") or "").lower()
            idx = correo.find(termino_lower)
            return idx if idx >= 0 else 9999
        return sorted(candidatos, key=score_correo)

    elif tipo == "telefono_o_cedula":
        por_tel = _aplicar_filtro_telefono(candidatos, termino)
        por_ced = _aplicar_filtro_cedula(candidatos, termino)
        ids_vistos = set()
        resultado = []
        for c in por_tel + por_ced:
            cid = str(c.get("_id", ""))
            if cid not in ids_vistos:
                ids_vistos.add(cid)
                resultado.append(c)
        return resultado

    else:  # mixto
        return candidatos

# ============================================================
# CREAR CLIENTE
# ============================================================
@router.post("/", response_model=dict)
async def crear_cliente(
    cliente: Cliente,
    current_user: dict = Depends(get_current_user)
):
    try:
        rol = current_user.get("rol")
        if rol not in ["admin_sede", "admin_franquicia", "super_admin", "call_center", "recepcionista"]:
            raise HTTPException(403, "No autorizado")

        sede_autenticada = current_user.get("sede_id")
        sede_objetivo = sede_autenticada or cliente.sede_id

        if not sede_objetivo:
            raise HTTPException(
                status_code=400,
                detail="Debes seleccionar una sede para crear el cliente"
            )

        # Consultar información de la sede
        sede_info = await collection_locales.find_one({"sede_id": sede_objetivo})
        if not sede_info:
            raise HTTPException(400, f"Sede no encontrada: {sede_objetivo}")

        # Obtener franquicia_id de la sede
        franquicia_id = sede_info.get("franquicia_id")

        # Generar ID del cliente
        cliente_id = await generar_id("cliente", sede_objetivo)

        data = cliente.dict(exclude_none=True)
        data["cliente_id"] = cliente_id
        data["fecha_creacion"] = datetime.now()
        data["creado_por"] = current_user.get("email", "unknown")
        data["sede_id"] = sede_objetivo
        data["franquicia_id"] = franquicia_id  # ⭐ Heredado de la sede
        data["pais"] = sede_info.get("pais", "")
        data["notas_historial"] = []

        # Limpiar campo obsoleto si venía en el payload
        data.pop("es_global", None)

        for intento in range(5):
            try:
                result = await collection_clients.insert_one(data)
                break  # éxito
            except DuplicateKeyError:
                if intento == 4:
                    raise HTTPException(500, "No se pudo generar un ID único. Intenta de nuevo.")
                data.pop("_id", None)  # ← LÍNEA 1: limpiar _id que Motor inyectó
                data["cliente_id"] = await generar_id("cliente", sede_objetivo)

        data["_id"] = str(result.inserted_id)  # ← LÍNEA 2: convertir para el return
        return {"success": True, "cliente": data}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error al crear cliente: {e}", exc_info=True)
        raise HTTPException(500, "Error al crear cliente")


# ============================================================
# LISTAR CLIENTES (endpoint simple — usado por el modal de reservas)
# ============================================================
@router.get("/", response_model=List[dict])
async def listar_clientes(
    filtro: Optional[str] = Query(None),
    limite: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user)
):
    try:
        rol = current_user.get("rol")
        if rol not in ["admin_sede", "super_admin", "estilista", "call_center", "recepcionista"]:
            raise HTTPException(403, "No autorizado")
 
        query_base = await _get_query_base(rol, current_user)
        filtro_limpio = filtro.strip() if filtro else None
 
        if not filtro_limpio:
            clientes = await collection_clients.find(query_base).limit(limite).to_list(None)
            return [cliente_to_dict(c) for c in clientes]
 
        tipo = _tipo_busqueda(filtro_limpio)
 
        candidatos = await _buscar_candidatos(
            query_base=query_base,
            termino=filtro_limpio,
            tipo=tipo,
            projection={},        # proyección completa para este endpoint
            max_candidatos=5000
        )
 
        resultado = _puntuar_y_ordenar(candidatos, filtro_limpio, tipo)
        return [cliente_to_dict(c) for c in resultado[:limite]]
 
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listando clientes: {e}", exc_info=True)
        raise HTTPException(500, "Error al listar clientes")
 
 

# ============================================================
# BÚSQUEDA LIGERA — Para citas, giftcards, ventas directas
# ============================================================
@router.get("/buscar", response_model=List[dict])
async def buscar_clientes_ligero(
    filtro: str = Query(..., min_length=2),
    limite: int = Query(15, ge=1, le=50),
    current_user: dict = Depends(get_current_user)
):
    try:
        rol = current_user.get("rol")
        if rol not in ["admin_sede", "super_admin", "estilista", "call_center", "recepcionista"]:
            raise HTTPException(403, "No autorizado")

        query_base = await _get_query_base(rol, current_user)
        filtro_limpio = filtro.strip()

        # 🔍 DEBUG
        logger.info(f"[BUSCAR] filtro='{filtro_limpio}' rol='{rol}' query_base={query_base}")

        projection = {
            "_id": 1, "cliente_id": 1, "nombre": 1,
            "correo": 1, "cedula": 1, "telefono": 1,
            "sede_id": 1, "franquicia_id": 1,
        }

        tipo = _tipo_busqueda(filtro_limpio)
        logger.info(f"[BUSCAR] tipo='{tipo}'")

        candidatos = await _buscar_candidatos(
            query_base=query_base,
            termino=filtro_limpio,
            tipo=tipo,
            projection=projection,
            max_candidatos=2000
        )

        # 🔍 DEBUG
        logger.info(f"[BUSCAR] candidatos MongoDB: {len(candidatos)} — sample: {[c.get('nombre') for c in candidatos[:5]]}")

        resultado = _puntuar_y_ordenar(candidatos, filtro_limpio, tipo)

        # 🔍 DEBUG
        logger.info(f"[BUSCAR] resultado tras scoring: {len(resultado)} — top5: {[c.get('nombre') for c in resultado[:5]]}")

        return [
            {
                "id":            str(c.get("_id", "")),
                "cliente_id":    c.get("cliente_id", ""),
                "nombre":        c.get("nombre", ""),
                "correo":        c.get("correo", ""),
                "cedula":        c.get("cedula", ""),
                "telefono":      c.get("telefono", ""),
                "sede_id":       c.get("sede_id"),
                "franquicia_id": c.get("franquicia_id"),
            }
            for c in resultado[:limite]
        ]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error en buscar_clientes_ligero: {e}", exc_info=True)
        raise HTTPException(500, "Error al buscar clientes")

# ============================================================
# LISTAR TODOS — CON PAGINACIÓN Y BÚSQUEDA INTELIGENTE
# ============================================================
@router.get("/todos", response_model=ClientesPaginados)
async def listar_todos(
    filtro: Optional[str] = Query(None, description="Búsqueda por nombre, teléfono, correo, cédula o ID"),
    segmento: Optional[str] = Query(None, description="inactivos | nuevos"),  # ← NUEVO
    limite: int = Query(30, ge=1, le=100),
    pagina: int = Query(1, ge=1),
    current_user: dict = Depends(get_current_user)
):
    """
    Búsqueda inteligente de clientes con lazy loading.
    - Nombres: fuzzy con token_set_ratio + partial_ratio, umbral dinámico
    - Teléfonos: normaliza prefijos de país (+57, 57, etc.)
    - Cédulas: normaliza dígitos, búsqueda por contención
    - Correos: búsqueda exacta
    - IDs: regex exacto
    """
    try:
        rol = current_user.get("rol")
        if rol not in ["super_admin", "admin_sede", "estilista", "call_center", "recepcionista"]:
            raise HTTPException(403, "No tienes permisos para ver clientes")
 
        query_base = await _get_query_base(rol, current_user)
        # ── Filtro de segmento ───────────────────────────────────────────
        # Se aplica sobre campos ya calculados y guardados en BD por el backfill.
        FILTROS_SEGMENTO = {
            "inactivos": {"$or": [
                {"dias_sin_visitar": {"$gte": 180}},
                {"segmento": "Perdido"},
            ]},
            "nuevos": {"$or": [
                {"total_visitas": {"$lte": 1}},
                {"segmento": "Nuevo"},
                {"total_visitas": {"$exists": False}},   # nunca tuvo backfill
            ]},
        }
        if segmento and segmento in FILTROS_SEGMENTO:
            query_base = {**query_base, **FILTROS_SEGMENTO[segmento]}
        # ────────────────────────────────────────────────────────────────
        filtro_limpio = filtro.strip() if filtro else None
 
        projection = {
            "_id": 1, "cliente_id": 1, "nombre": 1, "correo": 1,
            "telefono": 1, "cedula": 1, "sede_id": 1, "franquicia_id": 1, "cedula": 1,
            "fecha_creacion": 1,
            "fecha_registro": 1,
            "total_gastado": 1,
            "ticket_promedio": 1,
            "ltv_proyectado": 1,
            "dias_sin_visitar": 1,
            "ultima_visita": 1,
            "primera_visita": 1,
            "frecuencia_dias": 1,
            "en_riesgo_churn": 1,
            "segmento": 1,
            "total_visitas": 1,
            "notas_historial": {"$slice": 5},
            # score_retencion y tendencia_gasto: se guardan en BD pero no se exponen
        }
        # ── SIN FILTRO: comportamiento original con paginación ──────────────
        if not filtro_limpio:
            if rol == "super_admin" and not segmento and not query_base:
                total_clientes = await collection_clients.estimated_document_count()
            else:
                total_clientes = await collection_clients.count_documents(query_base)
 
            skip = (pagina - 1) * limite
            total_paginas = max(1, (total_clientes + limite - 1) // limite)
 
            if pagina > total_paginas and total_paginas > 0:
                raise HTTPException(404, f"Página {pagina} no existe. Total: {total_paginas}")
 
            clientes = await (
                collection_clients.find(query_base, projection)
                .sort("nombre", 1).skip(skip).limit(limite)
                .to_list(limite)
            )
            return {
                "clientes": [cliente_to_dict_ligero(c) for c in clientes],
                "metadata": {
                    "total": total_clientes, "pagina": pagina, "limite": limite,
                    "total_paginas": total_paginas,
                    "tiene_siguiente": pagina < total_paginas,
                    "tiene_anterior": pagina > 1,
                    "rango_inicio": skip + 1 if clientes else 0,
                    "rango_fin": skip + len(clientes),
                }
            }
 
        # ── CON FILTRO: búsqueda inteligente ────────────────────────────────
        tipo = _tipo_busqueda(filtro_limpio)
        logger.info(f"[BUSQUEDA] filtro='{filtro_limpio}' tipo='{tipo}'")
 
        candidatos = await _buscar_candidatos(
            query_base=query_base,
            termino=filtro_limpio,
            tipo=tipo,
            projection=projection,
            max_candidatos=5000
        )
        logger.info(f"[BUSQUEDA] candidatos MongoDB: {len(candidatos)}")
 
        resultado = _puntuar_y_ordenar(candidatos, filtro_limpio, tipo)
        logger.info(f"[BUSQUEDA] resultado final: {len(resultado)} — top3: {[c.get('nombre') for c in resultado[:3]]}")
 
        # Paginación sobre resultado en memoria
        total_clientes = len(resultado)
        total_paginas = max(1, (total_clientes + limite - 1) // limite)
 
        if pagina > total_paginas and total_paginas > 0:
            raise HTTPException(404, f"Página {pagina} no existe. Total: {total_paginas}")
 
        skip = (pagina - 1) * limite
        clientes_pagina = resultado[skip: skip + limite]
 
        return {
            "clientes": [cliente_to_dict_ligero(c) for c in clientes_pagina],
            "metadata": {
                "total": total_clientes, "pagina": pagina, "limite": limite,
                "total_paginas": total_paginas,
                "tiene_siguiente": pagina < total_paginas,
                "tiene_anterior": pagina > 1,
                "rango_inicio": skip + 1 if clientes_pagina else 0,
                "rango_fin": skip + len(clientes_pagina),
            }
        }
 
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error al obtener clientes: {e}", exc_info=True)
        raise HTTPException(500, "Error al obtener clientes. Por favor intenta de nuevo.")


# ============================================================
# 🪶 FUNCIÓN AUXILIAR: Convertir a dict ligero
# ============================================================
def cliente_to_dict_ligero(cliente: dict) -> dict:
    ultima_visita  = cliente.get("ultima_visita")
    primera_visita = cliente.get("primera_visita")

    fecha_creacion = cliente.get("fecha_creacion") or cliente.get("fecha_registro")
    if isinstance(fecha_creacion, datetime):
        fecha_creacion = fecha_creacion.strftime("%Y-%m-%d")

    dias_sin_visitar = 0
    if ultima_visita:
        try:
            ultima_dt = datetime.strptime(str(ultima_visita)[:10], "%Y-%m-%d")
            dias_sin_visitar = max(0, (datetime.now() - ultima_dt).days)
        except Exception:
            dias_sin_visitar = cliente.get("dias_sin_visitar", 0) or 0

    return {
        "id":               str(cliente.get("_id", "")),
        "cliente_id":       cliente.get("cliente_id", ""),
        "nombre":           cliente.get("nombre", ""),
        "correo":           cliente.get("correo", ""),
        "telefono":         cliente.get("telefono", ""),
        "cedula":           cliente.get("cedula", ""), 
        "sede_id":          cliente.get("sede_id"),
        "franquicia_id":    cliente.get("franquicia_id"),
        "fecha_creacion":   fecha_creacion,
        "total_gastado":    cliente.get("total_gastado", 0) or 0,
        "ticket_promedio":  cliente.get("ticket_promedio", 0) or 0,
        "ltv_proyectado":   cliente.get("ltv_proyectado", 0) or 0,
        "dias_sin_visitar": dias_sin_visitar,
        "ultima_visita":    ultima_visita,
        "primera_visita":   primera_visita,
        "frecuencia_dias":  cliente.get("frecuencia_dias"),
        "en_riesgo_churn":  cliente.get("en_riesgo_churn", False) or False,
        "segmento":         cliente.get("segmento", "Nuevo") or "Nuevo",
        "total_visitas":    cliente.get("total_visitas", 0) or 0,
        "notas_historial":  cliente.get("notas_historial", []),
    }

# ============================================================
# LISTAR CLIENTES POR ID DE SEDE
# ============================================================
@router.get("/filtrar/{id}", response_model=List[dict])
async def listar_por_id(
    id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        rol = current_user.get("rol")

        if rol not in ["super_admin", "admin_sede", "estilista", "call_center", "recepcionista"]:
            raise HTTPException(403, "No autorizado")

        if rol in ["admin_sede", "estilista", "call_center", "recepcionista"]:
            if id != current_user.get("sede_id"):
                raise HTTPException(403, "No tiene permisos para ver esos clientes")

        clientes = await collection_clients.find({"sede_id": id}).to_list(None)
        return [cliente_to_dict(c) for c in clientes]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error filtrando clientes: {e}", exc_info=True)
        raise HTTPException(500, "Error al filtrar clientes")


# ============================================================
# OBTENER CLIENTE
# ============================================================
@router.get("/{id}", response_model=dict)
async def obtener_cliente(
    id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        rol = current_user.get("rol")
        #user_sede_id = current_user.get("sede_id")

        if rol not in ["admin_sede", "super_admin", "estilista", "call_center", "recepcionista"]:
            raise HTTPException(status_code=403, detail="No autorizado")

        # Buscar cliente por cliente_id o _id
        cliente = await collection_clients.find_one({"cliente_id": id})
        if not cliente:
            try:
                cliente = await collection_clients.find_one({"_id": ObjectId(id)})
            except:
                pass

        if not cliente:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")

        # Validación de acceso para admin_sede y estilista
        """if rol in ["admin_sede", "estilista", "call_center", "recepcionista"]:
            cliente_franquicia_id = cliente.get("franquicia_id")
            user_franquicia_id = await _get_franquicia_id_de_sede(user_sede_id)

            if cliente_franquicia_id and user_franquicia_id:
                # ⭐ Si comparten franquicia → acceso permitido
                if cliente_franquicia_id != user_franquicia_id:
                    raise HTTPException(status_code=403, detail="No autorizado")
            elif cliente.get("sede_id") and cliente.get("sede_id") != user_sede_id:
                # Fallback: verificar por sede directa
                raise HTTPException(status_code=403, detail="No autorizado")"""

        return cliente_to_dict(cliente)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error obteniendo cliente {id}: {e}")
        raise HTTPException(status_code=500, detail="Error al obtener cliente")


# ============================================================
# EDITAR CLIENTE
# ============================================================
@router.put("/{id}", response_model=dict)
async def editar_cliente(
    id: str,
    data_update: Cliente,
    current_user: dict = Depends(get_current_user)
):
    try:
        rol = current_user.get("rol")
        if rol not in ["admin_sede", "super_admin", "call_center", "recepcionista"]:
            raise HTTPException(403, "No autorizado")

        cliente = await collection_clients.find_one({"cliente_id": id})
        if not cliente:
            try:
                cliente = await collection_clients.find_one({"_id": ObjectId(id)})
            except:
                pass

        if not cliente:
            raise HTTPException(404, "Cliente no encontrado")

        # Validar acceso por franquicia
        if rol == "admin_sede":
            user_sede_id = current_user.get("sede_id")
            user_franquicia_id = await _get_franquicia_id_de_sede(user_sede_id)
            cliente_franquicia_id = cliente.get("franquicia_id")

            tiene_acceso = (
                (user_franquicia_id and user_franquicia_id == cliente_franquicia_id) or
                cliente.get("sede_id") == user_sede_id
            )

            if not tiene_acceso:
                raise HTTPException(403, "No autorizado")

        existing = await verificar_duplicado_cliente(
            correo=data_update.correo,
            telefono=data_update.telefono,
            exclude_id=str(cliente["_id"])
        )

        if existing:
            campo = "correo" if data_update.correo == existing.get("correo") else "teléfono"
            raise HTTPException(400, f"Ya existe otro cliente con este {campo}")

        update_data = data_update.dict(exclude_none=True)
        update_data["modificado_por"] = current_user.get("email")
        update_data["fecha_modificacion"] = datetime.now()
        update_data.pop("cliente_id", None)
        update_data.pop("es_global", None)  # Nunca permitir setear campo obsoleto

        await collection_clients.update_one(
            {"_id": cliente["_id"]},
            {"$set": update_data}
        )

        return {"success": True, "msg": "Cliente actualizado"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error editando cliente: {e}", exc_info=True)
        raise HTTPException(500, "Error al editar cliente")


# ============================================================
# AGREGAR NOTA
# ============================================================
@router.post("/{id}/notas", response_model=dict)
async def agregar_nota(
    id: str,
    nota: NotaCliente,
    current_user: dict = Depends(get_current_user)
):
    try:
        cliente = await collection_clients.find_one({"cliente_id": id})
        if not cliente:
            try:
                cliente = await collection_clients.find_one({"_id": ObjectId(id)})
            except:
                pass

        if not cliente:
            raise HTTPException(404, "Cliente no encontrado")

        nota_obj = {
            "contenido": nota.contenido,   # ← was nota.nota
            "fecha": datetime.now(),
            "autor": nota.autor or current_user.get("email"),
        }

        await collection_clients.update_one(
            {"_id": cliente["_id"]},
            {"$push": {"notas_historial": nota_obj}}
        )

        return {"success": True, "msg": "Nota agregada"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error agregando nota: {e}")
        raise HTTPException(500, "Error al agregar nota")


# ============================================================
# HISTORIAL DEL CLIENTE
# ============================================================
@router.get("/{id}/historial", response_model=List[dict])
async def historial_cliente(
    id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        rol = current_user.get("rol")
        if rol not in ["admin_sede", "super_admin", "estilista", "call_center", "recepcionista"]:
            raise HTTPException(403, "No autorizado")

        citas = await collection_citas.find({"cliente_id": id}).sort("fecha", -1).to_list(None)
        return [cita_to_dict(c) for c in citas]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error historial cliente: {e}")
        raise HTTPException(500, "Error al obtener historial")


# ============================================================
# OBTENER FICHAS DEL CLIENTE
# ============================================================
@router.get("/fichas/{cliente_id}", response_model=List[dict])
async def obtener_fichas_cliente(
    cliente_id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        rol = current_user.get("rol")

        if rol not in ["admin_sede", "super_admin", "estilista", "call_center", "recepcionista"]:
            raise HTTPException(403, "No autorizado")

        fichas = await collection_card.find(
            {"cliente_id": cliente_id}
        ).sort("fecha_ficha", -1).to_list(None)

        if not fichas:
            return []

        # Filtrar por sede para roles no super_admin
        """if rol in ["admin_sede", "estilista", "call_center", "recepcionista"]:
            sede_usuario = current_user.get("sede_id")
            fichas = [f for f in fichas if f.get("sede_id") == sede_usuario]"""

        resultado_final = []

        for ficha in fichas:
            ficha["_id"] = str(ficha["_id"])

            for campo in ["fecha_ficha", "fecha_reserva"]:
                if isinstance(ficha.get(campo), datetime):
                    ficha[campo] = ficha[campo].strftime("%Y-%m-%d")

            servicio_nombre = None
            servicio = await collection_servicios.find_one({"servicio_id": ficha.get("servicio_id")})
            if servicio:
                servicio_nombre = servicio.get("nombre")

            sede_nombre = None
            sede = await collection_locales.find_one({"sede_id": ficha.get("sede_id")})
            if sede:
                sede_nombre = sede.get("nombre_sede") or sede.get("nombre") or sede.get("local")

            profesional_id = ficha.get("profesional_id")
            estilista_nombre = "Desconocido"
            sede_estilista_nombre = "Desconocida"

            if profesional_id:
                estilista = await collection_estilista.find_one({"profesional_id": profesional_id})
                if estilista:
                    estilista_nombre = estilista.get("nombre")
                    est_sede_id = estilista.get("sede_id")
                    if est_sede_id:
                        sede_est = await collection_locales.find_one({"sede_id": est_sede_id})
                        if sede_est:
                            sede_estilista_nombre = (
                                sede_est.get("nombre_sede") or
                                sede_est.get("nombre") or
                                sede_est.get("local")
                            )

            resultado_final.append({
                **ficha,
                "servicio": servicio_nombre,
                "sede": sede_nombre,
                "estilista": estilista_nombre,
                "sede_estilista": sede_estilista_nombre,
            })

        return resultado_final

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error obteniendo fichas del cliente: {e}", exc_info=True)
        raise HTTPException(500, "Error al obtener fichas del cliente")


# ============================================================
# CLIENTES DE MI SEDE
# ============================================================
@router.get("/clientes/mi-sede", response_model=List[dict])
async def get_clientes_mi_sede(
    current_user: dict = Depends(get_current_user)
):
    sede_usuario = current_user.get("sede_id")
    if not sede_usuario:
        raise HTTPException(400, "El usuario autenticado no tiene una sede asignada")

    clientes_cursor = collection_clients.find({"sede_id": sede_usuario}, {"_id": 0})
    return await clientes_cursor.to_list(length=None)

# ─── ENDPOINT PUT ────────────────────────────────────────────────
@router.put("/{cliente_id}/calificacion", response_model=dict)
async def actualizar_calificacion_cliente(
    cliente_id: str,
    body: CalificacionRequest,
    current_user: dict = Depends(get_current_user)
):
    # Solo roles con acceso a gestión de clientes
    ROLES_PERMITIDOS = {"admin_sede", "super_admin", "recepcionista", "estilista", "call_center"}
    if current_user["rol"] not in ROLES_PERMITIDOS:
        raise HTTPException(status_code=403, detail="No tienes permisos para calificar clientes")

    cliente = await collection_clients.find_one({"cliente_id": cliente_id})
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    ahora = datetime.now()
    email_usuario = current_user.get("email")

    # Entrada para el historial
    entrada_historial = {
        "valor": body.calificacion,
        "fecha": ahora,
        "registrado_por": email_usuario,
        "cita_id": body.cita_id or None,
        "nota": body.nota or "",
    }

    await collection_clients.update_one(
        {"cliente_id": cliente_id},
        {
            "$set": {
                "calificacion": body.calificacion,
                "calificacion_actualizada_en": ahora,
                "calificacion_actualizada_por": email_usuario,
            },
            "$push": {
                "calificacion_historial": entrada_historial
            }
        }
    )

    nombre_cliente = f"{cliente.get('nombre', '')} {cliente.get('apellido', '')}".strip()
    print(f"⭐ Calificación '{body.calificacion}' asignada a {nombre_cliente} por {email_usuario}")

    return {
        "success": True,
        "message": f"Calificación actualizada correctamente",
        "data": {
            "cliente_id": cliente_id,
            "nombre": nombre_cliente,
            "calificacion_anterior": cliente.get("calificacion"),  # null si no tenía
            "calificacion_nueva": body.calificacion,
            "actualizado_por": email_usuario,
            "fecha": ahora.isoformat(),
        }
    }


# ─── ENDPOINT GET (para que el frontend cargue la calificación actual) ──
@router.get("/{cliente_id}/calificacion", response_model=dict)
async def obtener_calificacion_cliente(
    cliente_id: str,
    current_user: dict = Depends(get_current_user)
):
    cliente = await collection_clients.find_one(
        {"cliente_id": cliente_id},
        {"calificacion": 1, "calificacion_actualizada_en": 1,
         "calificacion_actualizada_por": 1, "nombre": 1, "apellido": 1}
    )
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    return {
        "cliente_id": cliente_id,
        "calificacion": cliente.get("calificacion"),          # None si nunca fue calificado
        "actualizada_en": cliente.get("calificacion_actualizada_en"),
        "actualizada_por": cliente.get("calificacion_actualizada_por"),
    }

async def calcular_analytics_cliente(cliente_id: str, hoy: datetime) -> dict | None:
    """
    Calcula todas las métricas de negocio para un cliente.
    Retorna None si no hay citas válidas.
    """
    pipeline = [
        {"$match": {
            "cliente_id": cliente_id,
            "valor_total": {"$gt": 0},
            "$or": [
                {"estado_pago": {"$in": ["pagado", "abonado"]}},
                {"estado": {"$in": ["completada", "finalizado"]}}
            ]
        }},
        {"$sort": {"fecha": 1}},
        {"$group": {
            "_id": "$cliente_id",
            "total_gastado":   {"$sum": "$valor_total"},
            "count":           {"$sum": 1},
            "ultima_visita":   {"$max": "$fecha"},
            "primera_visita":  {"$min": "$fecha"},
            "todas_las_fechas": {"$push": "$fecha"},
            # Gasto últimos 90 días vs 90 anteriores
            "gasto_reciente": {
                "$sum": {
                    "$cond": [
                        {"$gte": ["$fecha", (hoy - timedelta(days=90)).strftime("%Y-%m-%d")]},
                        "$valor_total", 0
                    ]
                }
            },
            "gasto_anterior": {
                "$sum": {
                    "$cond": [
                        {"$and": [
                            {"$gte": ["$fecha", (hoy - timedelta(days=180)).strftime("%Y-%m-%d")]},
                            {"$lt":  ["$fecha", (hoy - timedelta(days=90)).strftime("%Y-%m-%d")]}
                        ]},
                        "$valor_total", 0
                    ]
                }
            },
        }}
    ]

    stats = await collection_citas.aggregate(pipeline).to_list(1)
    if not stats:
        return None

    s = stats[0]
    count = s["count"]

    # ── Fechas ───────────────────────────────────────────────────────
    ultima_str   = str(s["ultima_visita"])[:10]
    primera_str  = str(s["primera_visita"])[:10]
    ultima_dt    = datetime.strptime(ultima_str, "%Y-%m-%d")
    primera_dt   = datetime.strptime(primera_str, "%Y-%m-%d")
    dias_sin_venir = max(0, (hoy - ultima_dt).days)

    # ── Frecuencia real (promedio de días entre visitas) ─────────────
    fechas_ordenadas = sorted(set(str(f)[:10] for f in s["todas_las_fechas"]))
    if len(fechas_ordenadas) >= 2:
        intervalos = []
        for i in range(1, len(fechas_ordenadas)):
            d1 = datetime.strptime(fechas_ordenadas[i-1], "%Y-%m-%d")
            d2 = datetime.strptime(fechas_ordenadas[i],   "%Y-%m-%d")
            diff = (d2 - d1).days
            if diff > 0:  # ignorar duplicados del mismo día
                intervalos.append(diff)
        frecuencia_dias = round(sum(intervalos) / len(intervalos)) if intervalos else None
    else:
        frecuencia_dias = None

    # ── Ticket promedio ───────────────────────────────────────────────
    ticket_promedio = round(s["total_gastado"] / count, 2)

    # ── LTV real proyectado ───────────────────────────────────────────
    # Si tenemos frecuencia: ticket × (365/frecuencia) × 3 años
    # Si no: ticket × 12 visitas/año × 3 años (asunción conservadora)
    # Solo proyectar si hay frecuencia real (mínimo 2 visitas con días distintos)
    if frecuencia_dias and frecuencia_dias > 0 and count >= 2:
        visitas_por_año = 365 / frecuencia_dias
        ltv_proyectado  = round(ticket_promedio * visitas_por_año * 3)
    else:
        # Sin datos suficientes: LTV = solo lo que ha pagado, sin proyección
        ltv_proyectado = round(s["total_gastado"], 2)

    # ── Tendencia de gasto ────────────────────────────────────────────────
    gasto_rec = s.get("gasto_reciente", 0)
    gasto_ant = s.get("gasto_anterior", 0)
    if gasto_ant > 0:
        tendencia_pct = round(((gasto_rec - gasto_ant) / gasto_ant) * 100)
    elif gasto_rec > 0:
        tendencia_pct = 100   # cliente nuevo con actividad reciente
    else:
        tendencia_pct = -100  # no ha gastado nada en 180 días

    # ── Churn: combinación de frecuencia + tendencia + días absolutos ─────
    if frecuencia_dias and frecuencia_dias > 0:
        umbral_churn = frecuencia_dias * 2      # antes era 1.5, ahora más holgado
        por_frecuencia = dias_sin_venir > umbral_churn
    else:
        por_frecuencia = dias_sin_venir > 60    # fallback sin frecuencia

    por_tendencia  = tendencia_pct <= -80       # gastó 80% menos o nada en 90d
    por_inactividad = dias_sin_venir > 180      # más de 6 meses sin aparecer

    en_riesgo = por_frecuencia or por_tendencia or por_inactividad

    # ── Score de retención ────────────────────────────────────────────────
    umbral_score = (frecuencia_dias * 2) if frecuencia_dias else 60
    score_ret = max(0, round(100 - (dias_sin_venir / umbral_score * 100)))
    # Penalizar si la tendencia es muy negativa
    if tendencia_pct <= -80:
        score_ret = min(score_ret, 30)

    # ── Segmento ──────────────────────────────────────────────────────────
    # Primero detectar si el cliente está perdido
    if dias_sin_venir > 180:
        segmento = "Perdido"
    elif dias_sin_venir > 120:
        segmento = "En riesgo"
    else:
        segmento = "Activo"
    return {
        # Valores guardados en DB
        "total_gastado":    round(s["total_gastado"], 2),
        "ticket_promedio":  ticket_promedio,
        "ltv_proyectado":   ltv_proyectado,
        "ultima_visita":    ultima_str,
        "primera_visita":   primera_str,
        "dias_sin_visitar": dias_sin_venir,
        "frecuencia_dias":  frecuencia_dias,      # promedio días entre visitas
        "total_visitas":    count,
        "tendencia_gasto":  tendencia_pct,        # % vs 90d anteriores
        "en_riesgo_churn":  en_riesgo,
        "segmento":         segmento,             # Nuevo/Regular/Premium/VIP
    }

@router.post("/admin/backfill-analytics", response_model=dict)
async def backfill_client_analytics(
    current_user: dict = Depends(get_current_user)
):
    if current_user["rol"] != "super_admin":
        raise HTTPException(403, "Solo super_admin")

    from pymongo import UpdateOne
    from datetime import timedelta

    hoy = datetime.now()
    hace_90  = (hoy - timedelta(days=90)).strftime("%Y-%m-%d")
    hace_180 = (hoy - timedelta(days=180)).strftime("%Y-%m-%d")

    pipeline = [
        {"$match": {
            "valor_total": {"$gt": 0},
            "$or": [
                {"estado_pago": {"$in": ["pagado", "abonado"]}},
                {"estado": {"$in": ["completada", "finalizado"]}}
            ]
        }},
        {"$group": {
            "_id": "$cliente_id",
            "total_gastado":    {"$sum": "$valor_total"},
            "count":            {"$sum": 1},
            "ultima_visita":    {"$max": "$fecha"},
            "primera_visita":   {"$min": "$fecha"},
            "todas_las_fechas": {"$push": "$fecha"},
            "gasto_reciente":   {"$sum": {"$cond": [{"$gte": ["$fecha", hace_90]}, "$valor_total", 0]}},
            "gasto_anterior":   {"$sum": {"$cond": [{"$and": [{"$gte": ["$fecha", hace_180]}, {"$lt": ["$fecha", hace_90]}]}, "$valor_total", 0]}},
        }}
    ]

    cursor = collection_citas.aggregate(pipeline, allowDiskUse=True)

    operaciones = []
    total_procesados = 0
    total_modificados = 0
    errores = 0
    BATCH = 500

    async for s in cursor:
        cliente_id = s["_id"]
        if not cliente_id or not s.get("ultima_visita"):
            continue

        try:
            ultima_str  = str(s["ultima_visita"])[:10]
            primera_str = str(s["primera_visita"])[:10]
            ultima_dt   = datetime.strptime(ultima_str, "%Y-%m-%d")
            dias_sin_venir = max(0, (hoy - ultima_dt).days)
            count = s["count"]

            # Frecuencia real
            fechas = sorted(set(str(f)[:10] for f in s["todas_las_fechas"]))
            intervalos = []
            for i in range(1, len(fechas)):
                d1 = datetime.strptime(fechas[i-1], "%Y-%m-%d")
                d2 = datetime.strptime(fechas[i],   "%Y-%m-%d")
                diff = (d2 - d1).days
                if diff > 0:
                    intervalos.append(diff)
            frecuencia_dias = round(sum(intervalos) / len(intervalos)) if intervalos else None

            ticket_promedio = round(s["total_gastado"] / count, 2)

            # LTV solo si hay frecuencia real con mínimo 2 visitas
            if frecuencia_dias and frecuencia_dias > 0 and count >= 2:
                ltv_proyectado = round(ticket_promedio * (365 / frecuencia_dias) * 3)
            else:
                ltv_proyectado = round(s["total_gastado"], 2)

            # Tendencia
            gasto_rec = s.get("gasto_reciente", 0)
            gasto_ant = s.get("gasto_anterior", 0)
            if gasto_ant > 0:
                tendencia_pct = round(((gasto_rec - gasto_ant) / gasto_ant) * 100)
            elif gasto_rec > 0:
                tendencia_pct = 100
            else:
                tendencia_pct = -100

            # Churn
            if frecuencia_dias and frecuencia_dias > 0:
                umbral_churn = frecuencia_dias * 2
                por_frecuencia = dias_sin_venir > umbral_churn
            else:
                por_frecuencia = dias_sin_venir > 60

            en_riesgo = (
                por_frecuencia or
                tendencia_pct <= -80 or
                dias_sin_venir > 180
            )

            # Segmento
            if dias_sin_venir > 180:
                segmento = "Perdido"
            elif dias_sin_venir > 120:
                segmento = "En riesgo"
            else:
                segmento = "Activo"

            operaciones.append(UpdateOne(
                {"cliente_id": cliente_id},
                {"$set": {
                    "total_gastado":    round(s["total_gastado"], 2),
                    "ticket_promedio":  ticket_promedio,
                    "ltv_proyectado":   ltv_proyectado,
                    "ultima_visita":    ultima_str,
                    "primera_visita":   primera_str,
                    "dias_sin_visitar": dias_sin_venir,
                    "frecuencia_dias":  frecuencia_dias,
                    "total_visitas":    count,
                    "en_riesgo_churn":  en_riesgo,
                    "segmento":         segmento,
                    # tendencia la guardamos pero no la exponemos en API aún
                    "tendencia_gasto":  tendencia_pct,
                }}
            ))
            total_procesados += 1

        except Exception as e:
            logger.warning(f"Backfill skip {cliente_id}: {e}")
            errores += 1
            continue

        if len(operaciones) >= BATCH:
            res = await collection_clients.bulk_write(operaciones, ordered=False)
            total_modificados += res.modified_count
            operaciones = []

    if operaciones:
        res = await collection_clients.bulk_write(operaciones, ordered=False)
        total_modificados += res.modified_count

    return {
        "success": True,
        "procesados": total_procesados,
        "modificados": total_modificados,
        "errores": errores
    }