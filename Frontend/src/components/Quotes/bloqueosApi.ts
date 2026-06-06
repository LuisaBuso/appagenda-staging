// src/pages/Quotes/bloqueosApi.ts
import { API_BASE_URL } from "../../types/config";
import { formatLocalDate, parseDateToDate } from "../../lib/dateFormat";

export interface Bloqueo {
  _id?: string;
  profesional_id: string;
  sede_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  motivo: string;
  recurrente?: boolean;
  serie_id?: string | null;
  dias_semana?: number[];
  fecha_inicio_regla?: string | null;
  fecha_fin_regla?: string | null;
  creado_por?: string;
  fecha_creacion?: string;
}

export interface BloqueoCreatePayload {
  profesional_id: string;
  sede_id: string;
  hora_inicio: string;
  hora_fin: string;
  motivo: string;
  fecha?: string;
  recurrente?: boolean;
  dias_semana?: number[];
  fecha_inicio?: string;
  fecha_fin?: string;
}

export interface BloqueoUpdatePayload {
  hora_inicio?: string;
  hora_fin?: string;
  motivo?: string;
  fecha_fin_regla?: string;
  editar_serie?: boolean;
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null;

const normalizeIsoDate = (value: unknown): string => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalDate(value);
  }

  const raw = String(value).trim();
  if (!raw) return "";

  const parsed = parseDateToDate(raw);
  if (parsed) return formatLocalDate(parsed);

  return raw;
};

const normalizeTimeValue = (value: unknown): string => {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";

  const hhmmOrHhmmss = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmOrHhmmss) {
    const hours = Math.min(23, Math.max(0, Number(hhmmOrHhmmss[1])));
    const minutes = Math.min(59, Math.max(0, Number(hhmmOrHhmmss[2])));
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)$/i);
  if (ampm) {
    let hours = Number(ampm[1]);
    const minutes = ampm[2];
    const period = ampm[3].toLowerCase();
    if (period.startsWith("p") && hours < 12) hours += 12;
    if (period.startsWith("a") && hours === 12) hours = 0;
    return `${String(hours).padStart(2, "0")}:${minutes}`;
  }

  return raw;
};

const getDayFromIsoDate = (isoDate: string): number => {
  const [yearStr, monthStr, dayStr] = String(isoDate || "").split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!year || !month || !day) return 0;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getDay();
};

const normalizeDays = (days: unknown): number[] => {
  if (!Array.isArray(days)) return [];
  return days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6);
};

const toBloqueoUi = (raw: unknown): Bloqueo => {
  const item = isRecord(raw) ? raw : {};
  const repeat = isRecord(item.repeat) ? item.repeat : {};

  const fecha = normalizeIsoDate(item.fecha ?? item.start_date);
  const horaInicio = normalizeTimeValue(item.hora_inicio ?? item.start_time);
  const horaFin = normalizeTimeValue(item.hora_fin ?? item.end_time);
  const diasSemana = normalizeDays(item.dias_semana ?? repeat.days_of_week);
  const fechaInicioRegla = normalizeIsoDate(item.fecha_inicio_regla ?? item.start_date);
  const fechaFinRegla = normalizeIsoDate(item.fecha_fin_regla ?? repeat.until);
  const recurrenteNormalizado =
    typeof item.recurrente === "boolean"
      ? item.recurrente
      : Boolean(repeat.type && fechaInicioRegla && fechaFinRegla && fechaFinRegla > fechaInicioRegla);

  return {
    _id: typeof item._id === "string" ? item._id : undefined,
    profesional_id: String(item.profesional_id ?? ""),
    sede_id: String(item.sede_id ?? ""),
    fecha,
    hora_inicio: horaInicio,
    hora_fin: horaFin,
    motivo: String(item.motivo ?? "Bloqueo de agenda"),
    recurrente: recurrenteNormalizado,
    serie_id: typeof item.serie_id === "string" ? item.serie_id : null,
    dias_semana: diasSemana.length > 0 ? diasSemana : undefined,
    fecha_inicio_regla: fechaInicioRegla || null,
    fecha_fin_regla: fechaFinRegla || null,
    creado_por: typeof item.creado_por === "string" ? item.creado_por : undefined,
    fecha_creacion: typeof item.fecha_creacion === "string" ? item.fecha_creacion : undefined,
  };
};

const toBloqueoApiPayload = (data: BloqueoCreatePayload) => {
  const startDate = normalizeIsoDate(data.recurrente ? (data.fecha_inicio || data.fecha) : (data.fecha || data.fecha_inicio));
  const untilDate = normalizeIsoDate(data.recurrente ? (data.fecha_fin || startDate) : startDate);
  const providedDays = normalizeDays(data.dias_semana);
  const fallbackDay = getDayFromIsoDate(startDate);
  const daysOfWeek = providedDays.length > 0 ? providedDays : [fallbackDay];
  const horaInicio = normalizeTimeValue(data.hora_inicio);
  const horaFin = normalizeTimeValue(data.hora_fin);
  const motivo = data.motivo?.trim() || "Bloqueo de agenda";
  const payloadBase = {
    profesional_id: data.profesional_id,
    sede_id: data.sede_id,
    hora_inicio: horaInicio,
    hora_fin: horaFin,
    motivo,
  };

  if (!data.recurrente) {
    return {
      ...payloadBase,
      recurrente: false,
      fecha: startDate,
    };
  }

  return {
    ...payloadBase,
    recurrente: true,
    dias_semana: daysOfWeek,
    fecha_inicio: startDate,
    fecha_fin: untilDate || startDate,
  };
};

