from fastapi import APIRouter, HTTPException, Form, Depends, status
from datetime import datetime, timedelta
from typing import List, Optional
from bson import ObjectId
from fastapi import Cookie, Response, Header
from jose import jwt, JWTError
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import Response
from app.auth.controllers import (
    create_access_token,
    pwd_context,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    SECRET_KEY,
    ALGORITHM,
    REFRESH_TOKEN_EXPIRE_DAYS,
    create_refresh_token
)
from app.auth.models import TokenResponse, UserResponse, UserUpdate, UserUpdateResponse
from app.database.mongo import (
    collection_auth,
    collection_estilista,
    collection_admin_sede,
    collection_admin_franquicia
)

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


# ==============================================================
# ✅ Obtener usuario autenticado (con sede_id y franquicia_id)
# ==============================================================
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    x_sede_id: Optional[str] = Header(None)  # ← el frontend envía X-Sede-Id
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudieron validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        rol: str = payload.get("rol")

        if not email or not rol:
            raise credentials_exception

        user = await collection_auth.find_one({"correo_electronico": email})
        if not user:
            raise credentials_exception

        # ── Sede activa con scope dinámico ──────────────────────────────
        sede_id_principal = user.get("sede_id")
        sedes_permitidas  = user.get("sedes_permitidas", [])

        if x_sede_id:
            # super_admin puede pedir cualquier sede sin restricción
            es_super        = (rol == "super_admin")
            en_principal    = (x_sede_id == sede_id_principal)
            en_permitidas   = (x_sede_id in sedes_permitidas)

            if not (es_super or en_principal or en_permitidas):
                raise HTTPException(
                    status_code=403,
                    detail="No tienes acceso a esta sede"
                )
            sede_activa = x_sede_id
        else:
            # Sin header → usa la sede principal del usuario
            sede_activa = sede_id_principal

        return {
            "email": email,
            "rol": rol,
            "nombre": user.get("nombre"),
            "sede_id": sede_activa,               # ⭐ dinámica o principal
            "sede_id_principal": sede_id_principal, # ⭐ siempre la original
            "sedes_permitidas": sedes_permitidas,
            "franquicia_id": user.get("franquicia_id"),
            "user_id": str(user.get("_id")),
            "profesional_id": user.get("profesional_id"),
            "profesional_id_asociados": user.get("profesional_id_asociados", []),  # ← NUEVO
        }
    except JWTError:
        raise credentials_exception

# =========================================================
# 👤 CREATE NEW USER (only super_admin)
# =========================================================
@router.post("/register")
async def create_user(
    nombre: str = Form(...),
    correo_electronico: str = Form(...),
    password: str = Form(...),
    rol: str = Form(...),
    sede_id: str = Form(None),
    sedes_permitidas: List[str] = Form(None),  # ← NUEVO: array con sedes separadas por comas
    franquicia_id: str = Form(None),
    current_user: dict = Depends(get_current_user)
):
    # Solo super_admin y admin_sede pueden crear usuarios
    if current_user["rol"] not in ["super_admin", "admin_sede", "admin_franquicia"]:
        raise HTTPException(status_code=403, detail="No autorizado para crear usuarios")

    # Verificar rol válido
    valid_roles = ["super_admin", "admin_franquicia", "admin_sede", "estilista", "usuario", "recepcionista", "call_center"]
    if rol not in valid_roles:
        raise HTTPException(status_code=400, detail="Rol inválido")

    # 🔒 Forzar la sede según el creador
    if current_user["rol"] == "admin_sede":
        sede_id = current_user["sede_id"]  # 🚀 hereda automáticamente su sede
        franquicia_id = None
    elif current_user["rol"] == "admin_franquicia":
        franquicia_id = current_user["franquicia_id"]  # 🚀 hereda su franquicia
        sede_id = None
    elif current_user["rol"] == "super_admin":
        # super_admin puede especificar cualquier sede/franquicia o ninguna
        pass

    # ✅ TODOS los usuarios van a collection_auth
    collection = collection_auth

    # Validar duplicado
    existing_user = await collection.find_one({"correo_electronico": correo_electronico.lower()})
    if existing_user:
        raise HTTPException(status_code=400, detail="El usuario ya existe")

    # Encriptar contraseña
    hashed_password = pwd_context.hash(password)

    nuevo_usuario = {
        "nombre": nombre,
        "correo_electronico": correo_electronico.lower(),
        "hashed_password": hashed_password,
        "rol": rol,  # ⭐ ESTE ES EL ROL REAL que se usará en el login
        "sede_id": sede_id,
        "sedes_permitidas": sedes_permitidas or [],  # ← Convertir a lista
        "franquicia_id": franquicia_id,
        "fecha_creacion": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "activo": True,
        "creado_por": current_user["email"],
        "user_type": "staff" if rol == "estilista" else "system",
    }

    await collection.insert_one(nuevo_usuario)

    return {
        "msg": "✅ Usuario creado exitosamente",
        "rol": rol,
        "correo": correo_electronico,
        "sede_id": sede_id,
        "franquicia_id": franquicia_id,
        "creado_por": current_user["email"],
    }

