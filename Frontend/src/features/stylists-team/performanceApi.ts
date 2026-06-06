import { API_BASE_URL } from "../../types/config";
import { toBackendDate } from "../../lib/dateFormat";

export type PerformanceKpi = {
  ingresos_generados: number | null;
  comision_proyectada: number | null;
  ticket_promedio: number | null;
  tasa_ocupacion_pct: number | null;
  minutos_agendados?: number | null;
  horas_agendadas?: number | null;
  minutos_disponibles?: number | null;
  horas_disponibles?: number | null;
};

export type PerformanceCitas = {
  total: number;
  activas: number;
  por_estado?: Record<string, number>;
};

export type PerformanceProfessional = {
  profesional_id: string;
  nombre: string;
  sede_id?: string;
  sede_nombre?: string;
  kpis?: PerformanceKpi;
  citas?: PerformanceCitas;
};

export type PerformancePeriod = {
  desde: string;
  hasta: string;
  dias: number;
};

export type PerformanceResponse = {
  periodo?: PerformancePeriod;
  resumen_global?: {
    total_ingresos: number;
    total_comision: number;
    ticket_promedio_global: number;
    total_citas: number;
    total_citas_activas?: number;
    total_profesionales: number;
    moneda?: string;
  };
  profesionales: PerformanceProfessional[];
};

export async function fetchPerformanceAnalytics(params: {
  token: string;
  fechaDesde: string;
  fechaHasta: string;
  sedeId?: string;
  profesionalId?: string;
}): Promise<PerformanceResponse> {
  const query = new URLSearchParams();

  if (params.fechaDesde) {
    query.append("fecha_desde", toBackendDate(params.fechaDesde));
  }

  if (params.fechaHasta) {
    query.append("fecha_hasta", toBackendDate(params.fechaHasta));
  }

  if (params.sedeId) {
    query.append("sede_id", params.sedeId);
  }

  if (params.profesionalId) {
    query.append("profesional_id", params.profesionalId);
  }

  const qs = query.toString();
  const url = `${API_BASE_URL}analytics/performance${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${params.token}`,
    },
  });

  if (!response.ok) {
    const detail =
      (await response
        .json()
        .catch(async () => ({ detail: await response.text() })))?.detail || "";

    throw new Error(
      detail ? `Performance API: ${detail}` : `Error ${response.status} al cargar performance`,
    );
  }

  return response.json();
}
