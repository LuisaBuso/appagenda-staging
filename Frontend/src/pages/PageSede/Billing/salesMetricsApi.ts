// src/services/salesMetricsApi.ts
import { API_BASE_URL } from "../../../types/config";
import {
  formatCurrencyNoDecimals,
  getStoredCurrency,
  normalizeCurrencyCode,
  resolveCurrencyLocale
} from "../../../lib/currency";
import { parseDateToDate, toDMY } from "../../../lib/dateFormat";

export interface MetodosPagoData {
  efectivo?: number;
  transferencia?: number;
  tarjeta?: number;
  tarjeta_credito?: number;
  tarjeta_debito?: number;
  sin_pago?: number;
  otros?: number;
  addi?: number;
  giftcard?: number;
  link_pago?: number;
  link_de_pago?: number;
  descuento_nomina?: number;
  descuento_por_nomina?: number;
  abono_transferencia?: number;
  abonos?: number;
}

export interface SalesMetricsData {
  ventas_totales: number;
  ventas_servicios: number;
  ventas_productos: number;
  cantidad_ventas?: number;
  ticket_promedio?: number;
  crecimiento_ventas?: string;
  abonos?: number;
  metodos_pago?: MetodosPagoData;
}

export interface PaymentMethodTotals {
  efectivo: number;
  transferencia: number;
  tarjeta: number;
  tarjeta_credito: number;
  tarjeta_debito: number;
  sin_pago: number;
  otros: number;
  addi: number;
  giftcard: number;
  link_de_pago: number;
  descuento_nomina: number;
  abono_transferencia: number;
}

export interface SalesMetricsResponse {
  success: boolean;
  tipo_dashboard: string;
  descripcion: string;
  usuario: {
    username: string | null;
    rol: string;
    sede_asignada: string;
  };
  period: string;
  range: {
    start: string;
    end: string;
    dias: number;
  };
  sede_id: string;
  moneda_sede: string; // 🆕 NUEVO: Moneda de la sede
  metricas_por_moneda: {
    [moneda: string]: SalesMetricsData; // 🆕 CAMBIADO: Ya no es solo USD, es dinámico
  };
  debug_info: {
    ventas_registradas: number;
  };
  calidad_datos: string;
}

/**
 * Obtiene métricas de ventas simplificadas
 */
export async function getSalesMetrics(
  token: string,
  params: {
    period?: string;
    start_date?: string;
    end_date?: string;
    sede_id?: string;
  }
): Promise<any> {
  const queryParams = new URLSearchParams();
  const toSalesDashboardDate = (value?: string) => {
    if (!value) return "";
    const parsed = parseDateToDate(value);
    return parsed ? toDMY(parsed) : value;
  };
  
  // Parámetros requeridos
  if (params.period) queryParams.append('period', params.period);
  if (params.sede_id) queryParams.append('sede_id', params.sede_id);
  
  // Parámetros para período custom
  // ⚠️ Endpoint financiero valida fechas DD-MM-YYYY
  if (params.start_date) queryParams.append('start_date', toSalesDashboardDate(params.start_date));
  if (params.end_date) queryParams.append('end_date', toSalesDashboardDate(params.end_date));

  const url = `${API_BASE_URL}api/sales-dashboard/ventas/dashboard?${queryParams.toString()}`;
  console.log('📡 Fetching sales metrics from:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error en respuesta de la API:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      
      // 🆕 CAMBIADO: Ya no retorna estructura con USD por defecto
      return {
        success: false,
        moneda_sede: null,
        metricas_por_moneda: {}
      };
    }

    const rawResponse = await response.clone().text();
    console.log("📥 [SalesMetrics][raw response]:", rawResponse);

    const data = await response.json();
    console.log("📥 [SalesMetrics][parsed response]:", data);
    return data;
  } catch (error) {
    console.error('❌ Error en fetch:', error);
    // 🆕 CAMBIADO: Estructura vacía sin asumir USD
    return {
      success: false,
      moneda_sede: null,
      metricas_por_moneda: {}
    };
  }
}

