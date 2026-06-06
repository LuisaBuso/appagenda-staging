import { API_BASE_URL } from "../../../../types/config";
import { formatCurrencyNoDecimals, getStoredCurrency, resolveCurrencyLocale } from "../../../../lib/currency";
import { parseDateToDate, toBackendDate, toDMY, toLocalYMD } from "../../../../lib/dateFormat";

// Interfaces para el dashboard de ventas (financiero)
export interface VentasMetricas {
  ventas_totales: number;
  cantidad_ventas: number;
  ventas_servicios: number;
  ventas_productos: number;
  metodos_pago: {
    efectivo: number;
    transferencia: number;
    tarjeta?: number;
    tarjeta_credito?: number;
    tarjeta_debito?: number;
    addi?: number;
    sin_pago?: number;
    otros?: number;
  };
  ticket_promedio: number;
  crecimiento_ventas: string;
}

export interface VentasDashboardResponse {
  success: boolean;
  descripcion: string;
  range?: {
    start: string;
    end: string;
    dias: number;
  };
  usuario?: {
    sede_asignada: string;
    nombre_sede: string;
  };
  metricas_por_moneda: {
    [key: string]: VentasMetricas;
  };
  debug_info?: any;
}

// Interfaces para el dashboard de clientes (existente)
export interface ChurnCliente {
  cliente_id: string;
  nombre: string;
  correo: string;
  telefono: string;
  sede_id: string;
  ultima_visita: string;
  dias_inactivo: number;
}

export interface ChurnResponse {
  total_churn: number;
  parametros: {
    sede_id: string;
    rango_fechas: string;
    dias_churn: number;
  };
  clientes: ChurnCliente[];
}

export interface KPI {
  valor: number | string;
  crecimiento: string | number;
}

export interface TicketPromedioKPI {
  COP?: {
    valor: number;
    citas: number;
    crecimiento: string;
  };
  valor?: number | string;
  crecimiento?: string | number;
}

export interface DashboardResponse {
  success: boolean;
  usuario: {
    username: string | null;
    rol: string;
    sede_asignada: string | null;
  };
  period: string;
  range: {
    start: string;
    end: string;
    dias: number;
  };
  sede_id: string;
  kpis: {
    nuevos_clientes: KPI;
    tasa_recurrencia: KPI;
    tasa_churn: KPI;
    ticket_promedio: TicketPromedioKPI;
    debug_info?: {
      total_clientes: number;
      clientes_nuevos: number;
      clientes_recurrentes: number;
      total_citas: number;
    };
  };
  churn_actual: number;
  calidad_datos: string;
  advertencias: Array<{
    tipo: string;
    severidad: string;
    mensaje: string;
    recomendacion: string;
  }>;
}

export interface PeriodOption {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
  min_days: number;
}

export interface PeriodsResponse {
  periods: PeriodOption[];
  default: string;
  recommendations: {
    minimum: string;
    optimal: string;
    avoid: string[];
  };
}

export interface Sede {
  _id: string;
  nombre: string;
  direccion: string;
  informacion_adicional: string;
  zona_horaria: string;
  telefono: string;
  email: string;
  sede_id: string;
  pais?: string;
  moneda?: string;
  es_internacional?: boolean;
  fecha_creacion: string;
  creado_por: string;
  activa: boolean;
}

// ============ API FUNCTIONS PARA VENTAS ============

/**
 * Obtiene el dashboard de ventas financiero
 */
export async function getVentasDashboard(
  token: string,
  params: {
    period?: string;
    start_date?: string;
    end_date?: string;
    sede_id?: string;
  }
): Promise<VentasDashboardResponse> {
  const queryParams = new URLSearchParams();
  const toSalesDashboardDate = (value?: string) => {
    if (!value) return "";
    const parsed = parseDateToDate(value);
    return parsed ? toDMY(parsed) : value;
  };

  if (params.period) queryParams.append('period', params.period);
  if (params.sede_id) queryParams.append('sede_id', params.sede_id);
  // ⚠️ Backend de ventas exige formato DD-MM-YYYY para fechas custom
  if (params.start_date) queryParams.append('start_date', toSalesDashboardDate(params.start_date));
  if (params.end_date) queryParams.append('end_date', toSalesDashboardDate(params.end_date));

  const url = `${API_BASE_URL}api/sales-dashboard/ventas/dashboard?${queryParams.toString()}`;
  console.log('Fetching ventas dashboard from:', url);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      `Error al obtener dashboard de ventas: ${response.status} ${response.statusText} - ${errorData?.detail || 'Sin detalles'}`
    );
  }

  const rawResponse = await response.clone().text();
  console.log("📥 [VentasDashboard][raw response]:", rawResponse);

  const parsedResponse = await response.json();
  console.log("📥 [VentasDashboard][parsed response]:", parsedResponse);

  return parsedResponse;
}

