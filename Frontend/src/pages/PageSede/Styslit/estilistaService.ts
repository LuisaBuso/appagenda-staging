import { API_BASE_URL } from "../../../types/config";
import type { Estilista, CreateEstilistaData } from "../../../types/estilista";

// Interface para la respuesta de la API
interface ApiEstilista {
  [key: string]: unknown;
  _id: string;
  nombre: string;
  email: string;
  especialidades: boolean; // 🔥 CAMBIADO: Ahora es boolean
  servicios_no_presta: string[];
  servicios_presta?: Array<{ // 🔥 NUEVO: Servicios que SÍ presta
    id: string;
    nombre: string;
  }>;
  activo: boolean;
  comision: number | null;
  comision_productos?: number | null;
  profesional_id: string;
  rol: string;
  sede_id: string;
  sede_nombre?: string; // 🔥 NUEVO: Nombre de la sede
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

interface UpdateEstilistaResponse {
  msg: string;
  profesional: ApiEstilista;
}

const normalizeCommission = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 100) / 100;
};

const formatApiErrorDetail = (detail: unknown): string => {
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const field = Array.isArray(record.loc) ? record.loc.at(-1) : record.field;
          const message = record.msg ?? record.message ?? "Error de validación";
          return field ? `${String(field)}: ${String(message)}` : String(message);
        }
        return String(item);
      })
      .join("; ");
  }

  if (detail && typeof detail === "object") {
    return Object.entries(detail as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("; ");
  }

  return "";
};

