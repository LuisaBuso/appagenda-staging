// components/Quotes/citasApi.ts - Agrega esta función
import { API_BASE_URL } from '../../../types/config'; // Ajusta la ruta según tu estructura
import { normalizePaymentMethodForBackend } from '../../../lib/payment-methods';
import { apiFetch } from '../../../lib/api';

export class ApiRequestError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.payload = payload;
  }
}

const parseApiDetail = (detail: unknown, fallback: string): string => {
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;

  if (Array.isArray(detail)) {
    const parsed = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg?: string }).msg || JSON.stringify(item));
        }
        return JSON.stringify(item);
      })
      .join(' | ');
    return parsed || fallback;
  }

  if (typeof detail === 'object') {
    const detailObj = detail as Record<string, unknown>;

    if (typeof detailObj.message === 'string') return detailObj.message;
    if (typeof detailObj.mensaje === 'string') return detailObj.mensaje;
    if (typeof detailObj.error === 'string') return detailObj.error;

    const parsed = Object.entries(detailObj)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' | ');
    return parsed || fallback;
  }

  return fallback;
};

const buildApiRequestError = async (response: Response, fallback: string): Promise<ApiRequestError> => {
  const errorData = await response.json().catch(() => null);
  const message = parseApiDetail(errorData?.detail ?? errorData, fallback);
  return new ApiRequestError(message, response.status, errorData);
};

export const updateQuote = async (citaId: string, cambios: any, token: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}scheduling/quotes/${citaId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(cambios)
    });

    if (!response.ok) {
      const fallback = `Error ${response.status}: ${response.statusText}`;
      throw await buildApiRequestError(response, fallback);
    }

    return await response.json();
  } catch (error) {
    console.error('Error en updateQuote:', error);
    throw error;
  }

};

export const updateCita = updateQuote;
// En tu archivo citasApi.ts
export const confirmarCita = async (citaId: string, _token?: string) => {
  const response = await apiFetch(
    `${API_BASE_URL}scheduling/quotes/${citaId}/confirmar`,
    { method: 'POST' }
  );

  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al confirmar cita');
  }

  return await response.json();
};

export const reenviarCorreoCita = async (
  citaId: string,
  tipo: 'confirmacion' | 'recordatorio' | 'cancelacion',
  token: string
) => {
  const response = await fetch(
    `${API_BASE_URL}scheduling/quotes/${citaId}/reenviar-correo?tipo=${tipo}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al reenviar correo');
  }

  return await response.json();
};

export const registrarPagoCita = async (
  citaId: string,
  pagoData: {
    monto: number;
    metodo_pago: string;
    notas?: string;
    codigo_giftcard?: string;
  },
  token: string
) => {
  const normalizedPaymentMethod = normalizePaymentMethodForBackend(pagoData.metodo_pago);
  const response = await fetch(
    `${API_BASE_URL}scheduling/quotes/citas/${citaId}/pago`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        ...pagoData,
        metodo_pago: normalizedPaymentMethod,
      })
    }
  );

  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al registrar pago');
  }

  return await response.json();
};
