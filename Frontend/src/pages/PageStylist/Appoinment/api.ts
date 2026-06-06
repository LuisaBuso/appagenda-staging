// services/api.ts - ACTUALIZADO
import { API_BASE_URL } from '../../../types/config';

// ⭐ NUEVA INTERFAZ: Servicio en cita
export interface ServicioEnCita {
  servicio_id: string;
  nombre: string;
  precio: number;
  precio_personalizado: boolean;
}

// Interfaces simplificadas
export interface Estilista {
  _id: string;
  unique_id?: string;
  nombre: string;
  email: string;
  sede_id?: string;
  especialidades?: string[];
}

export interface Sede {
  _id: string;
  sede_id: string;
  nombre: string;
}

export interface Servicio {
  _id: string;
  servicio_id?: string;
  nombre: string;
  duracion_minutos: number;
  precio: number;
}

// ⭐ INTERFAZ ACTUALIZADA: Cita con múltiples servicios
export interface Cita {
  _id: string;
  cita_id?: string;
  cliente_nombre: string;
  
  // ⭐ NUEVO: Array de servicios
  servicios: ServicioEnCita[];
  
  // ⭐ COMPATIBILIDAD: Campos calculados
  servicio?: {  // Primer servicio (compatibilidad)
    nombre: string;
    duracion_minutos?: number;
    precio: number;
  };
  
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
  
  // ⭐ NUEVOS CAMPOS
  precio_total?: number;
  cantidad_servicios?: number;
  tiene_precio_personalizado?: boolean;
}

// 🔥 HELPER: Normalizar cita para compatibilidad
const normalizarCita = (cita: any): Cita => {
  // Si tiene servicios (nuevo formato)
  if (cita.servicios && Array.isArray(cita.servicios) && cita.servicios.length > 0) {
    return {
      ...cita,
      // ⭐ Agregar campo 'servicio' para compatibilidad
      servicio: {
        nombre: cita.servicios.map((s: any) => s.nombre).join(', '),
        precio: cita.precio_total || cita.servicios.reduce((sum: number, s: any) => sum + (s.precio || 0), 0),
        duracion_minutos: cita.servicios[0]?.duracion_minutos
      }
    };
  }
  
  // Si tiene servicio único (formato antiguo)
  if (cita.servicio) {
    return {
      ...cita,
      // Convertir a array
      servicios: [{
        servicio_id: cita.servicio.servicio_id || cita.servicio_id || '',
        nombre: cita.servicio.nombre || 'Servicio',
        precio: cita.servicio.precio || 0,
        precio_personalizado: false
      }]
    };
  }
  
  return cita;
};

// Cache y httpClient sin cambios...
const cache = {
  servicios: null as Servicio[] | null,
  estilistas: new Map<string, Estilista>(),
  sedes: new Map<string, Sede>(),
  citas: new Map<string, Cita[]>(),
  lastFetch: new Map<string, number>(),
  
  shouldRefetch: (key: string) => {
    const last = cache.lastFetch.get(key);
    if (!last) return true;
    return Date.now() - last > 5 * 60 * 1000;
  },
  
  set: <T>(key: string, data: T) => {
    cache.lastFetch.set(key, Date.now());
    return data;
  }
};

const httpClient = {
  get: async (url: string, token: string) => {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  },

  post: async (url: string, data: any, token: string) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail || `HTTP ${response.status}`);
    }

    return response.json();
  }
};

// APIs sin cambios...
export const serviciosApi = {
  getServicios: async (token: string): Promise<Servicio[]> => {
    const cacheKey = 'servicios';
    
    if (cache.servicios && !cache.shouldRefetch(cacheKey)) {
      return cache.servicios;
    }

    try {
      const data = await httpClient.get(`${API_BASE_URL}scheduling/services/`, token);
      const servicios = Array.isArray(data) ? data : [];
      
      cache.servicios = servicios;
      cache.set(cacheKey, servicios);
      
      return servicios;
    } catch (error) {
      if (cache.servicios) return cache.servicios;
      throw error;
    }
  },

  getServiciosEstilista: async (estilistaId: string, token: string): Promise<Servicio[]> => {
    const cacheKey = `servicios_${estilistaId}`;
    
    if (!cache.shouldRefetch(cacheKey) && cache.estilistas.has(estilistaId)) {
      const estilista = cache.estilistas.get(estilistaId)!;
      if (estilista.especialidades) {
        const servicios = await serviciosApi.getServicios(token);
        return servicios.filter(s => 
          estilista.especialidades!.includes(s.servicio_id || s._id)
        );
      }
    }

    try {
      const [estilista, todosServicios] = await Promise.all([
        estilistasApi.getEstilista(estilistaId, token),
        serviciosApi.getServicios(token)
      ]);

      if (!estilista.especialidades?.length) {
        return [];
      }

      const serviciosFiltrados = todosServicios.filter(servicio => 
        estilista.especialidades!.includes(servicio.servicio_id || servicio._id)
      );

      cache.set(cacheKey, serviciosFiltrados);
      return serviciosFiltrados;
    } catch (error) {
      return [];
    }
  }
};

