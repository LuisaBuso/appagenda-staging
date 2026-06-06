import type { InventoryProduct } from "../../PageSede/Billing/directSalesApi";
import type { Factura } from "../../../types/factura";
import type {
  DashboardResponse,
  KPI,
  Sede,
  VentasDashboardResponse,
  VentasMetricas,
} from "./Api/analyticsApi";
import { normalizeCurrencyCode } from "../../../lib/currency";
import { parseDateToDate, toLocalYMD } from "../../../lib/dateFormat";

export type DashboardPeriod = "today" | "last_7_days" | "last_30_days" | "month" | "custom";

export interface DateRange {
  start_date: string;
  end_date: string;
}

export interface DashboardRequestParams {
  period?: string;
  start_date?: string;
  end_date?: string;
}

export interface GlobalDashboardSedeData {
  sede: Sede;
  ventas: VentasDashboardResponse | null;
  analytics: DashboardResponse | null;
  facturas: Factura[];
  slowFacturas: Factura[];
}

export interface SummaryMetrics {
  activeCurrency: string;
  availableCurrencies: string[];
  ventasTotales: number;
  transacciones: number;
  ventasServicios: number;
  ventasProductos: number;
  ticketPromedio: number;
  serviciosShare: number;
  productosShare: number;
}

export interface FranchiseRow {
  sedeId: string;
  sede: string;
  currency: string;
  ventasTotales: number;
  citasRealizadas: number;
  ventasProductos: number;
  ticketPromedio: number;
  clientesAtendidos: number;
  isPartial: boolean;
}

export interface ProductRow {
  productId: string;
  producto: string;
  unidades: number;
  ventas: number;
  participacion: number;
  currency: string;
}

export interface SlowMoverRow {
  productId: string;
  producto: string;
  ventas30Dias: number;
  ultimaVenta: string | null;
  ultimaVentaConocida: boolean;
}

const PRODUCT_ITEM_TYPES = new Set(["producto", "productos", "product"]);
const SERVICE_ITEM_TYPES = new Set(["servicio", "servicios", "service"]);

const createEmptyMetricas = (): VentasMetricas => ({
  ventas_totales: 0,
  cantidad_ventas: 0,
  ventas_servicios: 0,
  ventas_productos: 0,
  metodos_pago: {
    efectivo: 0,
    transferencia: 0,
    tarjeta: 0,
    tarjeta_credito: 0,
    tarjeta_debito: 0,
    addi: 0,
    sin_pago: 0,
    otros: 0,
  },
  ticket_promedio: 0,
  crecimiento_ventas: "0%",
});

const cloneEmptyMetricas = (): VentasMetricas => createEmptyMetricas();

const normalizeItemType = (value?: string | null) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const getFacturaDate = (factura: Factura): Date | null => {
  return (
    parseDateToDate(factura.fecha_comprobante) ||
    parseDateToDate(factura.fecha_pago) ||
    null
  );
};

const getUniqueClientCount = (facturas: Factura[]) => {
  const clientIds = new Set<string>();

  facturas.forEach((factura) => {
    const clienteId = String(factura.cliente_id || "").trim();
    const clienteNombre = String(factura.nombre_cliente || "").trim();
    if (clienteId) {
      clientIds.add(clienteId);
      return;
    }
    if (clienteNombre) {
      clientIds.add(`name:${clienteNombre.toLowerCase()}`);
    }
  });

  return clientIds.size;
};

const getServiceInvoiceCount = (facturas: Factura[]) => {
  return facturas.filter((factura) =>
    Array.isArray(factura.items)
      ? factura.items.some((item) => SERVICE_ITEM_TYPES.has(normalizeItemType(item.tipo)))
      : false
  ).length;
};

const aggregateFacturasByCurrency = (facturas: Factura[]) => {
  const aggregatedByCurrency: Record<string, VentasMetricas> = {};

  facturas.forEach((factura) => {
    const currency = normalizeCurrencyCode(factura.moneda);

    if (!aggregatedByCurrency[currency]) {
      aggregatedByCurrency[currency] = cloneEmptyMetricas();
    }

    const target = aggregatedByCurrency[currency];
    const facturaTotal = Number(factura.total ?? factura.monto ?? 0) || 0;

    target.ventas_totales += facturaTotal;
    target.cantidad_ventas += 1;

    (factura.items || []).forEach((item) => {
      const subtotal = Number(item.subtotal) || 0;
      const itemType = normalizeItemType(item.tipo);

      if (SERVICE_ITEM_TYPES.has(itemType)) {
        target.ventas_servicios += subtotal;
        return;
      }

      if (PRODUCT_ITEM_TYPES.has(itemType)) {
        target.ventas_productos += subtotal;
      }
    });
  });

  Object.values(aggregatedByCurrency).forEach((metricas) => {
    metricas.ticket_promedio =
      metricas.cantidad_ventas > 0 ? metricas.ventas_totales / metricas.cantidad_ventas : 0;
  });

  return aggregatedByCurrency;
};

