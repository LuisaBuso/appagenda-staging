from fastapi import APIRouter

# Importa cada router con alias únicos
from app.scheduling.submodules.block.routes_block import router as block_router
from app.scheduling.submodules.schedules.routes_schedule import router as schedule_router
from app.scheduling.submodules.services.routes_services import router as services_router
from app.scheduling.submodules.quotes.routes_quotes import router as quotes_router

# Crea el router principal del módulo scheduling
app_router = APIRouter()

# Incluye cada submódulo con su propio prefijo
app_router.include_router(schedule_router, prefix="/schedule", tags=["schedule"])
app_router.include_router(block_router, prefix="/block", tags=["block"])
app_router.include_router(services_router, prefix="/services", tags=["services"])
app_router.include_router(quotes_router, prefix="/quotes", tags=["quotes"])
