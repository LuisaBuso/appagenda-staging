import { API_BASE_URL } from "../../../types/config";
import { Cliente } from "../../../types/cliente";
import { formatCurrencyNoDecimals } from "../../../lib/currency";
import { getActiveSedeIdFromStorage } from "../../../lib/sede-context";

export interface CreateClienteData {
  nombre: string;
  correo?: string;
  telefono?: string;
  notas?: string;
  sede_id?: string;
  cedula?: string;
  ciudad?: string;
  fecha_de_nacimiento?: string;
}

export interface UpdateClienteData {
  cliente_id?: string;
  nombre?: string;
  correo?: string;
  telefono?: string;
  cedula?: string;
  ciudad?: string;
  fecha_de_nacimiento?: string;
  sede_id?: string;
  notas?: string;
}

export interface ClienteResponse {
  _id: string;
  cliente_id: string;
  nombre: string;
  correo?: string;
  telefono?: string;
  cedula?: string;
  ciudad?: string;
  sede_id: string;
  fecha_creacion: string;
  creado_por: string;
  notas_historial?: Array<{
    contenido: string;
    fecha: string;
    autor: string;
  }>;
  dias_sin_visitar?: number;
  total_gastado?: number;
  ticket_promedio?: number;
}

export interface ClientesPaginadosMetadata {
  total: number;
  pagina: number;
  limite: number;
  total_paginas: number;
  tiene_siguiente: boolean;
  tiene_anterior: boolean;
  rango_inicio?: number;
  rango_fin?: number;
}

export interface ClientesPaginadosResult {
  clientes: Cliente[];
  metadata: ClientesPaginadosMetadata;
}

// 🔥 INTERFAZ ACTUALIZADA PARA LAS FICHAS DEL CLIENTE
export interface FichaCliente {
  _id: string;
  cliente_id: string;
  sede_id: string;
  cliente_id_antiguo?: string;
  servicio_id: string;
  servicio_nombre: string;
  profesional_id: string;
  profesional_nombre: string;
  sede_nombre: string;
  fecha_ficha: string;
  fecha_reserva: string;
  email: string | null;
  nombre: string;
  apellido: string | null;
  cedula: string;
  telefono: string;

  // 🔥 IMÁGENES EN NUEVA ESTRUCTURA
  fotos?: {
    antes: string[];
    despues: string[];
    antes_urls: string[];
    despues_urls: string[];
  };

  // 🔥 CAMPOS PARA COMPATIBILIDAD
  antes_url?: string;
  despues_url?: string;

  precio: string | number;
  estado: string;
  estado_pago: string;
  local: string;
  notas_cliente: string; // 🔥 CAMBIADO: Ahora es obligatorio
  comentario_interno: string;

  // 🔥 RESPUESTAS EN NUEVA ESTRUCTURA
  respuestas?: Array<{
    pregunta: string;
    respuesta: boolean;
    observaciones: string;
  }>;

  // 🔥 PARA COMPATIBILIDAD
  respuesta_1?: string;
  respuesta_2?: string;
  respuesta_3?: string;
  respuesta_4?: string;
  respuesta_5?: string;
  respuesta_6?: string;
  respuesta_7?: string;
  respuesta_8?: string;
  respuesta_9?: string;
  respuesta_10?: string;

  tipo_ficha?: string;
  datos_especificos?: any;
  descripcion_servicio?: string;
  autorizacion_publicacion?: boolean;
  created_at?: string;
  created_by?: string;
  user_id?: string;
  procesado_imagenes?: boolean;
  origen?: string;
  source_file?: string;
  migrated_at?: string;
  imagenes_actualizadas_at?: string;

  // 🔥 NUEVOS CAMPOS CON NOMBRES
  servicio: string;
  sede: string;
  estilista: string;
  sede_estilista: string;
}