/**
 * 🆕 NUEVA FUNCIÓN: Extrae métricas usando la moneda correcta de la sede
 */
export function extractMainMetrics(data: SalesMetricsResponse): {
  ventas: number;
  servicios: number;
  productos: number;
  moneda: string;
} {
  const fallbackCurrency = normalizeCurrencyCode(getStoredCurrency("USD"));
  const moneda = normalizeCurrencyCode(data.moneda_sede || fallbackCurrency);
  const firstAvailableCurrency = Object.keys(data.metricas_por_moneda || {})[0];
  const metricas = data.metricas_por_moneda[moneda] ||
    (firstAvailableCurrency ? data.metricas_por_moneda[firstAvailableCurrency] : null) || {
    ventas_totales: 0,
    ventas_servicios: 0,
    ventas_productos: 0
  };
  
  return {
    ventas: metricas.ventas_totales,
    servicios: metricas.ventas_servicios,
    productos: metricas.ventas_productos,
    moneda: moneda
  };
}

/**
 * Extrae el desglose por método de pago desde la respuesta del dashboard.
 * Cada método se mapea directamente desde el campo correspondiente del backend.
 */
export function extractPaymentMethods(data: SalesMetricsResponse): PaymentMethodTotals {
  const fallbackCurrency = normalizeCurrencyCode(getStoredCurrency("USD"));
  const moneda = normalizeCurrencyCode(data.moneda_sede || fallbackCurrency);
  const firstAvailableCurrency = Object.keys(data.metricas_por_moneda || {})[0];
  const m: SalesMetricsData = data.metricas_por_moneda?.[moneda] ||
    (firstAvailableCurrency ? data.metricas_por_moneda[firstAvailableCurrency] : null) ||
    {} as SalesMetricsData;

  const n = (v: number | undefined) => (typeof v === "number" && isFinite(v) ? v : 0);
  const p = m.metodos_pago ?? {};

  return {
    efectivo:            n(p.efectivo),
    transferencia:       n(p.transferencia),
    tarjeta:             n(p.tarjeta),
    tarjeta_credito:     n(p.tarjeta_credito),
    tarjeta_debito:      n(p.tarjeta_debito),
    sin_pago:            n(p.sin_pago),
    otros:               n(p.otros),
    addi:                n(p.addi),
    giftcard:            n(p.giftcard),
    link_de_pago:        n(p.link_pago) + n(p.link_de_pago),
    descuento_nomina:    n(p.descuento_nomina) + n(p.descuento_por_nomina),
    abono_transferencia: n(p.abono_transferencia) + n(p.abonos),
  };
}

/**
 * Helper para formatear moneda
 * Formatea un número como moneda con formato es-CO
 */
export function formatCurrencyMetric(value: number, currency: string = getStoredCurrency("USD")): string {
  return formatCurrencyNoDecimals(value, currency, resolveCurrencyLocale(currency, "es-CO"));
}

/**
 * Formato de moneda corto para valores grandes
 * Ej: 1,500,000 → $1.5M
 */
export function formatCurrencyShort(value: number, currency: string = getStoredCurrency("USD")): string {
  const currencySymbol = getCurrencySymbol(currency);
  
  if (value >= 1000000) {
    return `${currencySymbol}${Math.round(value / 1000000)}M`;
  } else if (value >= 1000) {
    return `${currencySymbol}${Math.round(value / 1000)}K`;
  }
  return formatCurrencyMetric(value, currency);
}

/**
 * 🆕 NUEVA FUNCIÓN: Obtiene el símbolo de la moneda
 */
function getCurrencySymbol(currency: string): string {
  const symbols: { [key: string]: string } = {
    'USD': '$',
    'COP': '$',
    'MXN': '$',
    'EUR': '€',
    'PEN': 'S/',
    'ARS': '$'
  };
  return symbols[currency] || '$';
}
