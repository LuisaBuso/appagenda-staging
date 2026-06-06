import { API_BASE_URL } from "../../../../types/config";
import { normalizeBackendDateParams } from "../../../../lib/dateFormat";
import { getActiveSedeIdFromStorage } from "../../../../lib/sede-context";

type RequestOptions = {
  preserveDateParams?: boolean;
};

const getToken = (): string | null => {
  return sessionStorage.getItem("access_token") || localStorage.getItem("access_token");
};

const getActiveSedeId = (): string | null => getActiveSedeIdFromStorage();

const getHeaders = (): HeadersInit => {
  const token = getToken();
  const sedeId = getActiveSedeId();
  const headers: HeadersInit = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (sedeId) {
    headers["X-Sede-Id"] = sedeId;
  }

  return headers;
};

const getBaseUrl = () => (API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`);

const buildUrl = (
  path: string,
  params?: Record<string, any>,
  options?: RequestOptions
) => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${getBaseUrl()}cash${normalized}`);
  const normalizedParams = options?.preserveDateParams ? params : normalizeBackendDateParams(params);

  if (normalizedParams) {
    Object.entries(normalizedParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.append(key, String(value));
      }
    });
  }

  return url.toString();
};

const parseErrorMessage = async (response: Response, fallback: string) => {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
    if (Array.isArray(data?.detail) && data.detail.length > 0) {
      return data.detail
        .map((item: any) => {
          if (typeof item === "string") return item;

          const location = Array.isArray(item?.loc) ? item.loc.join(".") : "";
          const message = typeof item?.msg === "string" ? item.msg : "";
          return [location, message].filter(Boolean).join(": ");
        })
        .filter(Boolean)
        .join(" | ");
    }
    if (typeof data?.message === "string" && data.message.trim()) {
      return data.message;
    }
  } catch {
    // ignore parse error and fallback
  }

  return fallback;
};

const request = async <T>(
  method: "GET" | "POST" | "DELETE" | "PATCH",
  path: string,
  params?: Record<string, any>,
  body?: Record<string, any>,
  options?: RequestOptions
): Promise<T> => {
  const url = buildUrl(path, params, options);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("No se pudo conectar con el backend de caja. Verifica red o CORS.");
  }

  if (!response.ok) {
    const fallback = `Error ${response.status}: ${response.statusText}`;
    const message = await parseErrorMessage(response, fallback);
    throw new Error(message);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
};

const extractFilename = (contentDisposition: string | null): string | null => {
  if (!contentDisposition) return null;

  const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].replace(/["']/g, ""));
    } catch {
      return encodedMatch[1].replace(/["']/g, "");
    }
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? null;
};

const requestBlob = async (
  path: string,
  params?: Record<string, any>,
  options?: RequestOptions
): Promise<{ blob: Blob; filename: string | null }> => {
  const url = buildUrl(path, params, options);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
    });
  } catch {
    throw new Error("No se pudo conectar con el backend de caja. Verifica red o CORS.");
  }

  if (!response.ok) {
    const fallback = `Error ${response.status}: ${response.statusText}`;
    const message = await parseErrorMessage(response, fallback);
    throw new Error(message);
  }

  const blob = await response.blob();
  const filename = extractFilename(response.headers.get("content-disposition"));

  return { blob, filename };
};

export const getEfectivoDia = async (
  token: string,
  params?: Record<string, any>
): Promise<any> => {
  const url = buildUrl("/efectivo-dia", params);
  const activeSedeId = getActiveSedeId();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(activeSedeId ? { "X-Sede-Id": activeSedeId } : {}),
      },
    });
  } catch {
    throw new Error("No se pudo conectar con el backend de caja. Verifica red o CORS.");
  }

  if (!response.ok) {
    const detail = await parseErrorMessage(response, "Error al obtener efectivo del día");
    throw new Error(detail);
  }

  return response.json();
};

export const cashService = {
  getEfectivoDia: async (params?: Record<string, any>) => {
    const token = getToken();
    if (token) {
      return getEfectivoDia(token, params);
    }
    return request<any>("GET", "/efectivo-dia", params);
  },

  getIngresos: (params?: Record<string, any>, options?: RequestOptions) =>
    request<any>("GET", "/ingresos", params, undefined, options),

  getEgresos: (params?: Record<string, any>, options?: RequestOptions) =>
    request<any>("GET", "/egresos", params, undefined, options),

  createIngreso: (body: Record<string, any>) =>
    request<any>("POST", "/ingreso", undefined, body),

  updateIngreso: (ingresoId: string, body: Record<string, any>) =>
    request<any>("PATCH", `/ingresos/${ingresoId}`, undefined, body),

  deleteIngreso: (ingresoId: string, params?: Record<string, any>) =>
    request<any>("DELETE", `/ingresos/${ingresoId}`, params),

  createEgreso: (body: Record<string, any>) =>
    request<any>("POST", "/egreso", undefined, body),

  updateEgreso: (egresoId: string, body: Record<string, any>) =>
    request<any>("PATCH", `/egresos/${egresoId}`, undefined, body),

  deleteEgreso: (egresoId: string, params?: Record<string, any>) =>
    request<any>("DELETE", `/egresos/${egresoId}`, params),

  aperturaCaja: (body: Record<string, any>) =>
    request<any>("POST", "/apertura", undefined, body),

  cierreCaja: (body: Record<string, any>) =>
    request<any>("POST", "/cierre", undefined, body),

  getCierres: (params?: Record<string, any>, options?: RequestOptions) =>
    request<any>("GET", "/cierres", params, undefined, options),

  getCierreById: (cierreId: string) =>
    request<any>("GET", `/cierres/${cierreId}`),

  getReportePeriodo: (params?: Record<string, any>, options?: RequestOptions) =>
    request<any>("GET", "/reporte-periodo", params, undefined, options),

  getReporteExcel: (params?: Record<string, any>, options?: RequestOptions) =>
    requestBlob("/reporte-excel", params, options),
};
