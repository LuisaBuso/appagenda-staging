# from motor.motor_asyncio import AsyncIOMotorDatabase
# from auth import logger

# async def create_indexes(db: AsyncIOMotorDatabase):
#     # === CITAS ===
#     await db.citas.create_index(
#         [("estilista_id", 1), ("fecha_hora_inicio", 1)],
#         name="citas_estilista_fecha"
#     )
#     await db.citas.create_index([("cliente_id", 1)], name="citas_cliente")

#     # === HORARIOS ===
#     await db.horarios.create_index(
#         [("estilista_id", 1), ("dia_semana", 1)],
#         name="horarios_estilista_dia",
#         unique=True
#     )

#     # === BLOQUEOS ===
#     await db.bloqueos.create_index(
#         [("estilista_id", 1), ("es_recurrente", 1)],
#         name="bloqueos_recurrente"
#     )
#     await db.bloqueos.create_index(
#         [("estilista_id", 1), ("fecha_inicio", 1)],
#         name="bloqueos_fecha"
#     )

#     # === SERVICIOS ===
#     await db.servicios.create_index(
#         [("sede_id", 1), ("nombre", 1)],
#         name="servicios_sede_nombre",
#         unique=True
#     )

#     logger.info("Todos los índices creados correctamente")