export const estilistasApi = {
  getEstilistas: async (token: string): Promise<Estilista[]> => {
    const cacheKey = 'estilistas';
    
    if (!cache.shouldRefetch(cacheKey)) {
      return Array.from(cache.estilistas.values());
    }

    try {
      const data = await httpClient.get(`${API_BASE_URL}admin/profesionales/`, token);
      const estilistas = Array.isArray(data) ? data : [];
      
      cache.estilistas.clear();
      estilistas.forEach(est => {
        if (est._id) cache.estilistas.set(est._id, est);
        if (est.unique_id) cache.estilistas.set(est.unique_id, est);
      });
      
      cache.set(cacheKey, estilistas);
      return estilistas;
    } catch (error) {
      return Array.from(cache.estilistas.values());
    }
  },

  getEstilista: async (estilistaId: string, token: string): Promise<Estilista> => {
    if (cache.estilistas.has(estilistaId) && !cache.shouldRefetch(`estilista_${estilistaId}`)) {
      return cache.estilistas.get(estilistaId)!;
    }

    try {
      const estilista = await httpClient.get(
        `${API_BASE_URL}admin/profesionales/${estilistaId}`, 
        token
      );

      cache.estilistas.set(estilistaId, estilista);
      if (estilista.unique_id) {
        cache.estilistas.set(estilista.unique_id, estilista);
      }

      cache.set(`estilista_${estilistaId}`, estilista);
      return estilista;
    } catch (error) {
      if (cache.estilistas.has(estilistaId)) {
        return cache.estilistas.get(estilistaId)!;
      }
      throw error;
    }
  },

  getEstilistaByEmail: async (email: string, token: string): Promise<Estilista | null> => {
    const cacheKey = `estilista_email_${email}`;
    
    if (!cache.shouldRefetch(cacheKey)) {
      const cached = Array.from(cache.estilistas.values()).find(est => est.email === email);
      if (cached) return cached;
    }

    try {
      const estilistas = await estilistasApi.getEstilistas(token);
      const estilista = estilistas.find(est => est.email === email) || null;
      
      if (estilista) {
        cache.set(cacheKey, estilista);
      }
      
      return estilista;
    } catch (error) {
      const cached = Array.from(cache.estilistas.values()).find(est => est.email === email);
      return cached || null;
    }
  }
};

export const sedesApi = {
  getSedes: async (token: string): Promise<Sede[]> => {
    const cacheKey = 'sedes';
    
    if (!cache.shouldRefetch(cacheKey) && cache.sedes.size > 0) {
      return Array.from(cache.sedes.values());
    }

    try {
      const data = await httpClient.get(`${API_BASE_URL}admin/locales/`, token);
      const sedes = Array.isArray(data) ? data : [];
      
      cache.sedes.clear();
      sedes.forEach(sede => {
        if (sede._id) cache.sedes.set(sede._id, sede);
        if (sede.sede_id) cache.sedes.set(sede.sede_id, sede);
      });
      
      cache.set(cacheKey, sedes);
      return sedes;
    } catch (error) {
      return Array.from(cache.sedes.values());
    }
  },

  getSede: async (sedeId: string, token: string): Promise<Sede> => {
    if (cache.sedes.has(sedeId) && !cache.shouldRefetch(`sede_${sedeId}`)) {
      return cache.sedes.get(sedeId)!;
    }

    try {
      const sede = await httpClient.get(
        `${API_BASE_URL}admin/locales/${sedeId}`, 
        token
      );

      cache.sedes.set(sedeId, sede);
      if (sede._id && sede._id !== sedeId) {
        cache.sedes.set(sede._id, sede);
      }

      cache.set(`sede_${sedeId}`, sede);
      return sede;
    } catch (error) {
      if (cache.sedes.has(sedeId)) {
        return cache.sedes.get(sedeId)!;
      }
      throw error;
    }
  }
};