# =========================================================
# 📋 LIST USERS (only super_admin)
# =========================================================
@router.get("/users", response_model=List[UserResponse])
async def list_users(
    rol: Optional[str] = None,
    activo: Optional[bool] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user["rol"] not in ["super_admin", "admin_sede", "recepcionista"]:
        raise HTTPException(status_code=403, detail="No autorizado")

    filtro = {}

    # ── Scope por rol ────────────────────────────────────────────────────
    if current_user["rol"] == "super_admin":
        pass  # ve todos, sin restricción de sede

    elif current_user["rol"] in ["admin_sede", "recepcionista"]:
        sede = current_user.get("sede_id")  # sede ACTIVA — no incluir sedes_permitidas del admin
        if not sede:
            raise HTTPException(status_code=400, detail="No tienes sede asignada")
    
        # Ver usuarios cuya sede principal es esta sede,
        # O que tienen esta sede en su sedes_permitidas (profesionales multi-sede)
        filtro["$or"] = [
            {"sede_id": sede},
            {"sedes_permitidas": sede}
        ]
    if rol:
        filtro["rol"] = rol
    if activo is not None:
        filtro["activo"] = activo

    usuarios = await collection_auth.find(filtro).to_list(length=None)

    return [
        UserResponse(
            id=str(u["_id"]),
            nombre=u.get("nombre", ""),
            correo_electronico=u.get("correo_electronico", ""),
            rol=u.get("rol", ""),
            profesional_id=u.get("profesional_id"),
            sede_id=u.get("sede_id"),
            franquicia_id=u.get("franquicia_id"),
            sedes_permitidas=u.get("sedes_permitidas", []),
            activo=u.get("activo", True),
            fecha_creacion=u.get("fecha_creacion"),
            creado_por=u.get("creado_por"),
        )
        for u in usuarios
    ]

# =========================================================
# 🔓 LOGIN AND TOKEN (LOGIN) - CORREGIDO PARA collection_auth
# =========================================================
@router.post("/token", response_model=TokenResponse)
async def login(
    response: Response,
    username: str = Form(...),
    password: str = Form(...),
):
    # Normaliza el correo
    email = username.strip().lower()
    print("📧 Intentando login con:", email)

    # ✅ BUSCAR SOLO EN collection_auth (donde están TODOS los usuarios)
    user = await collection_auth.find_one({"correo_electronico": email})
    
    if not user:
        print("❌ Usuario no encontrado en collection_auth:", email)
        raise HTTPException(status_code=400, detail="Usuario no encontrado")

    # ⭐ AGREGAR ESTO — verificar que está activo
    if not user.get("activo", True):
        raise HTTPException(status_code=403, detail="Usuario desactivado. Contacta al administrador")

    # Verificar contraseña
    try:
        if not pwd_context.verify(password, user["hashed_password"]):
            print("❌ Contraseña incorrecta para:", email)
            raise HTTPException(status_code=400, detail="Contraseña incorrecta")
    except Exception as e:
        print(f"⚠️ Error al verificar contraseña: {e}")
        raise HTTPException(status_code=500, detail="Error verificando contraseña")

    # ✅ OBTENER EL ROL REAL DEL USUARIO desde la base de datos
    rol_real = user.get("rol")
    if not rol_real:
        print("❌ Usuario no tiene rol asignado:", email)
        raise HTTPException(status_code=500, detail="Usuario sin rol asignado")

    print(f"✅ Login correcto para {email} con rol {rol_real}")

    # Crear tokens con el rol REAL de la base de datos
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    try:
        access_token = create_access_token(
            data={"sub": user["correo_electronico"], "rol": rol_real},  # ⭐ ROL REAL
            expires_delta=access_token_expires,
        )
        refresh_token = create_refresh_token(
            data={"sub": user["correo_electronico"], "rol": rol_real},  # ⭐ ROL REAL
            expires_delta=refresh_token_expires,
        )
    except Exception as e:
        print("⚠️ Error creando tokens:", e)
        raise HTTPException(status_code=500, detail="Error generando tokens")

    # Guardar refresh token en cookie HttpOnly
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=False,  # ⚠️ True si usas HTTPS
        samesite="None",
        max_age=int(refresh_token_expires.total_seconds()),
        path="/",
    )

    print("✅ Tokens generados y cookie configurada")

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        rol=rol_real,  # ⭐ ROL REAL del usuario
        nombre=user.get("nombre"),
        email=user.get("correo_electronico"),
        sede_id=user.get("sede_id"),
        sedes_permitidas=user.get("sedes_permitidas", []),  # ← NUEVO
        profesional_id=user.get("profesional_id"),
    )


