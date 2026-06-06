import { API_BASE_URL } from "../../../types/config"
import { Sede, SedeInput } from '../../../types/sede';

export type { Sede } from '../../../types/sede';

// Interface para la respuesta del backend
interface UpdateSedeResponse {
  msg: string;
  local?: Sede | null;
  sede_id?: string;
  mongo_id?: string;
}

interface CreateSedeResponse {
  msg: string;
  local?: Sede | null;
  sede_id?: string;
  mongo_id?: string;
}

const buildHeaders = (token: string, withJsonBody = false): HeadersInit => ({
  accept: 'application/json',
  ...(withJsonBody ? { 'Content-Type': 'application/json' } : {}),
  Authorization: `Bearer ${token}`
});

const fetchSedeById = async (token: string, sedeId: string): Promise<Sede | null> => {
  const response = await fetch(`${API_BASE_URL}admin/locales/${encodeURIComponent(sedeId)}`, {
    method: 'GET',
    headers: buildHeaders(token)
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
};

const resolveSedeResponse = async (
  token: string,
  responseData: UpdateSedeResponse | CreateSedeResponse,
  fallbackData: Partial<Sede>,
  sedeId?: string
): Promise<Sede> => {
  if (responseData.local) {
    return responseData.local;
  }

  const targetSedeId = sedeId || responseData.sede_id;
  if (targetSedeId) {
    const refreshedSede = await fetchSedeById(token, targetSedeId);
    if (refreshedSede) {
      return refreshedSede;
    }
  }

  if (!targetSedeId) {
    throw new Error('La respuesta del servidor no incluyó la sede actualizada');
  }

  return {
    _id: responseData.mongo_id || fallbackData._id || "",
    sede_id: targetSedeId,
    nombre: fallbackData.nombre || "",
    direccion: fallbackData.direccion || "",
    informacion_adicional: fallbackData.informacion_adicional || "",
    zona_horaria: fallbackData.zona_horaria || "America/Bogota",
    telefono: fallbackData.telefono || "",
    email: fallbackData.email || "",
    pais: fallbackData.pais || "Colombia",
    moneda: fallbackData.moneda || "COP",
    fecha_creacion: fallbackData.fecha_creacion || new Date().toISOString(),
    creado_por: fallbackData.creado_por || "",
    activa: fallbackData.activa ?? true
  };
};

export const sedeService = {
  async getSedes(token: string): Promise<Sede[]> {
    const response = await fetch(`${API_BASE_URL}admin/locales/`, {
      method: 'GET',
      headers: buildHeaders(token)
    });

    if (!response.ok) {
      throw new Error(`Error al obtener sedes: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Filtrar elementos undefined/null y validar estructura básica
    const validSedes = data.filter((sede: any) => 
      sede && 
      sede._id && 
      typeof sede.nombre === 'string'
    );
    
    console.log('✅ Sedes válidas después del filtro:', validSedes);
    
    return validSedes;
  },

  async createSede(token: string, sede: SedeInput): Promise<Sede> {
    // Enviar solo los campos que el backend espera para CREAR
    const requestData = {
      nombre: sede.nombre,
      direccion: sede.direccion,
      informacion_adicional: sede.informacion_adicional || "",
      zona_horaria: sede.zona_horaria,
      pais: sede.pais || "Colombia",
      moneda: sede.moneda || "COP",
      telefono: sede.telefono,
      email: sede.email
      // NO ENVIAR: sede_id, activa - el backend los genera automáticamente
    };

    console.log('📤 Enviando datos al backend para CREAR:', requestData);

    const response = await fetch(`${API_BASE_URL}admin/locales/`, {
      method: 'POST',
      headers: buildHeaders(token, true),
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('❌ Error del backend:', errorData);
      throw new Error(errorData?.detail || `Error al crear sede: ${response.statusText}`);
    }

    const result: CreateSedeResponse = await response.json();
    console.log('✅ Respuesta del backend:', result);
    return resolveSedeResponse(token, result, requestData);
  },

  async updateSede(token: string, sedeId: string, sede: Partial<Sede>): Promise<Sede> {
    // Enviar solo los campos que el backend espera para ACTUALIZAR
    const requestData: any = {
      nombre: sede.nombre,
      direccion: sede.direccion,
      informacion_adicional: sede.informacion_adicional || "",
      zona_horaria: sede.zona_horaria,
      pais: sede.pais,
      moneda: sede.moneda || "COP",
      telefono: sede.telefono,
      email: sede.email,
      activa: sede.activa // Incluir activa para actualización
    };

    console.log('📤 Actualizando sede:', requestData);

    const response = await fetch(`${API_BASE_URL}admin/locales/${sedeId}`, {
      method: 'PUT',
      headers: buildHeaders(token, true),
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('❌ Error del backend:', errorData);
      throw new Error(errorData?.detail || `Error al actualizar sede: ${response.statusText}`);
    }

    const result: UpdateSedeResponse = await response.json();
    console.log('✅ Respuesta del backend:', result);
    return resolveSedeResponse(token, result, { ...sede, sede_id: sedeId }, sedeId);
  },

  async deleteSede(token: string, sedeId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}admin/locales/${sedeId}`, {
      method: 'DELETE',
      headers: buildHeaders(token)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || `Error al eliminar sede: ${response.statusText}`);
    }
  }
};
