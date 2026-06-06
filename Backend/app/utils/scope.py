# utils/scope.py

def get_profesional_ids(current_user: dict) -> list[str]:
    ids = []
    if pid := current_user.get("profesional_id"):
        ids.append(pid)
    ids.extend(current_user.get("profesional_id_asociados", []))
    return ids

def get_sedes_accesibles(current_user: dict) -> list[str]:
    rol = current_user["rol"]
    if rol == "super_admin":
        return []
    if rol in ["admin_sede", "recepcionista", "call_center"]:
        return [current_user["sede_id"]]
    if rol == "estilista":
        sedes = current_user.get("sedes_permitidas") or []
        if not sedes and current_user.get("sede_id"):
            return [current_user["sede_id"]]
        return sedes
    return []

# ← NUEVO
def expand_profesional_filter(profesional_id: str, current_user: dict):
    """
    Si el profesional_id pedido pertenece al usuario actual
    (canónico o asociado), retorna un filtro $in con todos sus IDs.
    Si no (un admin consultando a otro profesional), retorna el ID tal cual.
    """
    todos = get_profesional_ids(current_user)
    if profesional_id in todos and len(todos) > 1:
        return {"$in": todos}
    return profesional_id