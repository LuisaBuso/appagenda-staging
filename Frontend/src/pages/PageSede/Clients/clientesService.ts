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

export interface SegmentCounts {
  total: number;
  activos: number;
  en_riesgo: number;
  perdidos: number;
  nuevos: number;
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
  notas_cliente: string;
  comentario_interno: string;

  // 🔥 RESPUESTAS EN NUEVA ESTRUCTURA
  respuestas?: Array<{
    pregunta: string;
    respuesta: boolean;
    observaciones: string;
  }>;

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

  servicio: string;
  sede: string;
  estilista: string;
  sede_estilista: string;
}

// 🔥 INTERFAZ PARA INFO DE PDF
export interface PDFInfoResponse {
  success: boolean;
  message: string;
  cliente: {
    id: string;
    nombre: string;
    documento: string;
    email: string;
  };
  cita: {
    id: string;
    servicio: string;
    fecha: string;
    estado: string;
    valor_total: number;
  };
  pdf: {
    tamano_bytes: number;
    tamano_kb: number;
    fecha_generacion: string;
    disponible_descarga: boolean;
  };
  download_url: string;
  advertencia?: string;
}

// Helper functions
const transformarHistorialCabello = (historialCitas: any[]): any[] => {
  return historialCitas.map(cita => ({
    tipo: cita.servicio,
    fecha: cita.fecha
  }));
};

