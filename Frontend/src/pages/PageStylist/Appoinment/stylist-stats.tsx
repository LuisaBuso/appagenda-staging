// src/components/StylistStats.tsx - VERSIÓN CORREGIDA
"use client";

interface StylistStatsProps {
  citasHoy: number;
  serviciosCompletadosHoy: number;
  totalVentasHoy: number;
  bloqueosHoy?: number;
  comisionServiciosPct?: number | null;
  comisionProductosPct?: number | null;
  /** Suma de item.comision del día, calculada directamente desde facturas (fuente canónica). */
  comisionesTotalesHoy?: number | null;
}

export function StylistStats({
  totalVentasHoy,
  comisionServiciosPct,
  comisionProductosPct,
  comisionesTotalesHoy,
}: StylistStatsProps) {
  // Si el backend ya envía el total de comisiones como valor absoluto en las facturas,
  // se usa ese dato directamente (idéntico a lo que muestra Reportes).
  // Si no llega, se calcula desde el porcentaje configurado en el perfil.
  // Nunca se asume un porcentaje arbitrario.
  let totalComisiones: number;
  let fuenteComision: "facturas" | "porcentaje" | "sin-datos";

  if (typeof comisionesTotalesHoy === "number" && Number.isFinite(comisionesTotalesHoy)) {
    totalComisiones = comisionesTotalesHoy;
    fuenteComision = "facturas";
  } else if (typeof comisionServiciosPct === "number") {
    const pctServicios = comisionServiciosPct / 100;
    const pctProductos = typeof comisionProductosPct === "number" ? comisionProductosPct / 100 : 0;
    totalComisiones = totalVentasHoy * pctServicios + 0 * pctProductos;
    fuenteComision = "porcentaje";
  } else {
    totalComisiones = 0;
    fuenteComision = "sin-datos";
  }

  // Función para formatear moneda
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* COMISIONES */}
      <div className="rounded-lg border border-gray-300 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Mis comisiones</h3>

        {/* Bloque de productos (oculto a pedido del usuario) */}

        {/* Total comisiones */}
        <div className="border-t border-gray-400 pt-3 mt-3">
          <div className="flex justify-between items-center">
            <div>
              <span className="font-bold text-gray-900">Total comisiones</span>
              <div className="text-xs text-gray-700 mt-1">
                {fuenteComision === "facturas"
                  ? "Hoy · Desde facturas"
                  : fuenteComision === "porcentaje"
                  ? "Hoy · Estimado desde porcentaje"
                  : "Hoy · Sin datos disponibles"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold text-gray-900">
                {fuenteComision === "sin-datos" ? "—" : formatCurrency(totalComisiones)}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Disponible para pago
              </div>
            </div>
          </div>
        </div>

        {/* Información adicional */}
        {/* Información adicional de ventas de productos oculta a solicitud */}
      </div>
    </div>
  )
}
