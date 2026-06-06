from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware  # Importa el middleware CORS
from contextlib import asynccontextmanager
from app.cash.scheduler import iniciar_scheduler, detener_scheduler
from dotenv import load_dotenv

# Importar routers de cada módulo
from app.auth.routes import router as auth_router
from app.clients_service import routes_clientes
from app.scheduling.routes import app_router as scheduling_router
from app.admin.routes_locales import router as admin_locales_router
from app.admin.routes_servicios import router as admin_servicios_router
from app.admin.routes_profesionales import router as admin_profesionales_router
from app.admin.routes_system_users import router as admin_system_users_router
#from app.analytics.routes_churn import router as churn_router
#from app.analytics.routes_analytics import router as analytics_router
#from app.analytics.routes_dashboard import router as dashboard_router
from app.inventary.routes import app_router as inventary_router
from app.bills.routes import router as billing_router
from app.analytics.projection_analytics import router as analytics_projection
from app.bills.routes_reporte import router as reporte_router
from app.bills.routes_transacciones import router as transacciones_router
from app.commissions.routes import router as commissions_router
from app.analytics.sales_dashboard import router as sales_dashboard_router
from app.clients_service.routes_analytics import router as analytics_router
from app.analytics.routes_gastos import router as gastos_router
from app.clients_service.generate_pdf import router as generate_pdf_router
from app.sales.routes import router as sales_router
from app.cash.routes_cash import router as cash_router
from app.giftcards.routes_giftcards import router as giftcards_router
from app.scheduling.submodules.fichas.routes_fichas import router as routes_fichas_router
from app.admin.routes_franquicias import router as admin_franquicias_router
from app.commissions.routes_comision_config import router as routes_comision_config_router
from app.analytics.finanzas_movimientos import router as finanzas_movimientos_router
# from app.database.indexes import create_indexes
from app.database.mongo import db  
# from app.database.indexes import create_indexes  

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://agenda.rizosfelices.co",
        "https://staging-agenda.rizosfelices.co",
        "https://previewapi.rizosfelices.co",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def read_root():
    return {"message": "Bienvenido a la API de Agenda"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await iniciar_scheduler()
    yield
    # Shutdown
    detener_scheduler()



# @app.on_event("startup")
# async def startup_event():
#     await create_indexes(db)
#     print("ÍNDICES CREADOS EN MONGODB")

# Incluir todos los routers
app.include_router(auth_router, prefix="/auth", tags=["Authentication"])
app.include_router(reporte_router, prefix="/api/reporte", tags=["Reporte"])
app.include_router(transacciones_router, tags=["Transacciones"])
app.include_router(scheduling_router, prefix="/scheduling")
app.include_router(admin_franquicias_router, prefix="/admin/franquicias", tags=["Franquicias"])
app.include_router(routes_fichas_router, prefix="/scheduling/quotes", tags=["Fichas"])
app.include_router(admin_locales_router)
app.include_router(admin_servicios_router)
app.include_router(admin_profesionales_router)
app.include_router(admin_system_users_router)
app.include_router(inventary_router, prefix="/inventary")
app.include_router(routes_comision_config_router)
#app.include_router(churn_router)
#app.include_router(analytics_router, prefix="/analytics", tags=["Analytics"])
#app.include_router(dashboard_router)
app.include_router(billing_router, prefix="/api/billing", tags=["Facturación"])
app.include_router(analytics_projection, prefix="/analytics", tags=["Analytics"])
app.include_router(analytics_router)
app.include_router(routes_clientes.router, prefix="/clientes", tags=["Clientes"])
app.include_router(gastos_router)
app.include_router(finanzas_movimientos_router)
app.include_router(commissions_router, prefix="/api/commissions", tags=["Comisiones"])
app.include_router(sales_dashboard_router, prefix="/api/sales-dashboard")
app.include_router(generate_pdf_router, prefix="/api/pdf", tags=["Generación de PDF"])
app.include_router(sales_router)
app.include_router(cash_router)
app.include_router(giftcards_router, prefix="/api/giftcards",tags=["Giftcards"])
