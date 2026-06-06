// services/citasApi.ts
import { API_BASE_URL } from "../../types/config";
import { normalizePaymentMethodForBackend } from "../../lib/payment-methods";
import { apiFetch } from "../../lib/api";

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
  const response = await fetch(`${API_BASE_URL}scheduling/quotes/${citaId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(cambios)
  });
  if (!response.ok) {
    throw await buildApiRequestError(response, `Error ${response.status}: ${response.statusText}`);
  }
  return await response.json();
};

export const updateCita = updateQuote;

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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    }
  );
  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al reenviar correo');
  }
  return await response.json();
};

export const registrarPagoCita = async (
  citaId: string,
  pagoData: { monto: number; metodo_pago: string; notas?: string; codigo_giftcard?: string },
  token: string
) => {
  const normalizedPaymentMethod = normalizePaymentMethodForBackend(pagoData.metodo_pago);
  const response = await fetch(
    `${API_BASE_URL}scheduling/quotes/citas/${citaId}/pago`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ...pagoData, metodo_pago: normalizedPaymentMethod })
    }
  );
  if (!response.ok) {
    throw await buildApiRequestError(response, 'Error al registrar pago');
  }
  return await response.json();
};

export async function getCitas(params?: { sede_id?: string; profesional_id?: string; fecha?: string }, token?: string) {
  const query = new URLSearchParams();

  if (params?.sede_id) query.append('sede_id', params.sede_id);
  if (params?.profesional_id) query.append('profesional_id', params.profesional_id);
  if (params?.fecha) query.append('fecha', params.fecha);

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  console.log('🔍 Fetching citas con query:', query.toString());
  const queryString = query.toString();
  const endpoints = [
    `${API_BASE_URL}scheduling/quotes/citas/?${queryString}`,
    `${API_BASE_URL}scheduling/quotes/?${queryString}`,
  ];

  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        headers,
        credentials: "include",
      });

      if (!res.ok) {
        lastError = new Error(`Error al cargar citas (${res.status})`);
        continue;
      }

      return res.json();
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error("Error al cargar citas");
    }
  }

  throw lastError || new Error("Error al cargar citas");
}

export async function crearCita(data: any, token: string) {
  const codigoGiftcard = typeof data.codigo_giftcard === 'string'
    ? data.codigo_giftcard.trim()
    : '';

  // ⭐ PREPARAR DATOS SEGÚN EL NUEVO FORMATO DEL BACKEND
  const citaData = {
    // IDs principales
    sede_id: data.sede_id,
    profesional_id: data.profesional_id,
    cliente_id: data.cliente_id,
    
    // ⭐ SERVICIOS (ARRAY) - NUEVO FORMATO
    servicios: data.servicios || [],  // ✅ ESTO ES LO QUE FALTABA
    
    // Fecha y hora
    fecha: data.fecha,
    hora_inicio: data.hora_inicio,
    hora_fin: data.hora_fin,
    
    // Pago
    metodo_pago_inicial: normalizePaymentMethodForBackend(
      data.metodo_pago || data.metodo_pago_inicial || "sin_pago"
    ),
    abono: Number(data.abono) || 0,
    
    // Opcional
    notas: data.notas || "",
    ...(data.estado ? { estado: data.estado } : {}),
    ...(codigoGiftcard ? { codigo_giftcard: codigoGiftcard } : {})
  };

  if (citaData.metodo_pago_inicial === 'giftcard' && !codigoGiftcard) {
    throw new Error('Debes ingresar el codigo de la Gift Card para continuar');
  }

  // 🔥 VALIDACIÓN - VERIFICAR QUE SERVICIOS NO ESTÉ VACÍO
  if (!citaData.servicios || citaData.servicios.length === 0) {
    console.error('❌ ERROR: servicios está vacío o no existe');
    console.error('📦 data recibido:', data);
    throw new Error('Debe incluir al menos un servicio');
  }

  // 🔥 VALIDACIÓN - VERIFICAR FORMATO DE SERVICIOS
  for (const servicio of citaData.servicios) {
    if (!servicio.servicio_id) {
      console.error('❌ ERROR: servicio sin servicio_id:', servicio);
      throw new Error('Cada servicio debe tener un servicio_id');
    }
    // precio_personalizado puede ser null o number
    if (servicio.precio_personalizado !== null && typeof servicio.precio_personalizado !== 'number') {
      console.error('❌ ERROR: precio_personalizado debe ser null o number:', servicio);
      throw new Error('precio_personalizado debe ser null o un número');
    }
  }

  console.log("═══════════════════════════════════");
  console.log("📤 Enviando cita al backend:");
  console.log("📋 Servicios:", JSON.stringify(citaData.servicios, null, 2));
  console.log("📦 Payload completo:", JSON.stringify(citaData, null, 2));
  console.log("═══════════════════════════════════");

  try {
    const res = await fetch(`${API_BASE_URL}scheduling/quotes/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(citaData),
      credentials: "include",
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('❌ Error response del backend:', errorText);

      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { detail: errorText || "Error al crear cita" };
      }

      // 🔥 MANEJO DE ERRORES DE VALIDACIÓN DE PYDANTIC
      if (errorData.detail && Array.isArray(errorData.detail)) {
        const firstError = errorData.detail[0];
        const field = firstError.loc[firstError.loc.length - 1];
        const message = firstError.msg;

        // 🔥 ERROR ESPECÍFICO PARA SERVICIOS
        if (field === 'servicios') {
          console.error('❌ Error en servicios:', firstError);
          console.error('📦 Servicios enviados:', citaData.servicios);
          throw new Error(`Error en servicios: ${message}`);
        }

        if (field === 'fecha') {
          throw new Error(`Error en la fecha: ${message}. Fecha enviada: ${data.fecha}`);
        } else {
          throw new Error(`Error en ${field}: ${message}`);
        }
      } else {
        const errorDetail = errorData.detail || errorData.message || "Error al crear cita";

        // 🔥 MANEJO MEJORADO DE ERRORES
        if (errorDetail.includes("no tiene horario asignado")) {
          throw new Error("El estilista no tiene horario configurado para este día.");
        } else if (errorDetail.includes("fuera del horario laboral")) {
          throw new Error("La cita está fuera del horario laboral del estilista.");
        } else if (errorDetail.includes("ya tiene una cita")) {
          throw new Error("El estilista ya tiene una cita programada en ese horario.");
        } else if (errorDetail.includes("bloqueado")) {
          throw new Error("El horario está bloqueado. Selecciona otro horario.");
        } else if (errorDetail.includes("Cliente no encontrado")) {
          throw new Error("El cliente no existe en el sistema.");
        } else if (errorDetail.includes("Servicio no encontrado")) {
          throw new Error("El servicio no existe.");
        } else if (errorDetail.includes("Profesional no encontrado")) {
          throw new Error("El estilista no existe.");
        } else if (errorDetail.includes("Sede no encontrada")) {
          throw new Error("La sede no existe.");
        } else {
          throw new Error(errorDetail);
        }
      }
    }

    const result = await res.json();
    console.log('✅ Cita creada exitosamente:', result);
    return result;

  } catch (error) {
    console.error('❌ Error en crearCita:', error);
    throw error;
  }
}

export async function editarCita(citaId: string, data: any, token: string) {
  const res = await fetch(`${API_BASE_URL}scheduling/quotes/${citaId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
    credentials: "include",
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || "Error al editar cita");
  }

  return res.json();
}

export async function cancelarCita(citaId: string, token: string) {
  const res = await fetch(`${API_BASE_URL}scheduling/quotes/${citaId}/cancelar`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || "Error al cancelar cita");
  }

  return res.json();
}

export async function cambiarEstadoCita(citaId: string, nuevoEstado: string, token: string) {
  const res = await fetch(`${API_BASE_URL}scheduling/quotes/${citaId}/estado`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ nuevo_estado: nuevoEstado }),
    credentials: "include",
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || "Error al cambiar estado de cita");
  }

  return res.json();
}
