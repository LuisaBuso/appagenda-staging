from fastapi import APIRouter

# Importa cada router con alias únicos
from app.inventary.submodulos.products.routes_products import router as product_router
from app.inventary.submodulos.exits.routes_exit import router as exits_router
from app.inventary.submodulos.orders.routes_orders import router as orders_router
from app.inventary.submodulos.inventarios.routes_inventarios import router as inventarios_router
from app.inventary.submodulos.entrances.routes_entrance import router as entradas_router
from app.inventary.submodulos.moves.routes_moves import router as movimientos_router

# Crea el router principal del módulo scheduling
app_router = APIRouter()

# Incluye cada submódulo con su propio prefijo
app_router.include_router(product_router, prefix="/product", tags=["Products"])
app_router.include_router(exits_router, prefix="/exit", tags=["Exits"])
app_router.include_router(orders_router, prefix="/orders", tags=["Orders"])
app_router.include_router(inventarios_router, prefix="/inventarios", tags=["Inventarios"])  # ✅ SIN /inventario/ extra
app_router.include_router(entradas_router, tags=["Entradas"])
app_router.include_router(movimientos_router, tags=["Movimientos"])