# =========================================================
# 🔍 VALIDATE TOKEN
# =========================================================
@router.get("/validate_token")
async def validate_token(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return {"valid": True, "exp": payload.get("exp")}
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")

# =========================================================
# 🛠 CREATE INITIAL SUPER ADMIN (WITHOUT AUTHENTICATION)
# =========================================================
@router.post("/create-superadmin")
async def create_initial_superadmin(
    nombre: str = Form(...),
    correo_electronico: str = Form(...),
    password: str = Form(...)
):
    """
    Crea el primer usuario super_admin sin requerir autenticación.
    Si ya existe un super_admin, bloquea la creación.
    """

    # Verificar si ya existe un super_admin
    existing_admin = await collection_auth.find_one({"rol": "super_admin"})
    if existing_admin:
        raise HTTPException(
            status_code=400,
            detail="Ya existe un super_admin registrado. Usa /auth/token para iniciar sesión."
        )

    # Encriptar la contraseña
    hashed_password = pwd_context.hash(password)

    # Crear documento
    super_admin = {
        "nombre": nombre,
        "correo_electronico": correo_electronico.lower(),
        "hashed_password": hashed_password,
        "rol": "super_admin",  # ⭐ ROL EXPLÍCITO
        "franquicia_id": None,
        "sede_id": None,
        "fecha_creacion": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "activo": True,
        "user_type": "system",
    }

    # Insertar en la colección
    await collection_auth.insert_one(super_admin)

    return {
        "msg": "✅ Super admin creado exitosamente.",
        "correo": correo_electronico,
        "rol": "super_admin"
    }

# =========================================================
# ✏️ EDITAR USUARIO  PATCH /auth/users/{user_id}
# =========================================================

VALID_ROLES = ["super_admin", "admin_franquicia", "admin_sede", "estilista", "usuario", "recepcionista", "call_center"]


@router.patch("/users/{user_id}", response_model=UserUpdateResponse)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    current_user: dict = Depends(get_current_user),
):
    # ── 1. Validar que el user_id tiene formato válido ──────────────────
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="ID de usuario inválido")

    # ── 2. Obtener el usuario objetivo ──────────────────────────────────
    target = await collection_auth.find_one({"_id": ObjectId(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    editor_rol   = current_user["rol"]
    editor_id    = current_user["user_id"]
    target_rol   = target.get("rol")
    target_id    = str(target["_id"])

    # ── 3. Nadie puede editarse a sí mismo el rol ───────────────────────
    if editor_id == target_id and payload.rol and payload.rol != target_rol:
        raise HTTPException(
            status_code=403,
            detail="No puedes cambiar tu propio rol"
        )

    # ── 4. Permisos por rol del editor ──────────────────────────────────
    if editor_rol == "admin_sede":
        # Solo puede editar estilistas de su misma sede
        if target_rol not in ("estilista", "usuario", "recepcionista", "call_center"):
            raise HTTPException(
                status_code=403,
                detail="admin_sede solo puede editar estilistas y usuarios"
            )
        if str(target.get("sede_id")) != str(current_user["sede_id"]):
            raise HTTPException(
                status_code=403,
                detail="No tienes permiso sobre usuarios de otra sede"
            )
        # No puede cambiar roles privilegiados
        if payload.rol and payload.rol not in ("estilista", "usuario"):
            raise HTTPException(
                status_code=403,
                detail="No puedes asignar ese rol"
            )

    elif editor_rol == "admin_franquicia":
        # Solo puede editar admin_sede y estilistas de su franquicia
        if target_rol not in ("admin_sede", "estilista", "usuario"):
            raise HTTPException(
                status_code=403,
                detail="admin_franquicia solo puede editar admin_sede, estilistas y usuarios"
            )
        if str(target.get("franquicia_id")) != str(current_user["franquicia_id"]):
            raise HTTPException(
                status_code=403,
                detail="No tienes permiso sobre usuarios de otra franquicia"
            )
        # No puede promover a super_admin ni admin_franquicia
        if payload.rol and payload.rol not in ("admin_sede", "estilista", "usuario"):
            raise HTTPException(
                status_code=403,
                detail="No puedes asignar ese rol"
            )

    elif editor_rol != "super_admin":
        # Cualquier otro rol no autorizado
        raise HTTPException(status_code=403, detail="No autorizado")

    # ── 5. Nadie (ni super_admin) puede crear otro super_admin por este endpoint ──
    #       Para eso existe /create-superadmin (o se hace directo en DB)
    if payload.rol == "super_admin" and editor_rol != "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Solo un super_admin puede asignar el rol super_admin"
        )

    # ── 6. Validar rol si viene en el payload ───────────────────────────
    if payload.rol and payload.rol not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Rol inválido. Válidos: {VALID_ROLES}")

    # ── 7. Construir el dict de cambios ─────────────────────────────────
    # exclude_unset=True → SOLO los campos que el cliente realmente envió
    raw_changes = payload.model_dump(exclude_unset=True)

    if not raw_changes:
        raise HTTPException(status_code=400, detail="No se enviaron campos para actualizar")

    changes: dict = {}

    # Nombre
    if "nombre" in raw_changes:
        changes["nombre"] = raw_changes["nombre"].strip()

    # Correo (con validación de colisión)
    if "correo_electronico" in raw_changes:
        new_email = str(raw_changes["correo_electronico"]).lower()
        collision = await collection_auth.find_one({"correo_electronico": new_email})
        if collision and str(collision["_id"]) != target_id:
            raise HTTPException(status_code=400, detail="El correo ya está en uso")
        changes["correo_electronico"] = new_email

    # Rol (con validación)
    if "rol" in raw_changes:
        if raw_changes["rol"] not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Rol inválido. Válidos: {VALID_ROLES}")
        changes["rol"] = raw_changes["rol"]

    # sede_id — guarda exactamente lo que llegó (str, "" o None)
    if "sede_id" in raw_changes:
        changes["sede_id"] = raw_changes["sede_id"] if raw_changes["sede_id"] else None

    if "sedes_permitidas" in raw_changes:
        val = raw_changes["sedes_permitidas"]
        changes["sedes_permitidas"] = (
            [s.strip() for s in val if s and str(s).strip()]
            if val is not None else []
        )

    if "profesional_id_asociados" in raw_changes:
        val = raw_changes["profesional_id_asociados"]
        changes["profesional_id_asociados"] = (
            [s.strip() for s in val if s and str(s).strip()]
            if val is not None else []
        )

    # franquicia_id — igual
    if "franquicia_id" in raw_changes:
        changes["franquicia_id"] = raw_changes["franquicia_id"] if raw_changes["franquicia_id"] else None

    # Activo
    if "activo" in raw_changes:
        changes["activo"] = raw_changes["activo"]

    if "comision_productos" in raw_changes:
        val = raw_changes["comision_productos"]
        if val is not None and not (0 <= val <= 100):
            raise HTTPException(
                status_code=400,
                detail="comision_productos debe estar entre 0 y 100"
            )
        changes["comision_productos"] = val

    # Password
    if "password" in raw_changes:
        pwd = raw_changes["password"]
        if pwd:  # solo procesa si no es "" ni None
            if len(pwd) < 8:
                raise HTTPException(
                    status_code=400,
                    detail="La contraseña debe tener al menos 8 caracteres"
                )
            changes["hashed_password"] = pwd_context.hash(pwd)

    if not changes:
        raise HTTPException(status_code=400, detail="No se enviaron campos para actualizar")

    # ── 8. Metadatos de auditoría ────────────────────────────────────────
    changes["modificado_por"]       = current_user["email"]
    changes["fecha_modificacion"]   = datetime.now().strftime("%Y-%m-%d %H:%M")

    # ── 9. Aplicar cambios ───────────────────────────────────────────────
    await collection_auth.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": changes}
    )

    # ── 10. Devolver el documento actualizado ────────────────────────────
    updated = await collection_auth.find_one({"_id": ObjectId(user_id)})

    return UserUpdateResponse(
        id=str(updated["_id"]),
        nombre=updated.get("nombre", ""),
        correo_electronico=updated.get("correo_electronico", ""),
        rol=updated.get("rol", ""),
        sede_id=updated.get("sede_id"),
        sedes_permitidas=updated.get("sedes_permitidas", []),
        profesional_id_asociados=updated.get("profesional_id_asociados", []),  # ← NUEVO
        franquicia_id=updated.get("franquicia_id"),
        activo=updated.get("activo", True),
        modificado_por=changes["modificado_por"],
        fecha_modificacion=changes["fecha_modificacion"],
        comision_productos=updated.get("comision_productos"),
    )


# =========================================================
# 🔴 DESACTIVAR / ACTIVAR USUARIO  (shortcut)
# PATCH /auth/users/{user_id}/toggle-active
# =========================================================

@router.patch("/users/{user_id}/toggle-active")
async def toggle_user_active(
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Shortcut para activar/desactivar sin enviar todo el body."""
    if current_user["rol"] not in ("super_admin", "admin_franquicia", "admin_sede"):
        raise HTTPException(status_code=403, detail="No autorizado")

    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="ID inválido")

    target = await collection_auth.find_one({"_id": ObjectId(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Misma lógica de scope que arriba (simplificada)
    editor_rol = current_user["rol"]
    if editor_rol == "admin_sede" and str(target.get("sede_id")) != str(current_user["sede_id"]):
        raise HTTPException(status_code=403, detail="Fuera de tu sede")
    if editor_rol == "admin_franquicia" and str(target.get("franquicia_id")) != str(current_user["franquicia_id"]):
        raise HTTPException(status_code=403, detail="Fuera de tu franquicia")

    nuevo_estado = not target.get("activo", True)

    await collection_auth.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {
            "activo": nuevo_estado,
            "modificado_por": current_user["email"],
            "fecha_modificacion": datetime.now().strftime("%Y-%m-%d %H:%M"),
        }}
    )

    return {
        "msg": f"Usuario {'activado' if nuevo_estado else 'desactivado'} correctamente",
        "user_id": user_id,
        "activo": nuevo_estado,
    }


# =========================================================
# 🔑 CHANGE PASSWORD DIRECTLY (without token)
# =========================================================
@router.post("/change-password")
async def change_password(
    email: str = Form(...),
    new_password: str = Form(...),
    confirm_password: str = Form(...)
):
    email = email.lower()

    # Validar contraseñas coincidan
    if new_password != confirm_password:
        raise HTTPException(status_code=400, detail="Las contraseñas no coinciden")

    # ✅ BUSCAR SOLO EN collection_auth
    user = await collection_auth.find_one({"correo_electronico": email})
    
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Actualizar la contraseña
    hashed_password = pwd_context.hash(new_password)
    await collection_auth.update_one(
        {"_id": user["_id"]},
        {"$set": {"hashed_password": hashed_password}}
    )

    return {
        "msg": f"Contraseña actualizada correctamente para {email}",
        "rol": user.get("rol")
    }


# =========================================================
# 🔄 REFRESH TOKEN (renueva access_token)
# =========================================================
@router.post("/refresh", response_model=TokenResponse)
async def refresh_token_endpoint(response: Response, refresh_token: str = Cookie(None)):
    print("Refresh token recibido:", refresh_token)  # Debugging

    if not refresh_token:
        print("Error: No se encontró refresh token")  # Debugging
        raise HTTPException(status_code=401, detail="No se encontró refresh token")

    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        print("Payload decodificado:", payload)  # Debugging

        email: str = payload.get("sub")
        rol: str = payload.get("rol")

        if not email or not rol:
            print("Error: Token inválido, falta email o rol")  # Debugging
            raise HTTPException(status_code=401, detail="Token inválido")

        # ✅ VERIFICAR EN collection_auth
        user = await collection_auth.find_one({"correo_electronico": email})
        print("Usuario encontrado:", user)  # Debugging

        if not user or not user.get("activo", True):
            print("Error: Usuario no autorizado o inactivo")  # Debugging
            raise HTTPException(status_code=401, detail="Usuario no autorizado o inactivo")

        # 🔄 Renovar access token
        new_access_token = create_access_token(
            data={"sub": email, "rol": rol},
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        )
        print("Nuevo access token generado")  # Debugging

        # (Opcional) rotar refresh token
        new_refresh_token = create_refresh_token(
            data={"sub": email, "rol": rol},
            expires_delta=timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
        )
        print("Nuevo refresh token generado")  # Debugging

        response.set_cookie(
            key="refresh_token",
            value=new_refresh_token,
            httponly=True,
            secure=False,
            samesite="None",
            max_age=int(timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS).total_seconds())
        )
        print("Refresh token actualizado en la cookie")  # Debugging

        return TokenResponse(
            access_token=new_access_token,
            token_type="bearer",
            rol=rol,
            email=email,
            nombre=user.get("nombre"),
            sede_id=user.get("sede_id"),
            sedes_permitidas=user.get("sedes_permitidas", []),
            profesional_id=user.get("profesional_id"),   # ← AGREGAR ESTA LÍNEA
        )

    except JWTError as e:
        print("Error al decodificar el refresh token:", str(e))  # Debugging
        raise HTTPException(status_code=401, detail="Refresh token inválido o expirado")


# =========================================================
# 🚪 LOGOUT (borra refresh_token cookie)
# =========================================================
@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("refresh_token")
    return {"msg": "Sesión cerrada correctamente"}