// 🔥 FUNCIÓN PARA ARREGLAR URLs DE S3 HTTPS A HTTP
const fixS3Url = (url: string): string => {
  if (!url) return '';

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
  const fecha = cliente.ultima_visita || cliente.fecha_ultima_visita || cliente.last_visit;
  if (fecha) return calcDiasSinVisitar(fecha);
  if (cliente.dias_sin_visitar != null) return Number(cliente.dias_sin_visitar);
  return 0;
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
  segmento: cliente.segmento || undefined,
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

export const clientesService = {
  async getClientesPaginados(
    token: string,
    params?: { pagina?: number; limite?: number; filtro?: string; segmento?: string; sede_interacciones?: string },
    sedeHeaderId?: string
  ): Promise<ClientesPaginadosResult> {
    const pagina = params?.pagina ?? 1;
    const limiteSolicitado = params?.limite ?? 10;
    const limite = Math.min(Math.max(limiteSolicitado, 1), 100);
    const filtro = params?.filtro?.trim();
    const normalizedSedeHeaderId = sedeHeaderId?.trim();

    const url = new URL(`${API_BASE_URL}clientes/todos`);
    url.searchParams.set("pagina", String(pagina));
    url.searchParams.set("limite", String(limite));
    if (filtro) {
      url.searchParams.set("filtro", filtro);
    }
    if (params?.segmento) {
      url.searchParams.set("segmento", params.segmento);
    }
    if (params?.sede_interacciones) {
      url.searchParams.set("sede_interacciones", params.sede_interacciones);
    }

    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(normalizedSedeHeaderId ? { "X-Sede-Id": normalizedSedeHeaderId } : {}),
      },
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
        // mantener mensaje original
      }
      throw new Error(`Error al obtener clientes: ${message}`);
    }

    const data = await response.json();
    let rawClientes: any[] = [];

    if (data?.clientes && Array.isArray(data.clientes)) {
      rawClientes = data.clientes;
    } else if (Array.isArray(data)) {
      rawClientes = data;
    } else if (data?.data && Array.isArray(data.data)) {
      rawClientes = data.data;
    }

    const meta = data?.metadata || {};
    const total = meta.total ?? rawClientes.length;
    const totalPaginas = meta.total_paginas ?? Math.max(1, Math.ceil(total / limite));
    const paginaActual = meta.pagina ?? pagina;

    return {
      clientes: rawClientes.map(mapCliente),
      metadata: {
        total,
        pagina: paginaActual,
        limite: meta.limite ?? limite,
        total_paginas: totalPaginas,
        tiene_siguiente: meta.tiene_siguiente ?? paginaActual < totalPaginas,
        tiene_anterior: meta.tiene_anterior ?? paginaActual > 1,
        rango_inicio: meta.rango_inicio,
        rango_fin: meta.rango_fin
      }
    };
  },

  async getAllClientes(token: string, limite: number = 100): Promise<Cliente[]> {
    try {
      console.log(`📋 Cargando TODOS los clientes...`);

      // Primera petición para obtener metadata
      const primeraRespuesta = await fetch(`${API_BASE_URL}clientes/todos?limite=${limite}&pagina=1`, {
        method: 'GET',
        headers: buildClientHeaders(token)
      });

      if (!primeraRespuesta.ok) {
        const errorText = await primeraRespuesta.text();
        console.error(`❌ Error ${primeraRespuesta.status} en /clientes/todos:`, errorText);
        throw new Error(`Error al obtener clientes: ${primeraRespuesta.status} ${primeraRespuesta.statusText}`);
      }

      const primeraData = await primeraRespuesta.json();
      
      // Extraer clientes de la primera página
      let todosLosClientesRaw: any[] = [];
      
      if (primeraData.clientes && Array.isArray(primeraData.clientes)) {
        todosLosClientesRaw = [...primeraData.clientes];
      } else if (Array.isArray(primeraData)) {
        todosLosClientesRaw = [...primeraData];
      }

      // Obtener metadata
      const metadata = primeraData.metadata;
      const totalPaginas = metadata?.total_paginas || 1;
      const totalClientes = metadata?.total || todosLosClientesRaw.length;

      console.log(`📊 Total: ${totalClientes} clientes en ${totalPaginas} páginas`);

      // Si hay más de una página, obtener el resto en paralelo
      if (totalPaginas > 1) {
        console.log(`🚀 Descargando ${totalPaginas - 1} páginas adicionales en paralelo...`);
        
        const promesas = [];
        for (let p = 2; p <= totalPaginas; p++) {
          promesas.push(
            fetch(`${API_BASE_URL}clientes/todos?limite=${limite}&pagina=${p}`, {
              method: 'GET',
              headers: buildClientHeaders(token)
            })
            .then(async (res) => {
              if (!res.ok) {
                console.error(`❌ Error en página ${p}: ${res.status}`);
                return { clientes: [] };
              }
              const data = await res.json();
              return data;
            })
          );
        }

        // Ejecutar todas las peticiones en paralelo
        const resultados = await Promise.all(promesas);

        // Combinar todos los clientes
        resultados.forEach((data) => {
          if (data.clientes && Array.isArray(data.clientes)) {
            todosLosClientesRaw = [...todosLosClientesRaw, ...data.clientes];
          } else if (Array.isArray(data)) {
            todosLosClientesRaw = [...todosLosClientesRaw, ...data];
          }
        });
      }

      console.log(`✅ Total de clientes obtenidos: ${todosLosClientesRaw.length}`);

      // Transformar la respuesta al formato Cliente
      return todosLosClientesRaw.map(mapCliente);

    } catch (error) {
      console.error('❌ Error en getAllClientes:', error);
      throw error;
    }
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
  async getFichasCliente(token: string, clienteId: string): Promise<FichaCliente[]> {
    try {
      console.log(`🔍 Obteniendo fichas para cliente: ${clienteId}`);

      const response = await fetch(`${API_BASE_URL}scheduling/quotes/fichas?cliente_id=${clienteId}&solo_hoy=false&limit=200`, {
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

      const payload: any = await response.json();
      const fichas: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.fichas)
            ? payload.fichas
            : [];

      console.log(`✅ Se obtuvieron ${fichas.length} fichas para el cliente ${clienteId}`);

      if (fichas.length === 0) {
        return [];
      }

      const safeText = (value: unknown, fallback: string): string => {
        if (typeof value === 'string') {
          const clean = value.trim();
          return clean || fallback;
        }
        if (value === null || value === undefined) {
          return fallback;
        }
        const clean = String(value).trim();
        return clean || fallback;
      };

      // 🔥 TRANSFORMAR LOS DATOS PARA COMPATIBILIDAD
      const fichasTransformadas = fichas
        .map((ficha, index) => {
          try {
            if (!ficha || typeof ficha !== 'object') {
              return null;
            }

            // 🔥 DETERMINAR EL NOMBRE CORRECTO DEL PROFESIONAL
            let nombreProfesionalFinal = safeText((ficha as any).profesional_nombre, '');
            const estilistaRaw = safeText((ficha as any).estilista, '');

            if (nombreProfesionalFinal === "Estilista" && estilistaRaw && estilistaRaw !== "Estilista") {
              nombreProfesionalFinal = estilistaRaw;
            }
            if (!nombreProfesionalFinal) {
              nombreProfesionalFinal = estilistaRaw || "Sin profesional";
            }

            // 🔥 FUNCIÓN PARA ARREGLAR URLs DE S3
            const fixAllUrls = (urls: unknown): string[] => {
              if (!Array.isArray(urls)) return [];
              return urls
                .map((url) => (typeof url === 'string' ? fixS3Url(url) : ''))
                .filter(Boolean);
            };

            const fotos = (ficha as any).fotos && typeof (ficha as any).fotos === 'object'
              ? (ficha as any).fotos
              : undefined;

            // 🔥 EXTRAER PRIMERA IMAGEN DE "ANTES" Y "DESPUÉS" - ARREGLANDO URLs
            const primeraImagenAntes = fixS3Url((Array.isArray(fotos?.antes) ? fotos.antes[0] : '') || '');
            const primeraImagenDespues = fixS3Url((Array.isArray(fotos?.despues) ? fotos.despues[0] : '') || '');

            // 🔥 ARREGLAR TODAS LAS URLs DE FOTOS
            const fotosArregladas = fotos ? {
              ...fotos,
              antes: fixAllUrls(fotos.antes),
              despues: fixAllUrls(fotos.despues),
              antes_urls: fixAllUrls(fotos.antes_urls),
              despues_urls: fixAllUrls(fotos.despues_urls)
            } : undefined;

            // 🔥 CREAR OBJETO TRANSFORMADO
            const fichaTransformada: FichaCliente = {
              ...(ficha as any),
              _id: safeText((ficha as any)._id ?? (ficha as any).id, `${clienteId}-${index}`),
              cliente_id: safeText((ficha as any).cliente_id, clienteId),
              sede_id: safeText((ficha as any).sede_id, ''),
              servicio_id: safeText((ficha as any).servicio_id, ''),
              profesional_id: safeText((ficha as any).profesional_id, ''),
              fecha_ficha: safeText((ficha as any).fecha_ficha, ''),
              fecha_reserva: safeText((ficha as any).fecha_reserva, ''),
              profesional_nombre: nombreProfesionalFinal,
              estilista: nombreProfesionalFinal,

              // 🔥 AGREGAR CAMPOS DE COMPATIBILIDAD CON VALORES ASEGURADOS
              fotos: fotosArregladas,
              antes_url: primeraImagenAntes,
              despues_url: primeraImagenDespues,
              notas_cliente: safeText((ficha as any).notas_cliente, 'Sin notas'),
              comentario_interno: safeText((ficha as any).comentario_interno, 'Sin comentarios'),

              // 🔥 VALORES POR DEFECTO
              precio: (ficha as any).precio || '0',
              estado: safeText((ficha as any).estado, 'completado'),
              estado_pago: safeText((ficha as any).estado_pago, 'pagado'),
              local: safeText((ficha as any).local || (ficha as any).sede, ''),

              // 🔥 Asegurar que los campos de nombres estén completos
              servicio: safeText((ficha as any).servicio || (ficha as any).servicio_nombre, 'Servicio sin nombre'),
              servicio_nombre: safeText((ficha as any).servicio_nombre || (ficha as any).servicio, 'Servicio sin nombre'),
              sede: safeText((ficha as any).sede || (ficha as any).sede_nombre, 'Sede no especificada'),
              sede_nombre: safeText((ficha as any).sede_nombre || (ficha as any).sede, 'Sede no especificada'),
              sede_estilista: safeText((ficha as any).sede_estilista || (ficha as any).sede || (ficha as any).sede_nombre, 'Sede no especificada'),

              // 🔥 Asegurar campos obligatorios
              email: safeText((ficha as any).email, ''),
              apellido: safeText((ficha as any).apellido, ''),
              nombre: safeText((ficha as any).nombre, ''),
              cedula: safeText((ficha as any).cedula, ''),
              telefono: safeText((ficha as any).telefono, ''),

              // 🔥 Preservar datos específicos
              datos_especificos: (ficha as any).datos_especificos,
              respuestas: Array.isArray((ficha as any).respuestas) ? (ficha as any).respuestas : []
            };

            return fichaTransformada;
          } catch (itemError) {
            console.error(`❌ Error transformando ficha ${index} del cliente ${clienteId}:`, itemError);
            return null;
          }
        })
        .filter((ficha): ficha is FichaCliente => Boolean(ficha));

      console.log(`✅ Fichas transformadas para UI: ${fichasTransformadas.length}`);
      return fichasTransformadas;

    } catch (error) {
      console.error('❌ Error obteniendo fichas del cliente:', error);
      return [];
    }
  },

  // 🔥 MÉTODOS PARA MANEJAR PDFs
  async generarPDFCita(token: string, clienteId: string, citaId: string): Promise<Blob> {
    try {
      const response = await fetch(
        `${API_BASE_URL}api/pdf/generar-pdf/${clienteId}/${citaId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/pdf'
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      const blob = await response.blob();

      if (blob.size === 0 || !blob.type.includes('pdf')) {
        throw new Error('El archivo recibido no es un PDF válido');
      }

      return blob;

    } catch (error) {
      console.error('❌ Error generando PDF:', error);
      throw error;
    }
  },

  async obtenerInfoPDF(token: string, clienteId: string, citaId: string): Promise<PDFInfoResponse> {
    try {
      const response = await fetch(
        `${API_BASE_URL}api/pdf/generar-pdf-info/${clienteId}/${citaId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      return await response.json();

    } catch (error) {
      console.error('❌ Error obteniendo información del PDF:', error);
      throw error;
    }
  },

  async reenviarPDFCorreo(
    token: string,
    clienteId: string,
    citaId: string,
    emailDestino?: string
  ): Promise<{ success: boolean; message: string; email_destino: string }> {
    try {
      const body: any = {};
      if (emailDestino) {
        body.email_destino = emailDestino;
      }

      const response = await fetch(
        `${API_BASE_URL}reenviar-pdf-correo/${clienteId}/${citaId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      return await response.json();

    } catch (error) {
      console.error('❌ Error reenviando PDF por correo:', error);
      throw error;
    }
  },

  async descargarPDF(
    token: string,
    clienteId: string,
    citaId: string,
    nombreCliente: string,
    servicioNombre: string
  ): Promise<void> {
    try {
      const blob = await this.generarPDFCita(token, clienteId, citaId);

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const timestamp = new Date().toISOString().split('T')[0];
      const nombreClienteSanitizado = nombreCliente.replace(/\s+/g, '_').toLowerCase();
      const servicioSanitizado = servicioNombre
        .replace(/\s+/g, '_')
        .toLowerCase()
        .substring(0, 30);

      link.download = `comprobante_${nombreClienteSanitizado}_${servicioSanitizado}_${timestamp}.pdf`;

      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }, 100);

    } catch (error) {
      console.error('❌ Error descargando PDF:', error);
      throw error;
    }
  },

  async generarPDFDesdeFicha(
    token: string,
    clienteId: string,
    ficha: FichaCliente
  ): Promise<void> {
    try {
      const citaId = ficha.datos_especificos?.cita_id;

      if (!citaId) {
        throw new Error('La ficha no tiene un cita_id asociado');
      }

      await this.descargarPDF(
        token,
        clienteId,
        citaId,
        ficha.nombre,
        ficha.servicio_nombre || ficha.servicio
      );

    } catch (error) {
      console.error('❌ Error generando PDF desde ficha:', error);
      throw error;
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

  async updateCliente(token: string, clienteId: string, cliente: UpdateClienteData): Promise<any> {
    const requestData: any = {
      cliente_id: clienteId,
      nombre: cliente.nombre?.trim(),
      correo: cliente.correo?.trim(),
      telefono: cliente.telefono?.trim(),
      cedula: cliente.cedula?.trim(),
      ciudad: cliente.ciudad?.trim(),
      fecha_de_nacimiento: cliente.fecha_de_nacimiento?.trim(),
      sede_id: cliente.sede_id?.trim(),
      notas: cliente.notas?.trim()
    };

    // Eliminar campos vacíos
    Object.keys(requestData).forEach(key => {
      if (requestData[key] === undefined || requestData[key] === '') {
        if (key !== 'correo' && key !== 'telefono' && key !== 'cedula' &&
          key !== 'ciudad' && key !== 'fecha_de_nacimiento' && key !== 'notas') {
          delete requestData[key];
        }
      }
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

      return citas.map((cita: any) => {
        const profesional = cita.profesional_nombre || 'Profesional no especificado';
        const servicio = cita.servicio_nombre
          || cita.servicios?.[0]?.nombre
          || 'Servicio no especificado';
        const notas = cita.notas || '';
        const metodoPago = cita.metodo_pago
          || cita.metodo_pago_actual
          || cita.metodo_pago_inicial
          || 'No especificado';
        const estadoPago = cita.estado_pago || 'pendiente';
        const valorTotal = cita.valor_total || 0;
        const moneda = cita.moneda || 'COP';

        const locale = moneda === "USD" ? "en-US" : moneda === "MXN" ? "es-MX" : "es-CO";
        const valorFormateado = `${formatCurrencyNoDecimals(valorTotal, moneda, locale)} ${moneda}`;

        return {
          fecha: cita.fecha,
          servicio: servicio,
          profesional: profesional,
          estilista: profesional,
          notas: notas,
          metodo_pago: metodoPago,
          estado_pago: estadoPago,
          valor_total: valorFormateado,
          moneda: moneda,
          hora_inicio: cita.hora_inicio || '',
          hora_fin: cita.hora_fin || '',
          estado: cita.estado || 'confirmada',
          datos_completos: {
            ...cita,
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

  async getHistorialProductos(token: string, clienteId: string): Promise<any[]> {
    try {
      const historialCitas = await this.getHistorialCitas(token, clienteId);

      if (historialCitas.length === 0) {
        return [];
      }

      return historialCitas.map(cita => ({
        producto: cita.servicio,
        fecha: cita.fecha,
        precio: cita.valor_total,
        estilista: cita.estilista,
        estado_pago: cita.estado_pago,
        metodo_pago: cita.metodo_pago,
        servicio_id: cita.datos_completos?.servicio_id,
        cita_id: cita.datos_completos?._id,
        estado_cita: cita.estado
      }));

    } catch (error) {
      console.error('❌ Error obteniendo historial de productos:', error);
      return [];
    }
  },

  // 🔥 MÉTODO SIMPLIFICADO: SIEMPRE USA getAllClientes
  async obtenerClientes(token: string): Promise<Cliente[]> {
    console.log('🌍 Usando endpoint /clientes/todos para obtener todos los clientes');
    return this.getAllClientes(token);
  },

  async getSegmentCounts(token: string): Promise<SegmentCounts> {
    const response = await fetchWithTimeout(`${API_BASE_URL}clientes/analytics`, {
      method: "GET",
      headers: { accept: "application/json", Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return { total: 0, activos: 0, en_riesgo: 0, perdidos: 0, nuevos: 0 };
    const data = await response.json();
    const eb = data?.estado_base ?? {};
    return {
      total: eb.total ?? 0,
      activos: eb.activos ?? 0,
      en_riesgo: eb.en_riesgo ?? 0,
      perdidos: eb.perdidos ?? 0,
      nuevos: eb.sin_visita ?? 0,
    };
  },

};