const getSedeMetricasByCurrency = (sedeData: GlobalDashboardSedeData) => {
  const salesMetricas = sedeData.ventas?.metricas_por_moneda;
  if (salesMetricas && Object.keys(salesMetricas).length > 0) {
    return salesMetricas;
  }

  return aggregateFacturasByCurrency(sedeData.facturas);
};

const buildCandidateCurrencies = (preferredCurrency: string, availableCurrencies: string[]) => {
  return Array.from(
    new Set(
      [preferredCurrency, "COP", "USD", "MXN", ...availableCurrencies]
        .map((currency) => normalizeCurrencyCode(currency))
        .filter(Boolean)
    )
  );
};

export const buildDashboardRequestParams = (
  period: string,
  dateRange: DateRange
): DashboardRequestParams => {
  if (period === "custom" && dateRange.start_date && dateRange.end_date) {
    return {
      period: "custom",
      start_date: dateRange.start_date,
      end_date: dateRange.end_date,
    };
  }

  if (period === "today") {
    return {
      period: "today",
    };
  }

  return {
    period,
  };
};

export const buildInvoiceDateRange = (
  period: string,
  dateRange: DateRange
): DateRange => {
  const today = new Date();
  const todayYmd = toLocalYMD(today);

  if (period === "custom" && dateRange.start_date && dateRange.end_date) {
    return {
      start_date: dateRange.start_date,
      end_date: dateRange.end_date,
    };
  }

  if (period === "last_7_days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return {
      start_date: toLocalYMD(start),
      end_date: todayYmd,
    };
  }

  if (period === "last_30_days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return {
      start_date: toLocalYMD(start),
      end_date: todayYmd,
    };
  }

  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      start_date: toLocalYMD(start),
      end_date: todayYmd,
    };
  }

  return {
    start_date: todayYmd,
    end_date: todayYmd,
  };
};

export const buildLast30DaysRange = (): DateRange => {
  return buildInvoiceDateRange("last_30_days", {
    start_date: "",
    end_date: "",
  });
};

export const rangeContainsRange = (outerRange: DateRange, innerRange: DateRange) => {
  if (!outerRange.start_date || !outerRange.end_date || !innerRange.start_date || !innerRange.end_date) {
    return false;
  }

  return (
    outerRange.start_date <= innerRange.start_date &&
    outerRange.end_date >= innerRange.end_date
  );
};

export const aggregateMetricasByCurrency = (
  responses: Array<VentasDashboardResponse | null | undefined>
) => {
  const aggregatedByCurrency: Record<string, VentasMetricas> = {};

  responses.forEach((response) => {
    const metricasPorMoneda = response?.metricas_por_moneda || {};
    Object.entries(metricasPorMoneda).forEach(([currency, metricas]) => {
      const normalizedCurrency = normalizeCurrencyCode(currency);

      if (!aggregatedByCurrency[normalizedCurrency]) {
        aggregatedByCurrency[normalizedCurrency] = createEmptyMetricas();
      }

      const target = aggregatedByCurrency[normalizedCurrency];
      target.ventas_totales += metricas.ventas_totales || 0;
      target.cantidad_ventas += metricas.cantidad_ventas || 0;
      target.ventas_servicios += metricas.ventas_servicios || 0;
      target.ventas_productos += metricas.ventas_productos || 0;
      target.metodos_pago.efectivo += metricas.metodos_pago?.efectivo || 0;
      target.metodos_pago.transferencia += metricas.metodos_pago?.transferencia || 0;
      target.metodos_pago.tarjeta = (target.metodos_pago.tarjeta || 0) + (metricas.metodos_pago?.tarjeta || 0);
      target.metodos_pago.tarjeta_credito =
        (target.metodos_pago.tarjeta_credito || 0) + (metricas.metodos_pago?.tarjeta_credito || 0);
      target.metodos_pago.tarjeta_debito =
        (target.metodos_pago.tarjeta_debito || 0) + (metricas.metodos_pago?.tarjeta_debito || 0);
      target.metodos_pago.addi = (target.metodos_pago.addi || 0) + (metricas.metodos_pago?.addi || 0);
      target.metodos_pago.sin_pago =
        (target.metodos_pago.sin_pago || 0) + (metricas.metodos_pago?.sin_pago || 0);
      target.metodos_pago.otros = (target.metodos_pago.otros || 0) + (metricas.metodos_pago?.otros || 0);
    });
  });

  Object.values(aggregatedByCurrency).forEach((metricas) => {
    metricas.ticket_promedio =
      metricas.cantidad_ventas > 0 ? metricas.ventas_totales / metricas.cantidad_ventas : 0;
    metricas.crecimiento_ventas = "0%";
  });

  return aggregatedByCurrency;
};