// Helper functions fuera del objeto para evitar problemas con 'this'
const transformarHistorialCabello = (historialCitas: any[]): any[] => {
  return historialCitas.map(cita => ({
    tipo: cita.servicio,
    fecha: cita.fecha
  }));
};

const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).trim()
      if (normalized) {
        return normalized
      }
    }
  }
  return ""
}

const extractCedula = (cliente: any): string =>
  firstNonEmptyString(
    cliente?.cedula,
    cliente?.numero_cedula,
    cliente?.numeroDocumento,
    cliente?.numero_documento,
    cliente?.documento,
    cliente?.identificacion,
    cliente?.dni
  )

const calcDiasSinVisitar = (fecha?: string): number => {
  if (!fecha) return 0;
  try {
    const diff = Date.now() - new Date(fecha).getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  } catch {
    return 0;
  }
};

const resolveDiasSinVenir = (cliente: any): number => {
  if (cliente.dias_sin_visitar != null) return Number(cliente.dias_sin_visitar);
  const fecha = cliente.ultima_visita || cliente.fecha_ultima_visita || cliente.last_visit;
  return calcDiasSinVisitar(fecha);
};

const resolveLtv = (cliente: any): number =>
  cliente.total_gastado || cliente.total_compras || cliente.ltv || cliente.valor_total || 0;

const mapCliente = (cliente: any): Cliente => ({
  id: cliente.cliente_id || cliente.id || cliente._id || '',
  nombre: cliente.nombre || '',
  telefono: cliente.telefono || 'No disponible',
  email: cliente.correo || cliente.email || 'No disponible',
  cedula: extractCedula(cliente),
  ciudad: cliente.ciudad || '',
  diasSinVenir: resolveDiasSinVenir(cliente),
  diasSinComprar: resolveDiasSinVenir(cliente),
  ltv: resolveLtv(cliente),
  ticketPromedio: cliente.ticket_promedio || 0,
  rizotipo: cliente.rizotipo || '',
  nota: cliente.notas_historial?.[0]?.contenido || cliente.notas || '',
  notas_historial: cliente.notas_historial || [],
  sede_id: cliente.sede_id || '',
  fecha_creacion: cliente.fecha_creacion || '',
  ultima_visita: cliente.ultima_visita || cliente.fecha_ultima_visita || '',
  historialCitas: [],
  historialCabello: [],
  historialProductos: []
});

const CLIENTES_FETCH_TIMEOUT_MS = 20000;

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number = CLIENTES_FETCH_TIMEOUT_MS
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Tiempo de espera agotado al obtener clientes");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

// 🔥 FUNCIÓN PARA ARREGLAR URLs DE S3 HTTPS A HTTP
const fixS3Url = (url: string): string => {
  if (!url) return '';

  // Si es una URL de S3 de AWS, cambiar https por http para evitar problemas de certificado
  if (url.includes('s3.amazonaws.com') || url.includes('.s3.')) {
    return url.replace('https://', 'http://');
  }

  return url;
};

const resolveSedeHeaderId = (value?: string): string | undefined => {
  const normalized = String(value ?? getActiveSedeIdFromStorage() ?? "").trim();
  return normalized || undefined;
};

const buildClientHeaders = (
  token: string,
  options?: { hasJsonBody?: boolean; sedeId?: string }
): Record<string, string> => {
  const sedeHeaderId = resolveSedeHeaderId(options?.sedeId);

  return {
    accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(options?.hasJsonBody ? { "Content-Type": "application/json" } : {}),
    ...(sedeHeaderId ? { "X-Sede-Id": sedeHeaderId } : {}),
  };
};