// ============ API FUNCTIONS PARA CLIENTES ============

/**
 * Obtiene el dashboard de clientes (compatible con períodos standard y custom)
 */
export async function getDashboard(
  token: string,
  params: {
    period?: string;
    sede_id?: string;
    start_date?: string;
    end_date?: string;
  }
): Promise<DashboardResponse> {
  const queryParams = new URLSearchParams();

  // Manejar diferentes tipos de parámetros
  if (params.period && params.period !== "custom") {
    // Período standard
    queryParams.append('period', params.period);
  } else if (params.start_date && params.end_date) {
    // Rango personalizado
    queryParams.append('start_date', toBackendDate(params.start_date));
    queryParams.append('end_date', toBackendDate(params.end_date));
  } else if (params.period === "custom") {
    // Si es custom pero no hay fechas, usar un rango por defecto
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    queryParams.append('start_date', toBackendDate(toLocalYMD(thirtyDaysAgo)));
    queryParams.append('end_date', toBackendDate(toLocalYMD(today)));
  }

  if (params.sede_id) queryParams.append('sede_id', params.sede_id);

  const url = `${API_BASE_URL}analytics/dashboard?${queryParams.toString()}`;
  console.log('Fetching analytics dashboard from:', url);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(`Error al obtener dashboard: ${response.status} ${response.statusText} - ${errorData?.detail || 'Sin detalles'}`);
  }

  const rawResponse = await response.clone().text();
  console.log("📥 [AnalyticsDashboard][raw response]:", rawResponse);

  const parsedResponse = await response.json();
  console.log("📥 [AnalyticsDashboard][parsed response]:", parsedResponse);

  return parsedResponse;
}

/**
 * Obtiene períodos disponibles para el dashboard de clientes
 */
export async function getAvailablePeriods(): Promise<PeriodsResponse> {
  const response = await fetch(`${API_BASE_URL}analytics/dashboard/periods`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Error al obtener períodos: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Obtiene clientes con churn
 */
export async function getChurnClientes(
  token: string,
  params?: {
    sede_id?: string;
    start_date?: string;
    end_date?: string;
  }
): Promise<ChurnResponse> {
  const queryParams = new URLSearchParams();

  queryParams.append('export', 'false');

  if (params?.sede_id) queryParams.append('sede_id', params.sede_id);
  if (params?.start_date) queryParams.append('start_date', toBackendDate(params.start_date));
  if (params?.end_date) queryParams.append('end_date', toBackendDate(params.end_date));

  const url = `${API_BASE_URL}analytics/churn-clientes?${queryParams.toString()}`;
  console.log('Fetching churn data from:', url);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Churn API error:', errorText);
    throw new Error(`Error al obtener churn: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Obtiene sedes disponibles
 */
export async function getSedes(
  token: string,
  activa: boolean = true
): Promise<Sede[]> {
  const response = await fetch(`${API_BASE_URL}admin/locales/?activa=${activa}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Sedes API error:', errorText);
    throw new Error(`Error al obtener sedes: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ============ FUNCIÓN HELPER ============

/**
 * Helper para formatear moneda
 */
export function formatCurrency(amount: number, currency: string = getStoredCurrency("USD")): string {
  return formatCurrencyNoDecimals(amount, currency, resolveCurrencyLocale(currency, "en-US"));
}

/**
 * Helper para calcular cambios porcentuales
 */
export function calculateGrowth(current: number, previous: number): string {
  if (previous === 0) {
    return current > 0 ? '+100.0%' : '0.0%';
  }

  const change = ((current - previous) / Math.abs(previous)) * 100;
  const sign = change >= 0 ? '+' : '';

  return `${sign}${change.toFixed(1)}%`;
}