export const resolveActiveCurrency = (
  sedesData: GlobalDashboardSedeData[],
  preferredCurrency: string
) => {
  const aggregated = aggregateMetricasByCurrency(
    sedesData.map((item) => ({
      metricas_por_moneda: getSedeMetricasByCurrency(item),
    } as VentasDashboardResponse))
  );
  const availableCurrencies = Object.keys(aggregated).map((currency) =>
    normalizeCurrencyCode(currency)
  );
  const candidates = buildCandidateCurrencies(preferredCurrency, availableCurrencies);

  for (const candidate of candidates) {
    if (aggregated[candidate]) {
      return candidate;
    }
  }

  if (availableCurrencies.length > 0) {
    return availableCurrencies[0];
  }

  const invoiceCurrencies = Array.from(
    new Set(
      sedesData
        .flatMap((item) => item.facturas.map((factura) => normalizeCurrencyCode(factura.moneda)))
        .filter(Boolean)
    )
  );

  for (const candidate of buildCandidateCurrencies(preferredCurrency, invoiceCurrencies)) {
    if (invoiceCurrencies.includes(candidate)) {
      return candidate;
    }
  }

  return normalizeCurrencyCode(preferredCurrency || "COP");
};

export const aggregateDashboardMetrics = (
  sedesData: GlobalDashboardSedeData[],
  preferredCurrency: string
): SummaryMetrics => {
  const aggregatedByCurrency = aggregateMetricasByCurrency(
    sedesData.map((item) => ({
      metricas_por_moneda: getSedeMetricasByCurrency(item),
    } as VentasDashboardResponse))
  );
  const availableCurrencies = Object.keys(aggregatedByCurrency).map((currency) =>
    normalizeCurrencyCode(currency)
  );
  const activeCurrency = resolveActiveCurrency(sedesData, preferredCurrency);
  const metricas = aggregatedByCurrency[activeCurrency] || createEmptyMetricas();

  const ventasTotales = metricas.ventas_totales || 0;
  const ventasServicios = metricas.ventas_servicios || 0;
  const ventasProductos = metricas.ventas_productos || 0;
  const transacciones = metricas.cantidad_ventas || 0;

  return {
    activeCurrency,
    availableCurrencies,
    ventasTotales,
    transacciones,
    ventasServicios,
    ventasProductos,
    ticketPromedio: metricas.ticket_promedio || 0,
    serviciosShare: ventasTotales > 0 ? (ventasServicios / ventasTotales) * 100 : 0,
    productosShare: ventasTotales > 0 ? (ventasProductos / ventasTotales) * 100 : 0,
  };
};

export const mapFranchiseRows = (
  sedesData: GlobalDashboardSedeData[],
  preferredCurrency: string
): FranchiseRow[] => {
  const activeCurrency = resolveActiveCurrency(sedesData, preferredCurrency);

  return sedesData
    .map((item) => {
      const metricasPorMoneda = getSedeMetricasByCurrency(item);
      const rowCurrencies = Object.keys(metricasPorMoneda).map((currency) =>
        normalizeCurrencyCode(currency)
      );
      const rowCurrency =
        rowCurrencies.includes(activeCurrency) ? activeCurrency : rowCurrencies[0] || activeCurrency;
      const metricas = metricasPorMoneda[rowCurrency];
      const analyticsDebug = item.analytics?.kpis?.debug_info;
      const citasRealizadas =
        analyticsDebug?.total_citas ?? getServiceInvoiceCount(item.facturas);
      const clientesAtendidos =
        analyticsDebug?.total_clientes ?? getUniqueClientCount(item.facturas);

      return {
        sedeId: item.sede.sede_id,
        sede: item.sede.nombre,
        currency: rowCurrency,
        ventasTotales: metricas?.ventas_totales || 0,
        citasRealizadas,
        ventasProductos: metricas?.ventas_productos || 0,
        ticketPromedio: metricas?.ticket_promedio || 0,
        clientesAtendidos,
        isPartial: !item.ventas || !item.analytics,
      };
    })
    .sort((a, b) => b.ventasTotales - a.ventasTotales);
};