export const clientesService = {
  async getClientesPaginados(
    token: string,
    params?: { pagina?: number; limite?: number; filtro?: string; sedeId?: string }
  ): Promise<ClientesPaginadosResult> {
    const paginaSolicitada = params?.pagina ?? 1;
    const limiteSolicitado = params?.limite ?? 10;
    const limite = Math.min(Math.max(limiteSolicitado, 1), 100);
    const filtro = params?.filtro?.trim();
    const sedeId = params?.sedeId?.trim();

    if (sedeId && sedeId !== "all") {
      const urlSede = new URL(`${API_BASE_URL}clientes/filtrar/${sedeId}`);
      if (filtro) {
        urlSede.searchParams.set("filtro", filtro);
      }

      const response = await fetchWithTimeout(urlSede.toString(), {
        method: "GET",
        headers: buildClientHeaders(token, { sedeId }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Error al obtener clientes por sede: ${errorText || response.statusText}`);
      }

      const data = await response.json();
      const rawClientes: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.clientes)
          ? data.clientes
          : Array.isArray(data?.data)
            ? data.data
            : [];

      const filtroLower = filtro?.toLowerCase();
      const clientesFiltrados = filtroLower
        ? rawClientes.filter((cliente) => {
            const nombre = String(cliente?.nombre ?? '').toLowerCase();
            const correo = String(cliente?.correo ?? cliente?.email ?? '').toLowerCase();
            const telefono = String(cliente?.telefono ?? '').toLowerCase();
            const cedula = String(cliente?.cedula ?? '').toLowerCase();
            const clienteId = String(cliente?.cliente_id ?? '').toLowerCase();
            return (
              nombre.includes(filtroLower) ||
              correo.includes(filtroLower) ||
              telefono.includes(filtroLower) ||
              cedula.includes(filtroLower) ||
              clienteId.includes(filtroLower)
            );
          })
        : rawClientes;

      const total = clientesFiltrados.length;
      const totalPaginas = total === 0 ? 1 : Math.ceil(total / limite);
      const pagina = Math.min(Math.max(paginaSolicitada, 1), totalPaginas);
      const start = (pagina - 1) * limite;
      const pageClientes = clientesFiltrados.slice(start, start + limite);

      return {
        clientes: pageClientes.map(mapCliente),
        metadata: {
          total,
          pagina,
          limite,
          total_paginas: totalPaginas,
          tiene_siguiente: pagina < totalPaginas,
          tiene_anterior: pagina > 1,
          rango_inicio: total === 0 ? 0 : start + 1,
          rango_fin: Math.min(start + pageClientes.length, total),
        },
      };
    }

    const url = new URL(`${API_BASE_URL}clientes/todos`);
    url.searchParams.set("pagina", String(paginaSolicitada));
    url.searchParams.set("limite", String(limite));
    if (filtro) {
      url.searchParams.set("filtro", filtro);
    }

    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: buildClientHeaders(token, { sedeId }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      let message = errorText || response.statusText || "Error desconocido";
      try {
        const parsed = errorText ? JSON.parse(errorText) : null;
        if (parsed?.detail) {
          message = parsed.detail;
        } else if (parsed?.message) {
          message = parsed.message;
        }
      } catch {
        // Mantener mensaje original
      }
      throw new Error(`Error al obtener clientes: ${message}`);
    }

    const data = await response.json();
    const rawClientes: any[] = Array.isArray(data?.clientes)
      ? data.clientes
      : Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : [];

    const meta = data?.metadata || {};
    const total = meta.total ?? rawClientes.length;
    const totalPaginas = meta.total_paginas ?? Math.max(1, Math.ceil(total / limite));
    const pagina = meta.pagina ?? paginaSolicitada;

    return {
      clientes: rawClientes.map(mapCliente),
      metadata: {
        total,
        pagina,
        limite: meta.limite ?? limite,
        total_paginas: totalPaginas,
        tiene_siguiente: meta.tiene_siguiente ?? pagina < totalPaginas,
        tiene_anterior: meta.tiene_anterior ?? pagina > 1,
        rango_inicio: meta.rango_inicio,
        rango_fin: meta.rango_fin,
      },
    };
  },

  async getClientes(
    token: string,
    sedeId?: string,
    options?: { filtro?: string; limite?: number }
  ): Promise<Cliente[]> {
    const limite = options?.limite ?? 100;
    const result = await this.getClientesPaginados(token, {
      pagina: 1,
      limite,
      filtro: options?.filtro,
      sedeId
    });
    return result.clientes;
  },

  async getAllClientes(token: string): Promise<Cliente[]> {
    const response = await fetch(`${API_BASE_URL}clientes/todos`, {
      method: 'GET',
      headers: buildClientHeaders(token)
    });

    if (!response.ok) {
      throw new Error(`Error al obtener todos los clientes: ${response.statusText}`);
    }

    const data: ClienteResponse[] = await response.json();

    return data.map(mapCliente);
  },

  async getClienteCedula(token: string, clienteId: string): Promise<{ cedula: string; ltv: number; diasSinVenir: number; ultima_visita: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}clientes/${clienteId}`, {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        return { cedula: '', ltv: 0, diasSinVenir: 0, ultima_visita: '' }
      }

      const cliente = await response.json()
      return {
        cedula: extractCedula(cliente),
        ltv: resolveLtv(cliente),
        diasSinVenir: resolveDiasSinVenir(cliente),
        ultima_visita: cliente.ultima_visita || cliente.fecha_ultima_visita || '',
      }
    } catch {
      return { cedula: '', ltv: 0, diasSinVenir: 0, ultima_visita: '' }
    }
  },

  async getClienteById(token: string, clienteId: string): Promise<Cliente> {
    const response = await fetch(`${API_BASE_URL}clientes/${clienteId}`, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Error al obtener cliente: ${response.statusText}`);
    }

    const cliente: ClienteResponse = await response.json();

    // Obtener historial adicional
    const [historialCitas, historialProductos, fichas] = await Promise.all([
      this.getHistorialCitas(token, clienteId),
      this.getHistorialProductos(token, clienteId),
      this.getFichasCliente(token, clienteId)
    ]);

    const rizotipoFicha = fichas?.[0]?.datos_especificos?.rizotipo
      || fichas?.[0]?.datos_especificos?.tipo_rizotipo
      || fichas?.[0]?.datos_especificos?.rizotipo_final
      || (cliente as any).rizotipo
      || '';

    return {
      id: cliente.cliente_id,
      nombre: cliente.nombre,
      telefono: cliente.telefono || 'No disponible',
      email: cliente.correo || 'No disponible',
      cedula: extractCedula(cliente),
      ciudad: cliente.ciudad || '',
      diasSinVenir: resolveDiasSinVenir(cliente),
      diasSinComprar: resolveDiasSinVenir(cliente),
      ltv: resolveLtv(cliente),
      ticketPromedio: cliente.ticket_promedio || 0,
      rizotipo: rizotipoFicha,
      nota: (cliente as any).notas_historial?.[0]?.contenido || '',
      notas_historial: (cliente as any).notas_historial || [],
      sede_id: cliente.sede_id,
      fecha_creacion: cliente.fecha_creacion || '',
      ultima_visita: (cliente as any).ultima_visita || '',
      historialCitas,
      historialCabello: transformarHistorialCabello(historialCitas),
      historialProductos,
      fichas
    };
  },

  // 🔥 NUEVO MÉTODO: OBTENER FICHAS DEL CLIENTE - CORREGIDO
  // 🔥 NUEVO MÉTODO: OBTENER FICHAS DEL CLIENTE - CORREGIDO
  async getFichasCliente(token: string, clienteId: string): Promise<FichaCliente[]> {
    try {
      console.log(`🔍 Obteniendo fichas para cliente: ${clienteId}`);

      const response = await fetch(`${API_BASE_URL}clientes/fichas/${clienteId}`, {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`ℹ️ No se encontraron fichas para el cliente ${clienteId}`);
          return [];
        }
        console.error(`❌ Error ${response.status} obteniendo fichas:`, response.statusText);
        return [];
      }

      const fichas: FichaCliente[] = await response.json();

      console.log(`✅ Se obtuvieron ${fichas.length} fichas para el cliente ${clienteId}`);

      // 🔥 TRANSFORMAR LOS DATOS PARA COMPATIBILIDAD
      return fichas.map(ficha => {
        console.log('📊 Estructura de ficha recibida:', ficha);

        // 🔥 FUNCIÓN PARA ARREGLAR URLs DE S3
        const fixAllUrls = (urls: string[] | undefined): string[] => {
          if (!urls || !Array.isArray(urls)) return [];
          return urls.map(fixS3Url);
        };

        // 🔥 EXTRAER PRIMERA IMAGEN DE "ANTES" Y "DESPUÉS" - ARREGLANDO URLs
        const primeraImagenAntes = fixS3Url(ficha.fotos?.antes?.[0] || '');
        const primeraImagenDespues = fixS3Url(ficha.fotos?.despues?.[0] || '');

        // 🔥 ARREGLAR TODAS LAS URLs DE FOTOS
        const fotosArregladas = ficha.fotos ? {
          ...ficha.fotos,
          antes: fixAllUrls(ficha.fotos.antes),
          despues: fixAllUrls(ficha.fotos.despues),
          antes_urls: fixAllUrls(ficha.fotos.antes_urls),
          despues_urls: fixAllUrls(ficha.fotos.despues_urls)
        } : undefined;

        // 🔥 EXTRAER INFORMACIÓN DE DATOS_ESPECIFICOS SI EXISTE
        let notasDeDiagnostico = '';
        let recomendaciones = '';

        if (ficha.datos_especificos) {
          // 🔥 CONSTRUIR NOTAS A PARTIR DE DATOS_ESPECIFICOS
          const datos = ficha.datos_especificos;

          const respuestasTextuales = ficha.respuestas?.map(r =>
            `${r.pregunta}: ${r.respuesta}${r.observaciones ? ` - ${r.observaciones}` : ''}`
          ).join('\n') || '';

          notasDeDiagnostico = `🧪 DIAGNÓSTICO DE RIZOTIPO:
${respuestasTextuales}

📋 RECOMENDACIONES PERSONALIZADAS:
${datos.recomendaciones_personalizadas || 'Sin recomendaciones'}

✂️ FRECUENCIA DE CORTE:
${datos.frecuencia_corte || 'No especificada'}

💆 TÉCNICAS DE ESTILIZADO:
${datos.tecnicas_estilizado || 'No especificadas'}

🧴 PRODUCTOS SUGERIDOS:
${datos.productos_sugeridos || 'No especificados'}

📝 OBSERVACIONES GENERALES:
${datos.observaciones_generales || 'Ninguna'}`;

          recomendaciones = datos.recomendaciones_personalizadas || '';
        }

        // 🔥 DETERMINAR NOTAS DEL CLIENTE (PRIORIDAD)
        const notasClienteAseguradas =
          ficha.notas_cliente?.trim() ||
          notasDeDiagnostico ||
          ficha.descripcion_servicio ||
          'Sin notas';

        // 🔥 DETERMINAR COMENTARIO INTERNO
        const comentarioInternoAsegurado =
          ficha.comentario_interno?.trim() ||
          recomendaciones ||
          ficha.descripcion_servicio ||
          'Sin comentarios';

        return {
          ...ficha,
          // 🔥 AGREGAR CAMPOS DE COMPATIBILIDAD CON VALORES ASEGURADOS
          fotos: fotosArregladas,
          antes_url: primeraImagenAntes,
          despues_url: primeraImagenDespues,
          notas_cliente: notasClienteAseguradas,
          comentario_interno: comentarioInternoAsegurado,

          // 🔥 VALORES POR DEFECTO
          precio: ficha.precio || '0',
          estado: ficha.estado || 'completado',
          estado_pago: ficha.estado_pago || 'pagado',
          local: ficha.local || ficha.sede || '',

          // 🔥 Asegurar que los campos de nombres estén completos
          servicio: ficha.servicio || ficha.servicio_nombre || 'Servicio sin nombre',
          servicio_nombre: ficha.servicio_nombre || ficha.servicio || 'Servicio sin nombre',
          sede: ficha.sede || ficha.sede_nombre || 'Sede no especificada',
          sede_nombre: ficha.sede_nombre || ficha.sede || 'Sede no especificada',
          estilista: ficha.estilista || ficha.profesional_nombre || 'Estilista no asignado',
          profesional_nombre: ficha.profesional_nombre || ficha.estilista || 'Estilista no asignado',
          sede_estilista: ficha.sede_estilista || ficha.sede || ficha.sede_nombre || 'Sede no especificada',

          // 🔥 Asegurar campos obligatorios
          email: ficha.email || '',
          apellido: ficha.apellido || '',
          nombre: ficha.nombre || '',
          cedula: ficha.cedula || '',
          telefono: ficha.telefono || '',

          // 🔥 Agregar fecha formateada
          fecha_ficha_formatted: ficha.fecha_ficha,

          // 🔥 Preservar datos específicos
          datos_especificos: ficha.datos_especificos,
          respuestas: ficha.respuestas || []
        };
      });

    } catch (error) {
      console.error('❌ Error obteniendo fichas del cliente:', error);
      return [];
    }
  },

  async createCliente(token: string, cliente: CreateClienteData): Promise<ClienteResponse> {
    const nombre = cliente.nombre?.trim();
    if (!nombre) {
      throw new Error('El nombre del cliente es requerido');
    }

    const requestData: Record<string, string> = { nombre };
    const addIfPresent = (key: string, value?: string) => {
      const normalized = value?.trim();
      if (normalized) requestData[key] = normalized;
    };

    addIfPresent('correo', cliente.correo);
    addIfPresent('telefono', cliente.telefono);
    addIfPresent('notas', cliente.notas);
    addIfPresent('sede_id', cliente.sede_id);
    addIfPresent('cedula', cliente.cedula);
    addIfPresent('ciudad', cliente.ciudad);
    addIfPresent('fecha_de_nacimiento', cliente.fecha_de_nacimiento);

    console.log('📤 Creando cliente con datos:', requestData);

    const response = await fetch(`${API_BASE_URL}clientes/`, {
      method: 'POST',
      headers: buildClientHeaders(token, {
        hasJsonBody: true,
        sedeId: requestData.sede_id,
      }),
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      let errorMessage = `Error ${response.status}: ${response.statusText}`;

      try {
        const errorData = await response.json();
        console.error('❌ Error del backend:', errorData);

        if (errorData.detail) {
          errorMessage = errorData.detail;
        }
      } catch (parseError) {
        console.error('Error parseando respuesta:', parseError);
      }

      throw new Error(errorMessage);
    }

    return await response.json();
  },

  // services/clientesService.ts - Solo un método updateCliente
  async updateCliente(token: string, clienteId: string, cliente: UpdateClienteData): Promise<any> {
    // Preparar los datos completos del cliente
    const requestData: any = {
      cliente_id: clienteId, // Mantener el mismo ID
      nombre: cliente.nombre?.trim(),
      correo: cliente.correo?.trim(),
      telefono: cliente.telefono?.trim(),
      cedula: cliente.cedula?.trim(),
      ciudad: cliente.ciudad?.trim(),
      fecha_de_nacimiento: cliente.fecha_de_nacimiento?.trim(),
      sede_id: cliente.sede_id?.trim(),
      notas: cliente.notas?.trim()
    };

    // Eliminar campos vacíos o undefined (excepto algunos que pueden ser opcionales)
    Object.keys(requestData).forEach(key => {
      if (requestData[key] === undefined || requestData[key] === '') {
        // No eliminamos los campos que son parte del schema pero pueden estar vacíos
        // según el API
        if (key !== 'correo' && key !== 'telefono' && key !== 'cedula' &&
          key !== 'ciudad' && key !== 'fecha_de_nacimiento' && key !== 'notas') {
          delete requestData[key];
        }
      }
    });

    console.log('📤 Actualizando cliente con datos:', {
      clienteId,
      requestData
    });

    const response = await fetch(`${API_BASE_URL}clientes/${clienteId}`, {
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
      const errorMessage = errorData?.detail || `Error ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage);
    }

    return await response.json();
  },

  async agregarNota(token: string, clienteId: string, nota: string, autor?: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}clientes/${clienteId}/notas`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ contenido: nota, ...(autor ? { autor } : {}) })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || `Error al agregar nota: ${response.statusText}`);
    }
  },

  async getHistorialCitas(token: string, clienteId: string): Promise<any[]> {
    try {
      console.log(`🔍 Obteniendo historial de citas para cliente: ${clienteId}`);

      const response = await fetch(`${API_BASE_URL}clientes/${clienteId}/historial`, {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.log(`ℹ️ No se encontró historial de citas para el cliente ${clienteId}`);
        return [];
      }

      const citas = await response.json();

      console.log(`✅ Se obtuvieron ${citas.length} citas del historial`);

      // 🔥 DEBUG: Mostrar estructura de la primera cita
      if (citas.length > 0) {
        console.log('📊 ESTRUCTURA DE LA PRIMERA CITA:', {
          _id: citas[0]._id,
          fecha: citas[0].fecha, // Aquí debería ser '2025-12-19'
          servicio_nombre: citas[0].servicio_nombre,
          profesional_nombre: citas[0].profesional_nombre,
          estado: citas[0].estado,
          estado_pago: citas[0].estado_pago,
          valor_total: citas[0].valor_total,
          metodo_pago: citas[0].metodo_pago,
          notas: citas[0].notas
        });
      }

      // 🔥 TRANSFORMAR LAS CITAS CORRECTAMENTE
      return citas.map((cita: any) => {
        // Obtener estilista - YA VIENE EN profesional_nombre
        const estilista = cita.profesional_nombre || 'Estilista no especificado';

        // 🔥 NO FORMATAR LA FECHA AQUÍ - DEJARLA COMO VIENE DEL SERVIDOR
        const fechaOriginal = cita.fecha; // Esto debería ser '2025-12-19'
        console.log(`📅 Fecha original del servidor para cita ${cita._id}: ${fechaOriginal}`);

        // Obtener servicio
        const servicio = cita.servicio_nombre
          || cita.servicios?.[0]?.nombre
          || 'Servicio no especificado';

        // Obtener notas (si existen)
        const notas = cita.notas || '';

        // Obtener método de pago
        const metodoPago = cita.metodo_pago
          || cita.metodo_pago_actual
          || cita.metodo_pago_inicial
          || 'No especificado';

        // Obtener estado de pago
        const estadoPago = cita.estado_pago || 'pendiente';

        // Obtener valor total
        const valorTotal = cita.valor_total || 0;

        // Obtener moneda
        const moneda = cita.moneda || 'COP';

        // Formatear valor
        const locale = moneda === "USD" ? "en-US" : moneda === "MXN" ? "es-MX" : "es-CO";
        const valorFormateado = `${formatCurrencyNoDecimals(valorTotal, moneda, locale)} ${moneda}`;

        return {
          fecha: fechaOriginal, // 🔥 DEVOLVER FECHA ORIGINAL '2025-12-19'
          servicio: servicio,
          profesional: estilista,
          estilista: estilista,
          notas: notas,
          metodo_pago: metodoPago,
          estado_pago: estadoPago,
          valor_total: valorFormateado,
          moneda: moneda,
          hora_inicio: cita.hora_inicio || '',
          hora_fin: cita.hora_fin || '',
          estado: cita.estado || 'confirmada',
          // 🔥 GUARDAR DATOS COMPLETOS PARA USO FUTURO
          datos_completos: {
            ...cita,
            // Incluir todos los datos originales
            _id: cita._id,
            sede_id: cita.sede_id,
            cliente_id: cita.cliente_id,
            profesional_id: cita.profesional_id,
            servicio_id: cita.servicio_id,
            cliente_nombre: cita.cliente_nombre,
            cliente_email: cita.cliente_email,
            cliente_telefono: cita.cliente_telefono,
            profesional_email: cita.profesional_email,
            sede_nombre: cita.sede_nombre,
            creada_por: cita.creada_por,
            fecha_creacion: cita.fecha_creacion
          }
        };
      });
    } catch (error) {
      console.error('❌ Error obteniendo historial de citas:', error);
      return [];
    }
  },

  // 🔥 NUEVO MÉTODO: OBTENER HISTORIAL DE PRODUCTOS - CORREGIDO
  async getHistorialProductos(token: string, clienteId: string): Promise<any[]> {
    try {
      console.log(`🛍️ Obteniendo historial de productos para cliente: ${clienteId}`);

      // Primero obtenemos el historial de citas
      const historialCitas = await this.getHistorialCitas(token, clienteId);

      if (historialCitas.length === 0) {
        console.log(`ℹ️ No hay historial de citas para el cliente ${clienteId}`);
        return [];
      }

      console.log(`📊 Transformando ${historialCitas.length} citas a productos`);

      // 🔥 TRANSFORMAR LAS CITAS EN "PRODUCTOS" PARA MOSTRAR
      return historialCitas.map(cita => {
        console.log(`📅 Fecha de cita a convertir a producto: ${cita.fecha}`);

        return {
          producto: cita.servicio, // Usamos el nombre del servicio como producto
          fecha: cita.fecha, // 🔥 FECHA ORIGINAL '2025-12-19' (no formateada)
          precio: cita.valor_total,
          estilista: cita.estilista,
          estado_pago: cita.estado_pago,
          metodo_pago: cita.metodo_pago,
          // 🔥 Agregar datos adicionales si los necesitas
          servicio_id: cita.datos_completos?.servicio_id,
          cita_id: cita.datos_completos?._id,
          estado_cita: cita.estado
        };
      });

    } catch (error) {
      console.error('❌ Error obteniendo historial de productos:', error);
      return [];
    }
  },

  async generarPDFCita(token: string, clienteId: string, citaId: string): Promise<Blob> {
    const response = await fetch(
      `${API_BASE_URL}api/pdf/generar-pdf/${clienteId}/${citaId}`,
      { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/pdf' } }
    );
    if (!response.ok) throw new Error(`Error ${response.status}`);
    const blob = await response.blob();
    if (blob.size === 0 || !blob.type.includes('pdf')) throw new Error('PDF inválido');
    return blob;
  },

  async generarPDFDesdeFicha(token: string, clienteId: string, ficha: any): Promise<void> {
    const citaId = ficha.datos_especificos?.cita_id;
    if (!citaId) throw new Error('La ficha no tiene un cita_id asociado');
    const blob = await this.generarPDFCita(token, clienteId, citaId);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const timestamp = new Date().toISOString().split('T')[0];
    const nombre = (ficha.nombre || 'cliente').replace(/\s+/g, '_').toLowerCase();
    const servicio = (ficha.servicio_nombre || ficha.servicio || 'servicio').replace(/\s+/g, '_').toLowerCase().substring(0, 30);
    link.download = `comprobante_${nombre}_${servicio}_${timestamp}.pdf`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { document.body.removeChild(link); window.URL.revokeObjectURL(url); }, 100);
  },

};