export const estilistaService = {
  async getEstilistas(token: string): Promise<Estilista[]> {
    const response = await fetch(`${API_BASE_URL}admin/profesionales/`, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Error al obtener estilistas: ${response.statusText}`);
    }

    const data: ApiEstilista[] = await response.json();
    
    console.log('📥 Datos crudos de la API:', data);
    
    // Transformar la respuesta de la API al formato del frontend
    return data.map(estilista => {
      // 🔥 CORREGIDO: Convertir especialidades boolean a array
      const especialidadesArray = estilista.especialidades ? 
        (estilista.servicios_presta?.map(servicio => servicio.nombre) || []) : 
        [];
      
      // 🔥 CORREGIDO: Obtener especialidades_detalle de servicios_presta
      const especialidadesDetalle = estilista.servicios_presta?.map(servicio => ({
        id: servicio.id,
        nombre: servicio.nombre
      })) || [];

      return {
        ...(estilista as Record<string, unknown>),
        _id: estilista._id,
        nombre: estilista.nombre,
        email: estilista.email,
        especialidades: especialidadesArray, // 🔥 CONVERTIDO: boolean → array
        servicios_no_presta: estilista.servicios_no_presta || [],
        servicios_presta: estilista.servicios_presta || [], // 🔥 NUEVO
        activo: estilista.activo,
      rol: estilista.rol,
      profesional_id: estilista.profesional_id,
      sede_id: estilista.sede_id,
      sede_nombre: estilista.sede_nombre, // 🔥 NUEVO
        telefono: typeof estilista.telefono === "string" ? estilista.telefono : undefined,
      franquicia_id: null, // No viene en la respuesta
      created_by: estilista.created_by,
      comision: estilista.comision,
      comision_productos: normalizeCommission(estilista.comision_productos),
      comisiones_por_categoria:
        estilista && typeof estilista.comisiones_por_categoria === "object"
            ? (estilista.comisiones_por_categoria as Record<string, number>)
            : undefined,
        created_at: estilista.created_at,
        updated_at: estilista.updated_at,
        especialidades_detalle: especialidadesDetalle, // 🔥 CORREGIDO
        updated_by: estilista.updated_by,
        deleted_at: estilista.deleted_at,
        deleted_by: estilista.deleted_by
      };
    });
  },

  async createEstilista(token: string, estilistaData: CreateEstilistaData): Promise<Estilista> {
    const requestData = {
      nombre: estilistaData.nombre.trim(),
      email: estilistaData.email.trim(),
      sede_id: estilistaData.sede_id,
      especialidades: true,
      comision: estilistaData.comision,
      comision_productos: normalizeCommission(estilistaData.comision_productos) ?? undefined,
      telefono: estilistaData.telefono,
      password: estilistaData.password,
      activo: estilistaData.activo !== undefined ? estilistaData.activo : true
    };

    console.log('📤 Creando estilista con datos:', requestData);

    const response = await fetch(`${API_BASE_URL}admin/profesionales/`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      let errorMessage = `Error ${response.status}: ${response.statusText}`;
      
      try {
        const errorData = await response.json();
        console.error('❌ Error del backend:', errorData);
        
        if (errorData.detail) {
          if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail;
          } else if (Array.isArray(errorData.detail)) {
            errorMessage = errorData.detail.map((err: any) => {
              const field = err.loc?.[err.loc.length - 1] || 'campo';
              const value = err.input !== undefined ? ` (valor: ${JSON.stringify(err.input)})` : '';
              return `${field}: ${err.msg}${value}`;
            }).join('; ');
          }
        }
      } catch (parseError) {
        console.error('Error parseando respuesta:', parseError);
      }
      
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('✅ Respuesta del backend al crear estilista:', result);

    // ✅ MANEJO DE LA RESPUESTA ACTUAL DEL BACKEND
    if (result.profesional_id) {
      console.log('🔄 Obteniendo datos completos del profesional recién creado...');
      
      // Hacer una solicitud adicional para obtener los datos completos del profesional
      try {
        const profesionalCompleto = await this.getEstilistaById(token, result.profesional_id);
        console.log('✅ Datos completos del profesional:', profesionalCompleto);
        
        return profesionalCompleto;
      } catch (error) {
        console.warn('⚠️ No se pudieron obtener los datos completos, construyendo objeto básico...');
        
        // Construir objeto básico si falla la segunda llamada
        const estilistaBasico: Estilista = {
          _id: result.estilista_mongo_id || `temp-${Date.now()}`,
          nombre: requestData.nombre,
          email: requestData.email,
          especialidades: Array.isArray(requestData.especialidades) ? requestData.especialidades : [],
          servicios_no_presta: [],
          servicios_presta: [],
          activo: requestData.activo,
          rol: 'estilista',
          profesional_id: result.profesional_id,
          sede_id: requestData.sede_id,
          sede_nombre: 'Nueva sede',
          franquicia_id: null,
          created_by: 'system',
          comision: requestData.comision,
          comision_productos: normalizeCommission(estilistaData.comision_productos) ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          especialidades_detalle: Array.isArray(requestData.especialidades)
            ? requestData.especialidades.map((id: string) => ({ id, nombre: id }))
            : [],
        };
        
        return estilistaBasico;
      }
    } else {
      console.error('❌ Estructura de respuesta inesperada:', result);
      throw new Error('No se pudo obtener el ID del profesional creado');
    }
  },

  async updateEstilista(token: string, profesionalId: string, estilistaData: Partial<Estilista> & Record<string, unknown>): Promise<Estilista> {
    const requestData: any = {
      nombre: estilistaData.nombre?.trim(),
      email: estilistaData.email?.trim(),
      sede_id: estilistaData.sede_id,
      especialidades: true,
      activo: estilistaData.activo ?? true,
      password:
        typeof estilistaData.password === "string" && estilistaData.password.trim()
          ? estilistaData.password.trim()
          : "Temporal123!",
    };

    // Solo enviar comision si tiene valor
    if (estilistaData.comision !== undefined) {
      requestData.comision = estilistaData.comision;
    }

    if (estilistaData.comision_productos !== undefined) {
      requestData.comision_productos = normalizeCommission(estilistaData.comision_productos);
    }

    if (typeof estilistaData.telefono === "string") {
      requestData.telefono = estilistaData.telefono.trim();
    }

    console.log('📤 Actualizando estilista:', requestData);

    const response = await fetch(`${API_BASE_URL}admin/profesionales/${profesionalId}`, {
      method: 'PUT',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        formatApiErrorDetail(errorData?.detail) ||
          `Error al actualizar estilista: ${response.statusText}`,
      );
    }

    const result: UpdateEstilistaResponse = await response.json();
    console.log('✅ Respuesta del backend al actualizar:', result);
    
    // Algunos endpoints devuelven solo msg/profesional_id. Si no viene el objeto completo, reconsultar.
    if (!result.profesional) {
      return this.getEstilistaById(token, profesionalId);
    }

    // Transformar la respuesta al formato del frontend
    const especialidadesArray = result.profesional.especialidades ? 
      (result.profesional.servicios_presta?.map(servicio => servicio.nombre) || []) : 
      [];
    
    const especialidadesDetalle = result.profesional.servicios_presta?.map(servicio => ({
      id: servicio.id,
      nombre: servicio.nombre
    })) || [];

    return {
      ...(result.profesional as Record<string, unknown>),
      _id: result.profesional._id,
      nombre: result.profesional.nombre,
      email: result.profesional.email,
      especialidades: especialidadesArray,
      servicios_no_presta: result.profesional.servicios_no_presta || [],
      servicios_presta: result.profesional.servicios_presta || [],
      activo: result.profesional.activo,
      rol: result.profesional.rol,
      profesional_id: result.profesional.profesional_id,
      sede_id: result.profesional.sede_id,
      sede_nombre: result.profesional.sede_nombre,
      franquicia_id: null,
      created_by: result.profesional.created_by,
      comision: result.profesional.comision,
      comision_productos: normalizeCommission(result.profesional.comision_productos),
      created_at: result.profesional.created_at,
      updated_at: result.profesional.updated_at,
      especialidades_detalle: especialidadesDetalle
    };
  },

  async updateServiceCommissions(
    token: string,
    profesionalId: string,
    comisionesPorCategoria: Record<string, number>,
  ): Promise<{
    msg: string;
    profesional_id: string;
    nombre?: string;
    comisiones_por_categoria: Record<string, number>;
  }> {
    const response = await fetch(`${API_BASE_URL}admin/profesionales/${profesionalId}/comisiones`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(comisionesPorCategoria),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        formatApiErrorDetail(errorData?.detail) ||
          `Error al actualizar comisiones del estilista: ${response.statusText}`,
      );
    }

    return response.json();
  },

  async updateServicios(
    token: string,
    profesionalId: string,
    serviciosNoPresta: string[],
  ): Promise<{
    msg: string;
    profesional_id: string;
    servicios_no_presta_actualizados: number;
    total_servicios_no_presta: number;
  }> {
    const response = await fetch(`${API_BASE_URL}admin/profesionales/${profesionalId}/servicios`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(serviciosNoPresta),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        formatApiErrorDetail(errorData?.detail) ||
          `Error al actualizar servicios del estilista: ${response.statusText}`,
      );
    }

    return response.json();
  },

  async deleteEstilista(token: string, profesionalId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}admin/profesionales/${profesionalId}`, {
      method: 'DELETE',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || `Error al eliminar estilista: ${response.statusText}`);
    }
  },

  async getEstilistaById(token: string, profesionalId: string): Promise<Estilista> {
    const response = await fetch(`${API_BASE_URL}admin/profesionales/${profesionalId}`, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Error al obtener estilista: ${response.statusText}`);
    }

    const data: ApiEstilista = await response.json();
    
    // 🔥 CORREGIDO: Convertir especialidades boolean a array
    const especialidadesArray = data.especialidades ? 
      (data.servicios_presta?.map(servicio => servicio.nombre) || []) : 
      [];
    
    const especialidadesDetalle = data.servicios_presta?.map(servicio => ({
      id: servicio.id,
      nombre: servicio.nombre
    })) || [];
    
    return {
      ...(data as Record<string, unknown>),
      _id: data._id,
      nombre: data.nombre,
      email: data.email,
      especialidades: especialidadesArray,
      servicios_no_presta: data.servicios_no_presta || [],
      servicios_presta: data.servicios_presta || [],
      activo: data.activo,
      rol: data.rol,
      profesional_id: data.profesional_id,
      sede_id: data.sede_id,
      sede_nombre: data.sede_nombre,
      telefono: typeof data.telefono === "string" ? data.telefono : undefined,
      franquicia_id: null,
      created_by: data.created_by,
      comision: data.comision,
      comision_productos: normalizeCommission(data.comision_productos),
      comisiones_por_categoria:
        data && typeof data.comisiones_por_categoria === "object"
          ? (data.comisiones_por_categoria as Record<string, number>)
          : undefined,
      created_at: data.created_at,
      updated_at: data.updated_at,
      especialidades_detalle: especialidadesDetalle
    };
  }
};
