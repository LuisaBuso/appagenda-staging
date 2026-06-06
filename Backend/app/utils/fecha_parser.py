from datetime import datetime, timedelta
from fastapi import HTTPException


def parsear_fecha(fecha_str: str) -> datetime:
    """
    Acepta múltiples formatos para no rechazar al frontend:
      - YYYY-MM-DD        (como guarda la BD)
      - DD-MM-YYYY        (formato visual de calendarios colombianos)
      - YYYY-MM-DDTHH:MM:SS
      - DD/MM/YYYY
    """
    formatos = [
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%Y-%m-%dT%H:%M:%S",
        "%d/%m/%Y",
    ]
    for fmt in formatos:
        try:
            return datetime.strptime(fecha_str, fmt)
        except ValueError:
            continue
    raise HTTPException(
        status_code=400,
        detail=f"Formato de fecha inválido: '{fecha_str}'. Usa YYYY-MM-DD o DD-MM-YYYY"
    )


def resolver_rango(
    dias: int | None,
    fecha_desde: str | None,
    fecha_hasta: str | None,
) -> tuple[datetime, datetime]:
    """
    Prioridad:
      1. fecha_desde y/o fecha_hasta → rango personalizado exacto
      2. dias → ventana deslizante desde ahora
      3. ninguno → últimos 7 días
    """
    ahora = datetime.now()

    if fecha_desde or fecha_hasta:
        inicio = parsear_fecha(fecha_desde) if fecha_desde else ahora - timedelta(days=365)
        # fecha_hasta incluye todo el día final
        fin = parsear_fecha(fecha_hasta).replace(hour=23, minute=59, second=59) if fecha_hasta else ahora
        if inicio > fin:
            raise HTTPException(
                status_code=400,
                detail="fecha_desde no puede ser mayor que fecha_hasta"
            )
        return inicio, fin

    n = dias if dias is not None else 7
    return ahora - timedelta(days=n), ahora