const toMessageFromDetail = (detail: unknown): string => {
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!isRecord(item)) return String(item);
        const loc = Array.isArray(item.loc) ? item.loc.join(".") : "";
        const msg = typeof item.msg === "string" ? item.msg : JSON.stringify(item);
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean);
    return messages.join(" | ");
  }

  if (typeof detail === "string") return detail;
  if (isRecord(detail)) return JSON.stringify(detail);
  return "";
};

const readApiError = async (res: Response, fallback: string): Promise<string> => {
  const base = `${fallback} (HTTP ${res.status})`;
  try {
    const errorData = await res.json();
    const detailMessage = toMessageFromDetail(errorData?.detail);
    if (detailMessage) return detailMessage;
    if (typeof errorData?.message === "string" && errorData.message.trim()) {
      return errorData.message;
    }
    return base;
  } catch {
    return base;
  }
};

// Obtener bloqueos de un profesional específico - CAMBIÉ EL NOMBRE DEL PARÁMETRO
export async function getBloqueosProfesional(profesional_id: string, token: string) {
  const res = await fetch(`${API_BASE_URL}scheduling/block/${profesional_id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Error al cargar bloqueos del profesional"));
  }
  const raw = await res.json();
  if (!Array.isArray(raw)) return [];
  return raw.map(toBloqueoUi);
}

// Mantén esta función por compatibilidad (pero internamente usa la nueva)
export async function getBloqueosEstilista(profesional_id: string, token: string) {
  return getBloqueosProfesional(profesional_id, token);
}

// Función para obtener TODOS los bloqueos de varios profesionales
export async function getBloqueosMultiplesProfesionales(profesional_ids: string[], token: string) {
  try {
    const promises = profesional_ids.map(id => 
      getBloqueosProfesional(id, token).catch(error => {
        console.error(`Error cargando bloqueos para profesional ${id}:`, error);
        return [];
      })
    );
    
    const resultados = await Promise.all(promises);
    return resultados.flat();
  } catch (error) {
    console.error('Error en getBloqueosMultiplesProfesionales:', error);
    return [];
  }
}

// Otras funciones se mantienen igual...
export async function getBloqueos(filtros: {
  profesional_id?: string;
  sede_id?: string;
  fecha?: string;
}, token: string) {
  try {
    if (filtros.profesional_id && !filtros.fecha) {
      return await getBloqueosProfesional(filtros.profesional_id, token);
    }
    
    const queryParams = new URLSearchParams();
    
    if (filtros.profesional_id) queryParams.append('profesional_id', filtros.profesional_id);
    if (filtros.sede_id) queryParams.append('sede_id', filtros.sede_id);
    if (filtros.fecha) queryParams.append('fecha', filtros.fecha);
    
    const queryString = queryParams.toString();
    const url = `${API_BASE_URL}scheduling/block${queryString ? `?${queryString}` : ''}`;
    
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    
    if (!res.ok) {
      throw new Error(await readApiError(res, "Error al cargar bloqueos"));
    }
    
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return raw.map(toBloqueoUi);
  } catch (error) {
    console.error('Error en getBloqueos:', error);
    throw error;
  }
}

export async function createBloqueo(data: BloqueoCreatePayload, token: string) {
  const payload = toBloqueoApiPayload(data);
  const res = await fetch(`${API_BASE_URL}scheduling/block/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Error al crear bloqueo"));
  }
  const raw = await res.json().catch(() => ({}));
  if (isRecord(raw) && "bloqueo" in raw) {
    return {
      ...raw,
      bloqueo: toBloqueoUi(raw.bloqueo),
    };
  }
  if (isRecord(raw) && Array.isArray(raw.bloqueos)) {
    return {
      ...raw,
      bloqueos: raw.bloqueos.map(toBloqueoUi),
    };
  }
  if (isRecord(raw)) {
    return toBloqueoUi(raw);
  }
  return toBloqueoUi(raw);
}

export async function updateBloqueo(id: string, data: BloqueoUpdatePayload, token: string) {
  const url = `${API_BASE_URL}scheduling/block/${id}`;
  const payload: BloqueoUpdatePayload = {
    ...data,
    ...(data.hora_inicio ? { hora_inicio: normalizeTimeValue(data.hora_inicio) } : {}),
    ...(data.hora_fin ? { hora_fin: normalizeTimeValue(data.hora_fin) } : {}),
    ...(typeof data.motivo === "string" ? { motivo: data.motivo.trim() || "Bloqueo de agenda" } : {}),
  };

  const buildRequest = (method: "PATCH" | "PUT") => ({
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  let res = await fetch(url, buildRequest("PATCH"));

  // Compatibilidad: algunos entornos aún exponen actualización con PUT.
  if (res.status === 405) {
    res = await fetch(url, buildRequest("PUT"));
  }

  if (!res.ok) {
    throw new Error(await readApiError(res, "Error al actualizar bloqueo"));
  }

  const raw = await res.text();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (isRecord(parsed) && "bloqueo" in parsed) {
    return {
      ...parsed,
      bloqueo: toBloqueoUi(parsed.bloqueo),
    };
  }
  return toBloqueoUi(parsed);
}

export async function deleteBloqueo(id: string, token: string) {
  const res = await fetch(`${API_BASE_URL}scheduling/block/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Error al eliminar bloqueo"));
  }
  return res.json();
}

export async function excludeDayBloqueo(id: string, fecha: string, token: string) {
  const normalizedDate = normalizeIsoDate(fecha);
  const query = new URLSearchParams({ fecha: normalizedDate }).toString();
  const res = await fetch(`${API_BASE_URL}scheduling/block/${id}/exclude-day?${query}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Error al excluir día del bloqueo"));
  }
  return res.json();
}