// ⭐ ACTUALIZADO: citasApi con normalización
export const citasApi = {
  getCitas: async (params: { estilista_id?: string; fecha?: string }, token: string): Promise<Cita[]> => {
    const cacheKey = `citas_${params.estilista_id}_${params.fecha}`;
    
    if (cache.citas.has(cacheKey)) {
      const lastFetch = cache.lastFetch.get(cacheKey) || 0;
      if (Date.now() - lastFetch < 60 * 1000) {
        return cache.citas.get(cacheKey)!;
      }
    }

    const queryParams = new URLSearchParams();
    if (params.estilista_id) queryParams.append('estilista_id', params.estilista_id);
    if (params.fecha) queryParams.append('fecha', params.fecha);

    try {
      const data = await httpClient.get(
        `${API_BASE_URL}scheduling/quotes/citas/?${queryParams.toString()}`, 
        token
      );

      let citasRaw = Array.isArray(data) ? data : (data.citas || []);
      
      // ⭐ NORMALIZAR TODAS LAS CITAS
      const citas = citasRaw.map((cita: any) => normalizarCita(cita));
      
      cache.citas.set(cacheKey, citas);
      cache.set(cacheKey, citas);
      
      console.log('✅ Citas normalizadas:', citas);
      
      return citas;
    } catch (error) {
      if (cache.citas.has(cacheKey)) {
        return cache.citas.get(cacheKey)!;
      }
      return [];
    }
  },

  crearCita: async (data: any, token: string) => {
    const result = await httpClient.post(
      `${API_BASE_URL}scheduling/quotes/citas/`, 
      data, 
      token
    );

    const cacheKey = `citas_${data.estilista_id}_${data.fecha}`;
    cache.citas.delete(cacheKey);
    cache.lastFetch.delete(cacheKey);

    return result;
  }
};

export const bloqueosApi = {
  crearBloqueo: async (data: any, token: string) => {
    return httpClient.post(`${API_BASE_URL}scheduling/block/`, data, token);
  }
};

export const estilistaApi = {
  getMiPerfil: async (token: string, email: string): Promise<{ estilista: Estilista; sede: Sede | null }> => {
    const cacheKey = `perfil_${email}`;
    
    if (!cache.shouldRefetch(cacheKey)) {
      const estilista = Array.from(cache.estilistas.values()).find(est => est.email === email);
      if (estilista) {
        let sede = null;
        if (estilista.sede_id && cache.sedes.has(estilista.sede_id)) {
          sede = cache.sedes.get(estilista.sede_id)!;
        }
        return { estilista, sede };
      }
    }

    try {
      const [estilistas, sedes] = await Promise.all([
        estilistasApi.getEstilistas(token),
        sedesApi.getSedes(token)
      ]);

      const estilista = estilistas.find(est => est.email === email);
      
      if (!estilista) {
        throw new Error('Estilista no encontrado');
      }

      let sede = null;
      if (estilista.sede_id) {
        sede = sedes.find(s => s._id === estilista.sede_id || s.sede_id === estilista.sede_id) || null;
      }

      cache.set(cacheKey, { estilista, sede });
      return { estilista, sede };
    } catch (error) {
      console.error('Error cargando perfil:', error);
      throw error;
    }
  },

  getMisCitas: async (estilistaId: string, fecha: string, token: string): Promise<Cita[]> => {
    return citasApi.getCitas({ estilista_id: estilistaId, fecha }, token);
  },

  getMisServicios: async (estilistaId: string, token: string): Promise<Servicio[]> => {
    return serviciosApi.getServiciosEstilista(estilistaId, token);
  },

  crearMiCita: async (data: any, token: string) => {
    return citasApi.crearCita(data, token);
  },

  crearMiBloqueo: async (data: any, token: string) => {
    return bloqueosApi.crearBloqueo(data, token);
  }
};

export const clearCache = () => {
  cache.servicios = null;
  cache.estilistas.clear();
  cache.sedes.clear();
  cache.citas.clear();
  cache.lastFetch.clear();
};

export default {
  servicios: serviciosApi,
  estilistas: estilistasApi,
  sedes: sedesApi,
  citas: citasApi,
  bloqueos: bloqueosApi,
  estilista: estilistaApi,
  clearCache
};