export const mapProductsRows = (
  facturas: Factura[],
  currency: string
): ProductRow[] => {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const productMap = new Map<
    string,
    {
      productId: string;
      producto: string;
      unidades: number;
      ventas: number;
    }
  >();

  facturas
    .filter((factura) => normalizeCurrencyCode(factura.moneda) === normalizedCurrency)
    .forEach((factura) => {
      (factura.items || []).forEach((item) => {
        if (!PRODUCT_ITEM_TYPES.has(normalizeItemType(item.tipo))) return;

        const productId = String(item.producto_id || item.nombre || "").trim();
        if (!productId) return;

        const current = productMap.get(productId) || {
          productId,
          producto: item.nombre || "Producto",
          unidades: 0,
          ventas: 0,
        };

        current.unidades += Number(item.cantidad) || 0;
        current.ventas += Number(item.subtotal) || 0;
        if (!current.producto && item.nombre) {
          current.producto = item.nombre;
        }

        productMap.set(productId, current);
      });
    });

  const rows = Array.from(productMap.values()).sort((a, b) => {
    if (b.ventas !== a.ventas) return b.ventas - a.ventas;
    return b.unidades - a.unidades;
  });

  const totalVentasProductos = rows.reduce((sum, row) => sum + row.ventas, 0);

  return rows.map((row) => ({
    ...row,
    currency: normalizedCurrency,
    participacion: totalVentasProductos > 0 ? (row.ventas / totalVentasProductos) * 100 : 0,
  }));
};

export const mapSlowMoversRows = (
  productCatalog: InventoryProduct[],
  facturas: Factura[],
  currency: string
): SlowMoverRow[] => {
  // TODO: Backend debería exponer `ultima_venta` histórica por producto para no limitar
  // esta columna a la ventana de facturas cargada en frontend.
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const salesMap = new Map<
    string,
    {
      productId: string;
      producto: string;
      ventas30Dias: number;
      ultimaVenta: Date | null;
    }
  >();

  facturas
    .filter((factura) => normalizeCurrencyCode(factura.moneda) === normalizedCurrency)
    .forEach((factura) => {
      const facturaDate = getFacturaDate(factura);

      (factura.items || []).forEach((item) => {
        if (!PRODUCT_ITEM_TYPES.has(normalizeItemType(item.tipo))) return;

        const productId = String(item.producto_id || item.nombre || "").trim();
        if (!productId) return;

        const current = salesMap.get(productId) || {
          productId,
          producto: item.nombre || "Producto",
          ventas30Dias: 0,
          ultimaVenta: null,
        };

        current.ventas30Dias += Number(item.cantidad) || 0;
        if (facturaDate && (!current.ultimaVenta || facturaDate > current.ultimaVenta)) {
          current.ultimaVenta = facturaDate;
        }

        salesMap.set(productId, current);
      });
    });

  if (productCatalog.length > 0) {
    productCatalog.forEach((product) => {
      if (!salesMap.has(product.productId)) {
        salesMap.set(product.productId, {
          productId: product.productId,
          producto: product.name,
          ventas30Dias: 0,
          ultimaVenta: null,
        });
      }
    });
  }

  return Array.from(salesMap.values())
    .map((item) => ({
      productId: item.productId,
      producto: item.producto,
      ventas30Dias: item.ventas30Dias,
      ultimaVenta: item.ultimaVenta ? toLocalYMD(item.ultimaVenta) : null,
      ultimaVentaConocida: Boolean(item.ultimaVenta),
    }))
    .sort((a, b) => {
      if (a.ventas30Dias !== b.ventas30Dias) {
        return a.ventas30Dias - b.ventas30Dias;
      }

      if (!a.ultimaVenta && !b.ultimaVenta) {
        return a.producto.localeCompare(b.producto);
      }

      if (!a.ultimaVenta) return -1;
      if (!b.ultimaVenta) return 1;

      return a.ultimaVenta.localeCompare(b.ultimaVenta);
    });
};

export const getAnalyticsKpiValue = (kpi?: KPI | null) => {
  if (!kpi) return 0;
  if (typeof kpi.valor === "number") return kpi.valor;
  const value = Number(String(kpi.valor).replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(value) ? value : 0;
};
