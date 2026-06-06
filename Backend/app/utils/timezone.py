from datetime import datetime
from zoneinfo import ZoneInfo


def today(sede: dict) -> datetime:
    """
    Retorna datetime actual en la zona horaria de la sede.
    Requiere que sede.zona_horaria sea un valor IANA válido
    como 'America/Bogota', 'America/Guayaquil', 'America/Mexico_City'.
    """
    zona = sede.get("zona_horaria", "America/Bogota")
    return datetime.now(ZoneInfo(zona))


def today_str(sede: dict) -> str:
    """
    Retorna string 'YYYY-MM-DD HH:MM:SS' en la zona horaria de la sede.
    Úsalo para campos como fecha_creacion, fecha_modificacion, etc.
    """
    return today(sede).strftime("%Y-%m-%d %H:%M:%S")