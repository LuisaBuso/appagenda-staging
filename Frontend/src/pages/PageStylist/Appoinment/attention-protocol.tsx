// src/components/AttentionProtocol.tsx - VERSIÓN CORREGIDA CON ENDPOINT DE FICHAS
"use client";

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { ChevronRight, Calendar, FileText, Package, Save, CheckCircle, ArrowLeft, Eye, Download, Camera, Clock, AlertCircle } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { FichaDiagnosticoRizotipo } from './fichas/FichaDiagnosticoRizotipo'
import { FichaColor } from './fichas/FichaColor'
import { FichaAsesoriaCorte } from './fichas/FichaAsesoriaCorte'
import { FichaCuidadoPostColor } from './fichas/FichaCuidadoPostColor'
import { FichaValoracionPruebaColor } from './fichas/FichaValoracionPruebaColor'
import { FichaOzonoterapiaCapilar } from './fichas/FichaOzonoterapiaCapilar'
import { API_BASE_URL } from '../../../types/config'
// import { getFichaAuthToken } from './fichas/fichaHelpers'
// Añadir al inicio del archivo, junto con los otros imports
import { Ban } from "lucide-react";  // <-- AÑADIR ESTE
import BloqueosModal from "../../../components/Quotes/Bloqueos";  // <-- AÑADIR ESTE (ajusta la ruta)
import { ProductManagementPanel } from "./ProductManagementPanel"
import { ZoomIn, X, ExternalLink } from "lucide-react";
import { ShoppingCart } from "lucide-react";
import { formatSedeNombre } from "../../../lib/sede";
import { formatDateDMY } from "../../../lib/dateFormat";

interface AttentionProtocolProps {
  citaSeleccionada?: any;
  onFechaSeleccionada?: (fecha: string) => void;
  onFinalizarServicio?: (citaId: string) => void;
  onVolver?: () => void;
  usuarioRol?: string; // <-- AÑADIR ESTA LÍNEA
  onCitaActualizada?: (citaActualizada: any) => void;
}

type TipoFicha =
  | "DIAGNOSTICO_RIZOTIPO"
  | "COLOR"
  | "ASESORIA_CORTE"
  | "CUIDADO_POST_COLOR"
  | "VALORACION_PRUEBA_COLOR"
  | "OZONOTERAPIA_CAPILAR";

type VistaPrincipal = "fichas" | "productos" | "calendario" | "menu-principal" | "ver-fichas";
// Código de calificación del cliente desactivado temporalmente.

// Interfaz para datos de fichas guardadas
interface FichaGuardada {
  tipo: TipoFicha;
  datos: any;
  fechaGuardado: string;
  citaId: string;
}

// Interfaz para fichas obtenidas del servidor
interface FichaServidor {
  id: string;
  cliente_id: string;
  nombre: string;
  apellido: string | null;
  telefono: string;
  cedula: string;
  servicio_id: string;
  profesional_id: string;
  sede_id: string;
  fecha_ficha: string;
  fecha_reserva: string;
  tipo_ficha: TipoFicha;
  cita_id?: string;
  precio: number;
  estado: string;
  estado_pago: string;
  contenido: any;
  servicio_nombre: string;
  profesional_nombre: string;
  sede_nombre: string;
}

export function AttentionProtocol({
  citaSeleccionada,
  onFechaSeleccionada,
  onFinalizarServicio,
  onVolver,
  usuarioRol = "estilista",
}: AttentionProtocolProps) {
  const primaryActionButtonClass = "bg-black text-white hover:bg-gray-800 disabled:bg-gray-400 disabled:text-white"
  const [tipoFichaSeleccionada, setTipoFichaSeleccionada] = useState<TipoFicha | null>(null)
  const [vistaActual, setVistaActual] = useState<VistaPrincipal>("calendario")
  const [mesActual, setMesActual] = useState<Date>(new Date())
  const [fichasGuardadas, setFichasGuardadas] = useState<FichaGuardada[]>([])
  const [fichasCliente, setFichasCliente] = useState<FichaServidor[]>([])
  const [mostrarConfirmacionFinalizar, setMostrarConfirmacionFinalizar] = useState(false)
  const [loadingFichas, setLoadingFichas] = useState(false)
  const [loadingFinalizar, setLoadingFinalizar] = useState(false)
  const [detalleFicha, setDetalleFicha] = useState<FichaServidor | null>(null)
  const [mostrarModalBloqueos, setMostrarModalBloqueos] = useState(false);
  const [fichaEnEdicion, setFichaEnEdicion] = useState<FichaServidor | null>(null);
  // Edición de fichas deshabilitada temporalmente
  // const [loadingFichaEdicionId, setLoadingFichaEdicionId] = useState<string | null>(null);
  const [fechaSeleccionadaParaBloqueo, setFechaSeleccionadaParaBloqueo] = useState<string>("");
  const [totalProductos, setTotalProductos] = useState(0);
  const [, setCitaConProductos] = useState<any>(citaSeleccionada);
  const [, setProductosCita] = useState<any[]>([]);
  // const [calificacionCliente, setCalificacionCliente] = useState<CalificacionCliente | "">("");
  const [imagenAmpliada, setImagenAmpliada] = useState<{
    url: string;
    alt: string;
    tipo: 'antes' | 'despues';
    index: number;
    total: number;
  } | null>(null);

  // Cargar fichas guardadas del localStorage al inicializar  
  useEffect(() => {
    const fichasGuardadasStorage = localStorage.getItem('fichasPendientes')
    if (fichasGuardadasStorage) {
      setFichasGuardadas(JSON.parse(fichasGuardadasStorage))
    }
  }, [])

  // Cargar fichas del cliente cuando hay cita seleccionada
  useEffect(() => {
    if (citaSeleccionada) {
      setCitaConProductos(citaSeleccionada);

      // Extraer productos de la cita si existen
      const productosExistentes = citaSeleccionada.productos || [];
      setProductosCita(productosExistentes);

      // Calcular total de productos existentes
      const totalProductosExistentes = productosExistentes.reduce((sum: number, p: any) =>
        sum + (p.subtotal || (p.precio_unitario || 0) * (p.cantidad || 1)), 0
      );
      setTotalProductos(totalProductosExistentes);

      if (citaSeleccionada?.cliente?.cliente_id) {
        fetchFichasCliente(citaSeleccionada.cliente.cliente_id);
      }
    }
  }, [citaSeleccionada]);

  // Guardar fichas en localStorage cuando cambien
  useEffect(() => {
    localStorage.setItem('fichasPendientes', JSON.stringify(fichasGuardadas))
  }, [fichasGuardadas])



  // Función para obtener fichas del cliente - COMPLETA
  const fetchFichasCliente = async (clienteId: string) => {
    setLoadingFichas(true);
    try {
      const token = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');

      if (!token) {
        console.error('No hay token de autenticación');
        return;
      }

      console.log('🔍 Buscando fichas para cliente:', clienteId);
      console.log('🔗 Endpoint:', `${API_BASE_URL}clientes/fichas/${clienteId}`);

      const response = await fetch(`${API_BASE_URL}clientes/fichas/${clienteId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      console.log('📊 Response status:', response.status);

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`ℹ️ No se encontraron fichas para el cliente ${clienteId}`);
          setFichasCliente([]);
          return;
        }
        const errorText = await response.text();
        console.error('❌ Error response:', errorText);
        throw new Error(`Error ${response.status}: ${errorText || response.statusText}`);
      }

      const fichas = await response.json();
      console.log(`✅ Fichas recibidas: ${fichas.length}`);

      // 🔥 Mapear las fichas al formato esperado por el componente
      const fichasMapeadas: FichaServidor[] = fichas.map((ficha: any) => {
        console.log('📊 Estructura de ficha recibida:', {
          id: ficha._id,
          servicio: ficha.servicio_nombre,
          tiene_fotos: !!ficha.fotos,
          fotos_antes: ficha.fotos?.antes?.length || 0,
          fotos_despues: ficha.fotos?.despues?.length || 0,
          contenido_keys: Object.keys(ficha).filter(key => key !== 'fotos')
        });

        // 🔥 FUNCIÓN PARA ARREGLAR URLs HTTPS A HTTP
        const fixS3Url = (url: string): string => {
          if (!url) return '';
          // Si es una URL de S3 de AWS, cambiar https por http para evitar problemas de certificado
          if (url.includes('s3.amazonaws.com') || url.includes('.s3.')) {
            return url.replace('https://', 'http://');
          }
          return url;
        };

        const normalizePhotos = (value: any): string[] => {
          if (!value) return [];
          const rawValues = Array.isArray(value) ? value : [value];

          return rawValues
            .map((item) => {
              if (typeof item === "string") return item;
              if (item && typeof item === "object") {
                return item.url || item.src || item.location || item.path || "";
              }
              return "";
            })
            .filter((url: string) => Boolean(url))
            .map(fixS3Url);
        };

        const rawFotos =
          ficha.fotos ||
          ficha.contenido?.fotos ||
          ficha.datos_especificos?.fotos ||
          ficha.contenido?.datos_especificos?.fotos ||
          {};

        const fotosAntes = Array.from(
          new Set([
            ...normalizePhotos(rawFotos.antes),
            ...normalizePhotos(rawFotos.antes_urls),
            ...normalizePhotos(rawFotos.antes_url),
            ...normalizePhotos(rawFotos.fotos_antes),
            ...normalizePhotos(rawFotos.fotos_actual),
            ...normalizePhotos(rawFotos.fotos_estado_actual),
            ...normalizePhotos(rawFotos.actual),
            ...normalizePhotos(rawFotos.estado_actual),
            ...normalizePhotos(ficha.antes_url),
          ])
        );

        const fotosDespues = Array.from(
          new Set([
            ...normalizePhotos(rawFotos.despues),
            ...normalizePhotos(rawFotos.despues_urls),
            ...normalizePhotos(rawFotos.despues_url),
            ...normalizePhotos(rawFotos.fotos_despues),
            ...normalizePhotos(rawFotos.fotos_expectativa),
            ...normalizePhotos(rawFotos.expectativa),
            ...normalizePhotos(rawFotos.resultado),
            ...normalizePhotos(rawFotos.resultado_final),
            ...normalizePhotos(ficha.despues_url),
          ])
        );

        const fotosArregladas = fotosAntes.length > 0 || fotosDespues.length > 0
          ? {
            antes: fotosAntes,
            despues: fotosDespues,
            antes_urls: fotosAntes,
            despues_urls: fotosDespues,
          }
          : undefined;

        return {
          id: ficha._id,
          cliente_id: ficha.cliente_id,
          nombre: ficha.nombre,
          apellido: ficha.apellido,
          telefono: ficha.telefono,
          cedula: ficha.cedula,
          servicio_id: ficha.servicio_id,
          profesional_id: ficha.profesional_id,
          sede_id: ficha.sede_id,
          fecha_ficha: ficha.fecha_ficha,
          fecha_reserva: ficha.fecha_reserva,
          tipo_ficha: ficha.tipo_ficha as TipoFicha,
          cita_id:
            ficha.cita_id ||
            ficha.datos_especificos?.cita_id ||
            ficha.contenido?.cita_id ||
            ficha.contenido?.datos_especificos?.cita_id,
          precio: ficha.precio || 0,
          estado: ficha.estado || 'completado',
          estado_pago: ficha.estado_pago || 'pagado',
          contenido: {
            cita_id:
              ficha.cita_id ||
              ficha.datos_especificos?.cita_id ||
              ficha.contenido?.cita_id ||
              ficha.contenido?.datos_especificos?.cita_id,
            datos_especificos: {
              ...ficha.datos_especificos,
              fotos: fotosArregladas,
              autorizacion_publicacion: ficha.autorizacion_publicacion,
              comentario_interno: ficha.comentario_interno || ficha.descripcion_servicio || ''
            },
            respuestas: ficha.respuestas || [],
            fotos: fotosArregladas, // 🔥 Asegurar que las fotos estén en el nivel superior también
            autorizacion_publicacion: ficha.autorizacion_publicacion,
            comentario_interno: ficha.comentario_interno || ficha.descripcion_servicio || ''
          },
          servicio_nombre: ficha.servicio_nombre || ficha.servicio || 'Servicio sin nombre',
          profesional_nombre: ficha.profesional_nombre || ficha.estilista || 'Estilista no asignado',
          sede_nombre: formatSedeNombre(ficha.sede_nombre || ficha.sede || ficha.local, 'Sede no especificada')
        };
      });

      console.log('📋 Fichas mapeadas:', fichasMapeadas.length);
      setFichasCliente(fichasMapeadas);

    } catch (error) {
      console.error('❌ Error fetching fichas:', error);
      toast.error(`Error al cargar fichas: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      setFichasCliente([]);
    } finally {
      setLoadingFichas(false);
    }
  };
  // Función para formatear la fecha
  const formatFecha = (fechaString: string) => formatDateDMY(fechaString, fechaString)

  // Función para obtener el nombre del tipo de ficha
  const getNombreTipoFicha = (tipo: TipoFicha) => {
    switch (tipo) {
      case "DIAGNOSTICO_RIZOTIPO": return "Diagnóstico Rizotipo"
      case "COLOR": return "Diagnóstico Cromático"
      case "ASESORIA_CORTE": return "Asesoría de Corte"
      case "CUIDADO_POST_COLOR": return "Cuidado Post Color"
      case "VALORACION_PRUEBA_COLOR": return "Valoración Prueba Color"
      case "OZONOTERAPIA_CAPILAR": return "Ozonoterapia Capilar RF®"
      default: return (tipo as string).replace(/_/g, ' ')
    }
  }

  const getCitaId = (cita?: any): string => {
    const rawId = cita?.cita_id || cita?._id || "";
    return typeof rawId === "string" ? rawId : String(rawId || "");
  };

  // const getFichaCitaId = (ficha?: Partial<FichaServidor>): string => {
  //   const candidates = [
  //     ficha?.cita_id,
  //     (ficha as any)?.contenido?.cita_id,
  //     (ficha as any)?.contenido?.datos_especificos?.cita_id,
  //   ];
  //   for (const candidate of candidates) {
  //     if (typeof candidate === "string" && candidate.trim()) {
  //       return candidate.trim();
  //     }
  //   }
  //   return "";
  // };

  // const existeFichaAsociada = (citaId: string): boolean => {
  //   const normalizado = (citaId || "").trim();
  //   if (!normalizado) return false;
  //   return fichasCliente.some((ficha) => getFichaCitaId(ficha) === normalizado);
  // };
  // Código de funciones de calificación del cliente desactivado temporalmente.

  const scrollBottomSheetToTop = () => {
    const scrollContainer = document.querySelector("[data-bottom-sheet-scroll]");
    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTo({ top: 0, behavior: "auto" });
    }
  };

  const extractBackendErrorMessage = async (response: Response): Promise<string> => {
    const contentType = response.headers.get("content-type") || "";

    try {
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        if (typeof payload?.detail === "string") return payload.detail;
        if (typeof payload?.message === "string") return payload.message;
      } else {
        const text = (await response.text()).trim();
        if (text) {
          try {
            const parsed = JSON.parse(text);
            if (typeof parsed?.detail === "string") return parsed.detail;
            if (typeof parsed?.message === "string") return parsed.message;
          } catch {
            return text;
          }
          return text;
        }
      }
    } catch (error) {
      console.warn("No se pudo parsear el error del backend:", error);
    }

    return response.statusText || "Error desconocido";
  };
  // Referencia explícita para evitar que TypeScript marque la helper como no usada
  void extractBackendErrorMessage;

  /* const toIdString = (value: unknown): string => {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.$oid === "string") return record.$oid.trim();
      if (typeof record._id === "string") return record._id.trim();
      if (typeof record.id === "string") return record.id.trim();
    }

    return "";
  };

  const toPhotoArray = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.flatMap((item) => toPhotoArray(item)).filter(Boolean);
    }

    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const candidates = [record.url, record.src, record.location, record.path, record.key, record.href];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
          return [candidate.trim()];
        }
      }
    }

    return [];
  };

  const getFichaCitaId = (ficha: any): string => {
    const candidates = [
      ficha?.cita_id,
      ficha?.quote_id,
      ficha?.contenido?.cita_id,
      ficha?.contenido?.quote_id,
      ficha?.datos_especificos?.cita_id,
      ficha?.datos_especificos?.quote_id,
      ficha?.contenido?.datos_especificos?.cita_id,
      ficha?.contenido?.datos_especificos?.quote_id,
    ];

    for (const candidate of candidates) {
      const parsedId = toIdString(candidate);
      if (parsedId) return parsedId;
    }

    return "";
  };

  const extractFichaPhotos = (ficha: any): { antes: string[]; despues: string[] } => {
    const beforeKeys = [
      "antes",
      "antes_urls",
      "antes_url",
      "fotos_antes",
      "foto_antes",
      "foto_antes_url",
      "fotos_actual",
      "fotos_estado_actual",
      "actual",
      "estado_actual",
    ];
    const afterKeys = [
      "despues",
      "despues_urls",
      "despues_url",
      "fotos_despues",
      "foto_despues",
      "foto_despues_url",
      "fotos_expectativa",
      "expectativa",
      "resultado",
      "resultado_final",
    ];
    const beforeSet = new Set<string>();
    const afterSet = new Set<string>();

    const addPhotosByKeys = (keys: string[], collector: Set<string>, source: any) => {
      if (!source) return;

      keys.forEach((key) => {
        toPhotoArray(source?.[key]).forEach((url) => collector.add(url));
      });
    };

    const photoSources = [
      ficha,
      ficha?.fotos,
      ficha?.contenido,
      ficha?.contenido?.fotos,
      ficha?.contenido?.datos_especificos,
      ficha?.contenido?.datos_especificos?.fotos,
      ficha?.datos_especificos,
      ficha?.datos_especificos?.fotos,
    ].filter(Boolean);

    photoSources.forEach((source) => {
      addPhotosByKeys(beforeKeys, beforeSet, source);
      addPhotosByKeys(afterKeys, afterSet, source);
    });

    return {
      antes: Array.from(beforeSet),
      despues: Array.from(afterSet),
    };
  };

  const fetchFichasPorCita = async (clienteId: string, citaId: string, token: string): Promise<any[]> => {
    const params = new URLSearchParams({
      cliente_id: clienteId,
      cita_id: citaId,
    });

    const response = await fetch(`${API_BASE_URL}scheduling/quotes/fichas?${params.toString()}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${await extractBackendErrorMessage(response)}`);
    }

    const payload = await response.json().catch(() => null);
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.fichas)) return payload.fichas;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };

  const fetchFichasClienteRaw = async (clienteId: string, token: string): Promise<any[]> => {
    const response = await fetch(`${API_BASE_URL}clientes/fichas/${clienteId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${await extractBackendErrorMessage(response)}`);
    }

    const payload = await response.json().catch(() => null);
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.fichas)) return payload.fichas;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };

  const validarFotosRequeridasParaFinalizar = async (
    citaId: string,
    token: string
  ): Promise<{ esValido: boolean; mensaje: string }> => {
    const clienteId = citaSeleccionada?.cliente?.cliente_id || citaSeleccionada?.cliente_id || "";
    const fichasDeCita: any[] = [];

    if (clienteId) {
      let fichasPorCita: any[] = [];
      let fichasRawCliente: any[] = [];

      try {
        fichasPorCita = await fetchFichasPorCita(clienteId, citaId, token);
      } catch (error) {
        console.warn("No se pudo consultar fichas por cita en scheduling/quotes/fichas:", error);
      }

      try {
        fichasRawCliente = await fetchFichasClienteRaw(clienteId, token);
      } catch (error) {
        console.warn("No se pudo consultar fichas por cliente en clientes/fichas:", error);
      }

      fichasDeCita.push(...fichasPorCita);
      fichasDeCita.push(...fichasRawCliente.filter((ficha) => getFichaCitaId(ficha) === citaId));
    }

    fichasDeCita.push(...fichasCliente.filter((ficha) => getFichaCitaId(ficha) === citaId));

    if (fichasDeCita.length === 0) {
      return {
        esValido: false,
        mensaje: "Debes registrar una ficha de esta cita con fotos de antes y después para poder finalizar.",
      };
    }

    const fotosAntes = new Set<string>();
    const fotosDespues = new Set<string>();

    fichasDeCita.forEach((ficha) => {
      const fotos = extractFichaPhotos(ficha);
      fotos.antes.forEach((url) => fotosAntes.add(url));
      fotos.despues.forEach((url) => fotosDespues.add(url));
    });

    console.log("📸 Resultado validación de fotos para finalizar:", {
      citaId,
      fichasEvaluadas: fichasDeCita.length,
      fotosAntes: fotosAntes.size,
      fotosDespues: fotosDespues.size,
    });

    if (fotosAntes.size > 0 && fotosDespues.size > 0) {
      return { esValido: true, mensaje: "" };
    }

    if (fotosAntes.size === 0 && fotosDespues.size === 0) {
      return {
        esValido: false,
        mensaje: "Debes cargar fotos de ANTES y DESPUÉS antes de finalizar la cita.",
      };
    }

    if (fotosAntes.size === 0) {
      return {
        esValido: false,
        mensaje: "Faltan fotos de ANTES. Debes cargarlas para finalizar la cita.",
      };
    }

    return {
      esValido: false,
      mensaje: "Faltan fotos de DESPUÉS. Debes cargarlas para finalizar la cita.",
    };
  }; */

  // useEffect(() => {
  //   setCalificacionCliente(cargarCalificacionClienteGuardada(citaSeleccionada));
  // }, [citaSeleccionada]);

  useEffect(() => {
    scrollBottomSheetToTop();
  }, [vistaActual, tipoFichaSeleccionada, mostrarConfirmacionFinalizar, detalleFicha]);

  // FUNCIÓN SIMPLIFICADA: SIEMPRE puede finalizar si está pendiente/confirmada
  const puedeMostrarFinalizar = (cita: any): boolean => {
    const citaId = getCitaId(cita);
    console.log('🔍 Verificando si puede mostrar botón finalizar para cita:', citaId);

    // Verificar si la cita existe
    if (!cita || !citaId) {
      console.log('❌ No hay cita válida');
      return false;
    }

    // Obtener información del estado
    const estadoInfo = getEstadoCita(cita);
    const estadoNormalizado = estadoInfo.estado.toLowerCase();

    console.log(`📊 Estado de la cita: "${estadoInfo.estado}" (normalizado: "${estadoNormalizado}")`);

    // Estados que PERMITEN finalizar (pendiente o confirmada)
    const estadosPermitidos = [
      "pendiente",
      "confirmada",
      "confirmado",
      "reservada",
      "reservado",
      "en proceso",       // Agregado por si acaso
      "en_proceso",
      "en curso"
    ];

    // Verificar si el estado está permitido
    const puedeFinalizar = estadosPermitidos.some(estado =>
      estadoNormalizado.includes(estado.toLowerCase())
    );

    console.log(`✅ ¿Puede finalizar? ${puedeFinalizar} - Estado: ${estadoNormalizado}`);
    return puedeFinalizar;
  };

  // Función para obtener el color según el tipo de ficha
  const getColorPorTipoFicha = (tipo: TipoFicha) => {
    switch (tipo) {
      case "DIAGNOSTICO_RIZOTIPO": return "bg-gray-100 text-gray-800 border-gray-200";
      case "COLOR": return "bg-gray-100 text-gray-800 border-gray-200";
      case "ASESORIA_CORTE": return "bg-gray-100 text-gray-800 border-gray-200";
      case "CUIDADO_POST_COLOR": return "bg-gray-100 text-gray-800 border-gray-200";
      case "VALORACION_PRUEBA_COLOR": return "bg-gray-100 text-gray-800 border-gray-200";
      case "OZONOTERAPIA_CAPILAR": return "bg-gray-100 text-gray-800 border-gray-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  }

  // FUNCIÓN MEJORADA PARA FINALIZAR SERVICIO (ENDPOINT PUT)
  const finalizarServicioAPI = async (rawCitaId?: string) => {
    const citaId = (rawCitaId || getCitaId(citaSeleccionada)).trim();
    if (!citaId) {
      toast.error("No se pudo identificar la cita a finalizar");
      return;
    }

    // TODO: [TEMPORAL] Restricción de ficha desactivada
    // Reactivar cuando se resuelva el flujo de fichas
    // Fecha: 2026-05-17
    // Para perfil de estilista: exigir ficha técnica antes de finalizar
    // if (
    //   usuarioRol === "estilista" &&
    //   !loadingFichas &&
    //   fichasCliente.length > 0 &&
    //   !existeFichaAsociada(citaId)
    // ) {
    //   alert("Debes crear y guardar la ficha técnica de esta cita antes de finalizar el servicio.");
    //   return;
    // }

    setLoadingFinalizar(true);
    try {
      const token = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');

      if (!token) {
        throw new Error('No hay token de autenticación');
      }

      // if (!calificacionCliente) {
      //   throw new Error("Debes asignar una puntuación al cliente antes de finalizar el servicio.");
      // }

      // const validacionFotos = await validarFotosRequeridasParaFinalizar(citaId, token);
      // if (!validacionFotos.esValido) {
      //   throw new Error(validacionFotos.mensaje);
      // }

      console.log(`👤 Rol del usuario: ${usuarioRol}`);

      // Usar el endpoint PUT /scheduling/quotes/citas/{cita_id}/finalizar
      const response = await fetch(`${API_BASE_URL}scheduling/quotes/citas/${citaId}/finalizar`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      console.log('Response status:', response.status);

      const rawBody = await response.text();
      let data: any = {};
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        const errorMessage =
          (typeof data?.detail === "string" && data.detail) ||
          (typeof data?.message === "string" && data.message) ||
          rawBody ||
          response.statusText;

        // const faltaFicha =
        //   response.status === 404 &&
        //   typeof errorMessage === "string" &&
        //   errorMessage.toLowerCase().includes("ficha");

        // const mensajeError = faltaFicha
        //   ? "Debes crear y guardar la ficha técnica de esta cita antes de finalizar el servicio."
        //   : `Error ${response.status}: ${errorMessage}`;

        throw new Error(`Error ${response.status}: ${errorMessage}`);
      }

      const seGeneroPdf = data?.pdf_generado !== false;
      console.log('✅ Servicio finalizado:', data);

      // Actualizar estado local de la cita
      if (citaSeleccionada) {
        citaSeleccionada.estado = "finalizado";
      }

      // Limpiar fichas guardadas de esta cita
      const fichasActualizadas = fichasGuardadas.filter(
        ficha => ficha.citaId !== citaId
      );
      setFichasGuardadas(fichasActualizadas);

      // Notificar al componente padre si existe
      if (onFinalizarServicio) {
        onFinalizarServicio(citaId);
      }

      // Resetear vista
      setMostrarConfirmacionFinalizar(false);
      setVistaActual("calendario");
      setTipoFichaSeleccionada(null);

      // Mostrar mensaje según rol
      let mensaje = usuarioRol === "estilista"
        ? "✅ Servicio finalizado como estilista. El admin puede proceder con la facturación."
        : "✅ Servicio finalizado por administración.";

      if (!seGeneroPdf) {
        mensaje += " No se pudo generar o enviar el PDF de la ficha; por favor revisa en administración.";
      }

      toast.success(mensaje.replace(/^✅\s*/, ''));

      if (!onFinalizarServicio) {
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      }

    } catch (error) {
      console.error('❌ Error al finalizar servicio:', error);
      toast.error(error instanceof Error ? error.message : 'Error al finalizar el servicio');
    } finally {
      setLoadingFinalizar(false);
    }
  };

  const getEstadoCita = (cita: any) => {
    console.log(`🔄 Calculando estado para cita ${getCitaId(cita)}:`, {
      estado: cita.estado,
      estado_pago: cita.estado_pago,
      fecha: cita.fecha,
      hora_inicio: cita.hora_inicio
    });

    // PRIMERO: Verificar estado de pago si existe
    if (cita.estado_pago) {
      const estadoPagoNormalizado = cita.estado_pago.toLowerCase().trim();
      console.log(`- Estado de pago: "${estadoPagoNormalizado}"`);

      if (estadoPagoNormalizado === "pagado" || estadoPagoNormalizado === "pagada") {
        return {
          estado: "Pagada",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <CheckCircle className="w-4 h-4" />
        };
      }
    }

    // SEGUNDO: Verificar el estado principal
    if (cita.estado) {
      const estadoNormalizado = cita.estado.toLowerCase().trim();
      console.log(`- Estado principal normalizado: "${estadoNormalizado}"`);

      const estadosMap: Record<string, any> = {
        "pendiente": {
          estado: "Pendiente",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <Clock className="w-4 h-4" />
        },
        "reservada": {
          estado: "Pendiente",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <Clock className="w-4 h-4" />
        },
        "confirmada": {
          estado: "Pendiente",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <Clock className="w-4 h-4" />
        },
        "reservada/pendiente": {
          estado: "Pendiente",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <Clock className="w-4 h-4" />
        },
        "en proceso": {
          estado: "En Proceso",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <Clock className="w-4 h-4 animate-pulse" />
        },
        "en_proceso": {
          estado: "En Proceso",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <Clock className="w-4 h-4 animate-pulse" />
        },
        "en curso": {
          estado: "En Proceso",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <Clock className="w-4 h-4 animate-pulse" />
        },
        "cancelada": {
          estado: "Cancelada",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <AlertCircle className="w-4 h-4" />
        },
        "cancelado": {
          estado: "Cancelada",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <AlertCircle className="w-4 h-4" />
        },
        "no asistio": {
          estado: "No Asistió",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <AlertCircle className="w-4 h-4" />
        },
        "no asistió": {
          estado: "No Asistió",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <AlertCircle className="w-4 h-4" />
        },
        "finalizada": {
          estado: "Finalizada",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <CheckCircle className="w-4 h-4" />
        },
        "finalizado": {
          estado: "Finalizada",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <CheckCircle className="w-4 h-4" />
        },
        "completada": {
          estado: "Finalizada",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <CheckCircle className="w-4 h-4" />
        },
        "completado": {
          estado: "Finalizada",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <CheckCircle className="w-4 h-4" />
        },
        "pagada": {
          estado: "Pagada",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <CheckCircle className="w-4 h-4" />
        },
        "pagado": {
          estado: "Pagada",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <CheckCircle className="w-4 h-4" />
        }
      };

      // Buscar coincidencia exacta o parcial
      for (const [key, value] of Object.entries(estadosMap)) {
        if (estadoNormalizado.includes(key.toLowerCase())) {
          console.log(`✓ Estado reconocido: "${key}" -> "${value.estado}"`);
          return value;
        }
      }

      console.log(`⚠️ Estado no reconocido en el mapa: "${estadoNormalizado}"`);
    }

    // TERCERO: Calcular por horario si no hay estado definido
    console.log(`- Calculando estado por horario...`);
    try {
      const ahora = new Date();
      const fechaCita = new Date(cita.fecha);
      const [horaInicio, minutoInicio] = cita.hora_inicio.split(':').map(Number);
      const [horaFin, minutoFin] = cita.hora_fin.split(':').map(Number);

      const inicioCita = new Date(fechaCita);
      inicioCita.setHours(horaInicio, minutoInicio, 0, 0);

      const finCita = new Date(fechaCita);
      finCita.setHours(horaFin, minutoFin, 0, 0);

      if (ahora < inicioCita) {
        console.log(`✓ Cita futura -> Pendiente`);
        return {
          estado: "Pendiente",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <Clock className="w-4 h-4" />
        };
      } else if (ahora >= inicioCita && ahora <= finCita) {
        console.log(`✓ Cita en horario -> En Proceso`);
        return {
          estado: "En Proceso",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <Clock className="w-4 h-4 animate-pulse" />
        };
      } else {
        console.log(`✓ Cita pasada -> Finalizada (por horario)`);
        return {
          estado: "Finalizada (por horario)",
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: <Clock className="w-4 h-4" />
        };
      }
    } catch (error) {
      console.error(`❌ Error calculando horario:`, error);
      return {
        estado: "Pendiente",
        color: "bg-gray-100 text-gray-800 border-gray-200",
        icon: <Clock className="w-4 h-4" />
      };
    }
  };


  // Función para obtener información de cualquier mes
  const getMonthInfo = (fecha: Date) => {
    const year = fecha.getFullYear();
    const month = fecha.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstDayOfWeek = firstDay.getDay();
    const adjustedFirstDay = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    const now = new Date();
    const today = now.getDate();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    return {
      year,
      monthName: monthNames[month],
      monthNumber: month,
      today,
      currentMonth,
      currentYear,
      totalDays: lastDay.getDate(),
      firstDayOffset: adjustedFirstDay
    };
  };

  // Navegar al mes anterior
  const mesAnterior = () => {
    setMesActual(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() - 1);
      return newDate;
    });
  };

  // Navegar al mes siguiente
  const mesSiguiente = () => {
    setMesActual(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + 1);
      return newDate;
    });
  };

  // Manejar clic en un día del calendario
  const handleDiaClick = (dia: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const { year, monthNumber } = getMonthInfo(mesActual);
    const mesFormateado = (monthNumber + 1).toString().padStart(2, '0');
    const diaFormateado = dia.toString().padStart(2, '0');
    const fechaFormateada = `${year}-${mesFormateado}-${diaFormateado}`;

    // Verificar si el clic fue con la tecla Ctrl (o Cmd en Mac) para abrir bloqueos
    const isCtrlClick = event.ctrlKey || event.metaKey;

    if (isCtrlClick) {
      // Abrir modal de bloqueos para esta fecha
      setFechaSeleccionadaParaBloqueo(fechaFormateada);
      setMostrarModalBloqueos(true);
    } else {
      // Comportamiento normal: seleccionar fecha para ver citas
      if (onFechaSeleccionada) {
        onFechaSeleccionada(fechaFormateada);
      }
    }
  };
  // 🆕 AÑADIR ESTAS DOS FUNCIONES NUEVAS (después de handleDiaClick):

  // Función para abrir modal de bloqueos con opciones
  const abrirModalBloqueos = (fecha?: string) => {
    if (fecha) {
      setFechaSeleccionadaParaBloqueo(fecha);
    } else {
      // Usar la fecha actual si no se especifica
      const hoy = new Date();
      const fechaHoy = `${hoy.getFullYear()}-${(hoy.getMonth() + 1).toString().padStart(2, '0')}-${hoy.getDate().toString().padStart(2, '0')}`;
      setFechaSeleccionadaParaBloqueo(fechaHoy);
    }

    setMostrarModalBloqueos(true);
  };

  // Cerrar modal de bloqueos
  const cerrarModalBloqueos = () => {
    setMostrarModalBloqueos(false);
    setFechaSeleccionadaParaBloqueo("");
  };

  const extraerDatosInicialesFicha = (ficha: FichaServidor | null, tipo: TipoFicha | null) => {
    if (!ficha || !tipo) return null;
    const base = ficha.contenido?.datos_especificos || ficha.contenido || {};

    if (tipo === "VALORACION_PRUEBA_COLOR") {
      return {
        autorizacion_publicacion: base.autorizacion_publicacion ?? false,
        firma_profesional: base.firma_profesional ?? false,
        servicio_valorado: base.servicio_valorado || "",
        acuerdos: base.acuerdos || "",
        recomendaciones: base.recomendaciones || "",
        observaciones_adicionales: base.observaciones_adicionales || "",
        foto_estado_actual: [],
        foto_expectativa: [],
      };
    }

    if (tipo === "DIAGNOSTICO_RIZOTIPO") {
      return {
        ...base,
        foto_antes: [],
        foto_despues: [],
      };
    }

    if (tipo === "COLOR") {
      const respuestas = ficha.contenido?.respuestas || base.respuestas;
      return {
        ...base,
        descripcion: base.descripcion || base.descripcion_servicio || "",
        observaciones: base.observaciones || base.observaciones_generales || "",
        respuestas: respuestas || base.respuestas || [],
        foto_antes: [],
        foto_despues: [],
      };
    }

    if (tipo === "ASESORIA_CORTE") {
      return {
        ...base,
        foto_antes: [],
        foto_despues: [],
      };
    }

    if (tipo === "CUIDADO_POST_COLOR") {
      return {
        ...base,
        foto_antes: [],
        foto_despues: [],
      };
    }

    return base;
  };

  // Edición/carga remota de fichas deshabilitada en esta vista
  // Guardar ficha automáticamente
  const guardarFicha = (tipo: TipoFicha, datos: any) => {
    if (!citaSeleccionada) return;

    const nuevaFicha: FichaGuardada = {
      tipo,
      datos,
      fechaGuardado: new Date().toISOString(),
      citaId: citaSeleccionada.cita_id
    };

    const fichasActualizadas = fichasGuardadas.filter(
      ficha => !(ficha.citaId === citaSeleccionada.cita_id && ficha.tipo === tipo)
    );

    fichasActualizadas.push(nuevaFicha);
    setFichasGuardadas(fichasActualizadas);
  };

  // Cargar ficha guardada
  const cargarFichaGuardada = (tipo: TipoFicha) => {
    const fichaGuardada = fichasGuardadas.find(
      ficha => ficha.citaId === citaSeleccionada.cita_id && ficha.tipo === tipo
    );
    return fichaGuardada?.datos || null;
  };

  // Obtener fichas guardadas para la cita actual
  const getFichasGuardadasCitaActual = () => {
    if (!citaSeleccionada) return [];
    return fichasGuardadas.filter(ficha => ficha.citaId === citaSeleccionada.cita_id);
  };

  // Vista para ver fichas del cliente (detalle de una ficha) - COMPLETA CON IMÁGENES
  const renderDetalleFicha = () => {
    if (!detalleFicha) return null;

    console.log('🔍 DEBUG - Ficha seleccionada:', {
      id: detalleFicha.id,
      tiene_contenido: !!detalleFicha.contenido,
      tiene_datos_especificos: !!detalleFicha.contenido?.datos_especificos,
      tiene_fotos_contenido: !!detalleFicha.contenido?.fotos,
      tiene_fotos_datos: !!detalleFicha.contenido?.datos_especificos?.fotos
    });

    // 🔥 BUSCAR FOTOS EN LA ESTRUCTURA CORRECTA
    let fotos = null;
    let datosEspecificos = detalleFicha.contenido?.datos_especificos || detalleFicha.contenido;
    let autorizacionPublicacion = datosEspecificos?.autorizacion_publicacion;
    let comentarioInterno = datosEspecificos?.comentario_interno;

    // Buscar fotos en diferentes niveles
    fotos = detalleFicha.contenido?.fotos ||
      datosEspecificos?.fotos ||
      detalleFicha.contenido?.datos_especificos?.fotos;

    console.log('📸 Fotos encontradas:', fotos);

    // 🔥 FUNCIÓN PARA ARREGLAR URLs DE S3
    const fixS3Url = (url: string): string => {
      if (!url) return '';
      if (url.includes('s3.amazonaws.com') || url.includes('.s3.')) {
        return url.replace('https://', 'http://');
      }
      return url;
    };


    // 🔥 Obtener las URLs de las fotos
    let fotosAntes: string[] = [];
    let fotosDespues: string[] = [];

    if (fotos) {
      console.log('📸 Procesando estructura de fotos:', fotos);

      fotosAntes = fotos.antes || fotos.antes_urls || [];
      fotosDespues = fotos.despues || fotos.despues_urls || [];

      console.log('📸 Fotos Antes:', fotosAntes);
      console.log('📸 Fotos Después:', fotosDespues);
    }

    // Formatear el precio
    const precioFormateado = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP'
    }).format(detalleFicha.precio);

    return (
      <div className="rounded-lg border bg-white p-4"> {/* REDUCIDO de p-6 */}
        {/* Botón de Volver */}
        <div className="mb-3"> {/* REDUCIDO de mb-4 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDetalleFicha(null)}
            className="flex items-center gap-1 text-gray-600 hover:text-gray-900 text-xs"
          >
            <ArrowLeft className="w-3 h-3" /> {/* REDUCIDO de w-4 h-4 */}
            Volver a la lista
          </Button>
        </div>

        <div className="mb-4"> {/* REDUCIDO de mb-6 */}
          <div className="flex justify-between items-start mb-3"> {/* REDUCIDO de mb-4 */}
            <div>
              <h2 className="text-lg font-bold mb-1">{getNombreTipoFicha(detalleFicha.tipo_ficha)}</h2> {/* REDUCIDO de text-2xl */}
              <div className="flex items-center gap-2"> {/* REDUCIDO de gap-4 */}
                <p className="text-sm text-gray-600 font-medium"> {/* REDUCIDO texto */}
                  {detalleFicha.nombre} {detalleFicha.apellido || ''}
                </p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getColorPorTipoFicha(detalleFicha.tipo_ficha)}`}>
                  {detalleFicha.estado}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1"> {/* REDUCIDO de text-sm */}
                {detalleFicha.servicio_nombre} • {formatFecha(detalleFicha.fecha_ficha)}
              </p>
            </div>
            {/* Edición de fichas deshabilitada para auditoría */}
          </div>

          {/* Resumen destacado */}
          <div className="bg-gradient-to-r from-gray-50 to-gray-50 border border-gray-200 rounded p-3 mb-4"> {/* REDUCIDO de p-4 mb-6 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3"> {/* REDUCIDO de gap-4 */}
              <div className="text-center">
                <div className="text-xs text-gray-600 mb-1">Servicio</div> {/* REDUCIDO de text-sm */}
                <div className="font-semibold text-sm">{detalleFicha.servicio_nombre}</div> {/* REDUCIDO de text-lg */}
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-600 mb-1">Fecha</div> {/* REDUCIDO de text-sm */}
                <div className="font-semibold text-sm">{formatFecha(detalleFicha.fecha_ficha)}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-600 mb-1">Profesional</div> {/* REDUCIDO de text-sm */}
                <div className="font-semibold text-sm">{detalleFicha.profesional_nombre}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-600 mb-1">Precio</div> {/* REDUCIDO de text-sm */}
                <div className="font-semibold text-sm text-gray-600">{precioFormateado}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Información general */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"> {/* REDUCIDO de gap-6 mb-6 */}
          <div className="bg-gray-50 p-3 rounded"> {/* REDUCIDO de p-4 */}
            <h3 className="font-semibold mb-2 text-sm">Información del Cliente</h3> {/* REDUCIDO de text-lg */}
            <div className="space-y-1"> {/* REDUCIDO de space-y-2 */}
              <p className="text-xs"><strong>Nombre:</strong> {detalleFicha.nombre} {detalleFicha.apellido || ''}</p> {/* REDUCIDO texto */}
              <p className="text-xs"><strong>Cédula:</strong> {detalleFicha.cedula}</p>
              <p className="text-xs"><strong>Teléfono:</strong> {detalleFicha.telefono}</p>
              <p className="text-xs"><strong>Sede:</strong> {formatSedeNombre(detalleFicha.sede_nombre, 'Sede no especificada')}</p>
            </div>
          </div>

          <div className="bg-gray-50 p-3 rounded"> {/* REDUCIDO de p-4 */}
            <h3 className="font-semibold mb-2 text-sm">Detalles del Servicio</h3> {/* REDUCIDO de text-lg */}
            <div className="space-y-1"> {/* REDUCIDO de space-y-2 */}
              <p className="text-xs"><strong>Estado de pago:</strong> {detalleFicha.estado_pago}</p>
              <p className="text-xs"><strong>Fecha reserva:</strong> {formatFecha(detalleFicha.fecha_reserva)}</p>
              {autorizacionPublicacion !== undefined && (
                <p className="text-xs">
                  <strong>Autorización publicación:</strong>{' '}
                  {autorizacionPublicacion ? (
                    <span className="text-gray-600 font-medium">✅ Autorizado</span>
                  ) : (
                    <span className="text-gray-600 font-medium">❌ No autorizado</span>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* IMÁGENES ANTES Y DESPUÉS */}
        {(fotosAntes.length > 0 || fotosDespues.length > 0) && (
          <div className="mb-6">
            <h3 className="font-semibold text-base mb-4 border-b pb-1 flex items-center gap-2">
              <Camera className="w-4 h-4" /> {/* REDUCIDO de w-5 h-5 */}
              📸 Fotos del Servicio
            </h3>

            {/* Estado para el modal de imagen ampliada */}
            <div className="mb-4"> {/* REDUCIDO de mb-6 */}
              {/* Modal para imagen ampliada */}
              {imagenAmpliada && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-90">
                  <div className="relative w-full max-w-6xl bg-white rounded-2xl shadow-2xl overflow-hidden">
                    {/* Header del modal */}
                    <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-gray-50 to-white"> {/* REDUCIDO de p-6 */}
                      <div className="flex items-center gap-2">
                        <Camera className="h-5 w-5 text-gray-600" />
                        <div>
                          <h2 className="text-base font-bold text-gray-900">
                            {imagenAmpliada.tipo === 'antes' ? '📸 Imagen ANTES' : '✨ Imagen DESPUÉS'}
                          </h2>
                          <p className="text-xs text-gray-600">
                            {detalleFicha?.nombre} • {getNombreTipoFicha(detalleFicha?.tipo_ficha || 'COLOR')}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setImagenAmpliada(null)}
                        className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                      >
                        <X className="h-5 w-5 text-gray-500" />
                      </button>
                    </div>


                    <div className="relative">
                      <div className="flex items-center justify-center min-h-[400px] max-h-[60vh] bg-gray-900"> {/* REDUCIDO alturas */}
                        <img
                          src={fixS3Url(imagenAmpliada.url)}
                          alt={imagenAmpliada.alt}
                          className="max-w-full max-h-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = imagenAmpliada.tipo === 'antes'
                              ? 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgdmlld0JveD0iMCAwIDgwMCA2MDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjgwMCIgaGVpZ2h0PSI2MDAiIGZpbGw9IiMzQjgyRjYiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIzMiI+SU1BR0VOIEFOVEVTPC90ZXh0Pjwvc3ZnPg=='
                              : 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgdmlld0JveD0iMCAwIDgwMCA2MDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjgwMCIgaGVpZ2h0PSI2MDAiIGZpbGw9IiMxMEI5ODEiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIzMiI+SU1BR0VOIERFU1BVw4lTPC90ZXh0Pjwvc3ZnPg==';
                          }}
                        />
                      </div>

                      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2"> {/* REDUCIDO de bottom-6 gap-4 */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-white/90 backdrop-blur-sm text-xs"
                          onClick={() => window.open(fixS3Url(imagenAmpliada.url), '_blank')}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Abrir
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-white/90 backdrop-blur-sm text-xs"
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = fixS3Url(imagenAmpliada.url);
                            link.download = `ficha-${detalleFicha?.id}-${imagenAmpliada.tipo}.jpg`;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                        >
                          <Download className="h-3 w-3 mr-1" /> {/* REDUCIDO de h-4 w-4 mr-2 */}
                          Descargar
                        </Button>
                      </div>
                    </div>

                    {/* Footer del modal */}
                    <div className="p-3 bg-gray-50 border-t"> {/* REDUCIDO de p-4 */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1"> {/* REDUCIDO de gap-2 */}
                          <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${imagenAmpliada.tipo === 'antes' ? 'bg-gray-100 text-gray-800 border border-gray-200' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                            {imagenAmpliada.tipo === 'antes' ? 'ANTES' : 'DESPUÉS'}
                          </div>
                          <span className="text-xs text-gray-600">
                            Foto {imagenAmpliada.index + 1} de {imagenAmpliada.total}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500"> {/* REDUCIDO de text-sm */}
                          Haz clic fuera para cerrar
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Comparación si hay ambas - CON IMÁGENES MÁS GRANDES */}
              {fotosAntes.length > 0 && fotosDespues.length > 0 && (
                <div className="mb-6">
                  <h4 className="font-medium text-gray-700 mb-3 text-base flex items-center gap-1"> {/* REDUCIDO de mb-4 text-lg gap-2 */}
                  </h4>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"> {/* REDUCIDO de gap-8 */}
                    {/* Columna ANTES */}
                    <div className="space-y-3"> {/* REDUCIDO de space-y-4 */}
                      <div className="flex items-center justify-between">
                        <h5 className="font-medium text-gray-700 text-base flex items-center gap-1"> {/* REDUCIDO de text-lg gap-2 */}
                          Estado Inicial (Antes)
                        </h5>
                      </div>

                      {/* Contenedor principal de la imagen ANTES */}
                      <div className="relative group">
                        <div
                          className="border-2 border-gray-300 rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer bg-gradient-to-br from-gray-50 to-white"
                          onClick={() => setImagenAmpliada({
                            url: fotosAntes[0],
                            alt: 'Estado inicial - ANTES',
                            tipo: 'antes',
                            index: 0,
                            total: fotosAntes.length
                          })}
                        >
                          <div className="relative overflow-hidden">
                            <img
                              src={fixS3Url(fotosAntes[0])}
                              alt="Estado inicial - ANTES"
                              className="w-full h-56 object-cover transition-transform duration-700 group-hover:scale-110"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDYwMCA0MDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjYwMCIgaGVpZ2h0PSI0MDAiIGZpbGw9IiMzQjgyRjYiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCI+QU5URVM8L3RleHQ+PC9zdmc+';
                              }}
                            />

                            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                              <div className="bg-white/90 backdrop-blur-sm p-2 rounded-full shadow-lg transform -translate-y-2 group-hover:translate-y-0 transition-transform duration-300"> {/* REDUCIDO de p-4 -translate-y-4 */}
                                <ZoomIn className="h-6 w-6 text-gray-600" />
                              </div>
                            </div>

                            <div className="absolute top-2 left-2">
                              <span className="bg-gray-600 text-white px-2 py-1 rounded-full text-xs font-bold shadow">
                                ANTES
                              </span>
                            </div>

                            {/* Indicador si hay más fotos */}
                            {fotosAntes.length > 1 && (
                              <div className="absolute top-2 right-2"> {/* REDUCIDO de top-4 right-4 */}
                                <span className="bg-gray-800/90 text-white px-1.5 py-0.5 rounded-full text-xs font-semibold backdrop-blur-sm"> {/* REDUCIDO de px-3 py-1.5 */}
                                  +{fotosAntes.length - 1} más
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Información debajo de la imagen */}
                          <div className="p-3 bg-gradient-to-r from-gray-50 to-gray-100 border-t border-gray-200"> {/* REDUCIDO de p-5 */}
                            <p className="text-sm text-gray-800 font-medium text-center"> {/* REDUCIDO de text-base */}
                              Estado del cabello antes del servicio
                            </p>
                            <p className="text-xs text-gray-600 text-center mt-1 flex items-center justify-center gap-1"> {/* REDUCIDO de text-sm mt-2 gap-2 */}
                              <ZoomIn className="h-3 w-3" /> {/* REDUCIDO de h-4 w-4 */}
                              Haz clic para ver en tamaño completo
                            </p>
                          </div>
                        </div>

                        {/* Miniaturas si hay más fotos */}
                        {fotosAntes.length > 1 && (
                          <div className="flex gap-1 mt-2 overflow-x-auto pb-1"> {/* REDUCIDO de gap-2 mt-3 pb-2 */}
                            {fotosAntes.slice(1).map((url, idx) => (
                              <div
                                key={`antes-thumb-${idx}`}
                                className="flex-shrink-0 w-16 h-12 rounded overflow-hidden border border-gray-200 cursor-pointer hover:border-gray-400 transition-colors"
                                onClick={() => setImagenAmpliada({
                                  url,
                                  alt: `Antes ${idx + 2}`,
                                  tipo: 'antes',
                                  index: idx + 1,
                                  total: fotosAntes.length
                                })}
                              >
                                <img
                                  src={fixS3Url(url)}
                                  alt={`Antes ${idx + 2}`}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Columna DESPUÉS */}
                    <div className="space-y-3"> {/* REDUCIDO de space-y-4 */}
                      <div className="flex items-center justify-between">
                        <h5 className="font-medium text-gray-700 text-base flex items-center gap-1"> {/* REDUCIDO de text-lg gap-2 */}
                          Resultado Final (Después)
                        </h5>

                      </div>

                      <div className="relative group">
                        <div
                          className="border-2 border-gray-300 rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer bg-gradient-to-br from-gray-50 to-white"
                          onClick={() => setImagenAmpliada({
                            url: fotosDespues[0],
                            alt: 'Resultado final - DESPUÉS',
                            tipo: 'despues',
                            index: 0,
                            total: fotosDespues.length
                          })}
                        >
                          {/* Imagen principal */}
                          <div className="relative overflow-hidden">
                            <img
                              src={fixS3Url(fotosDespues[0])}
                              alt="Resultado final - DESPUÉS"
                              className="w-full h-56 object-cover transition-transform duration-700 group-hover:scale-110"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDYwMCA0MDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjYwMCIgaGVpZ2h0PSI0MDAiIGZpbGw9IiMxMEI5ODEiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCI+REVTUFXDqVM8L3RleHQ+PC9zdmc+';
                              }}
                            />

                            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                              <div className="bg-white/90 backdrop-blur-sm p-2 rounded-full shadow-lg transform -translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                                <ZoomIn className="h-6 w-6 text-gray-600" />
                              </div>
                            </div>

                            <div className="absolute top-2 left-2">
                              <span className="bg-gray-600 text-white px-2 py-1 rounded-full text-xs font-bold shadow">
                                DESPUES
                              </span>
                            </div>

                            {fotosDespues.length > 1 && (
                              <div className="absolute top-2 right-2">
                                <span className="bg-gray-800/90 text-white px-1.5 py-0.5 rounded-full text-xs font-semibold backdrop-blur-sm"> {/* REDUCIDO de px-3 py-1.5 */}
                                  +{fotosDespues.length - 1} más
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Información debajo de la imagen */}
                          <div className="p-3 bg-gradient-to-r from-gray-50 to-gray-100 border-t border-gray-200"> {/* REDUCIDO de p-5 */}
                            <p className="text-sm text-gray-800 font-medium text-center"> {/* REDUCIDO de text-base */}
                              Resultado después del servicio
                            </p>
                            <p className="text-xs text-gray-600 text-center mt-1 flex items-center justify-center gap-1"> {/* REDUCIDO de text-sm mt-2 gap-2 */}
                              <ZoomIn className="h-3 w-3" /> {/* REDUCIDO de h-4 w-4 */}
                              Haz clic para ver en tamaño completo
                            </p>
                          </div>
                        </div>

                        {/* Miniaturas si hay más fotos */}
                        {fotosDespues.length > 1 && (
                          <div className="flex gap-1 mt-2 overflow-x-auto pb-1">
                            {fotosDespues.slice(1).map((url, idx) => (
                              <div
                                key={`despues-thumb-${idx}`}
                                className="flex-shrink-0 w-16 h-12 rounded overflow-hidden border border-gray-200 cursor-pointer hover:border-gray-400 transition-colors"
                                onClick={() => setImagenAmpliada({
                                  url,
                                  alt: `Después ${idx + 2}`,
                                  tipo: 'despues',
                                  index: idx + 1,
                                  total: fotosDespues.length
                                })}
                              >
                                <img
                                  src={fixS3Url(url)}
                                  alt={`Después ${idx + 2}`}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Datos específicos de la ficha (sin fotos) */}
        {datosEspecificos && Object.keys(datosEspecificos).filter(key =>
          key !== 'fotos' && key !== 'autorizacion_publicacion' && key !== 'comentario_interno'
        ).length > 0 && (
            <div className="mb-4"> {/* REDUCIDO de mb-6 */}
              <h3 className="font-semibold text-base mb-2 flex items-center gap-1"> {/* REDUCIDO de text-lg mb-3 gap-2 */}
                <span>📋</span> Datos de la Ficha
              </h3>
              <div className="bg-gray-50 p-3 rounded border"> {/* REDUCIDO de p-4 */}
                <div className="space-y-3"> {/* REDUCIDO de space-y-4 */}
                  {Object.entries(datosEspecificos).map(([key, value]: [string, any]) => {
                    // Saltar las fotos, autorización y comentario interno
                    if (['fotos', 'autorizacion_publicacion', 'comentario_interno'].includes(key)) return null;

                    return (
                      <div key={key} className="border-b pb-2 last:border-b-0"> {/* REDUCIDO de pb-3 */}
                        <h4 className="font-medium text-gray-700 capitalize mb-1 text-xs">{key.replace(/_/g, ' ')}:</h4> {/* REDUCIDO texto */}
                        {typeof value === 'object' && value !== null ? (
                          <pre className="mt-1 text-xs bg-white p-2 rounded border overflow-auto max-h-40"> {/* REDUCIDO de text-sm p-3 max-h-60 */}
                            {JSON.stringify(value, null, 2)}
                          </pre>
                        ) : (
                          <p className="mt-1 text-xs text-gray-600">{String(value)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        {/* Comentario interno (si existe) */}
        {comentarioInterno && (
          <div className="mb-4"> {/* REDUCIDO de mb-6 */}
            <h3 className="font-semibold text-base mb-2 flex items-center gap-1"> {/* REDUCIDO de text-lg mb-3 gap-2 */}
              <span>💬</span> Comentario Interno
            </h3>
            <div className="bg-gray-50 border border-gray-200 p-3 rounded"> {/* REDUCIDO de p-4 */}
              <p className="text-sm text-gray-700">{comentarioInterno}</p> {/* REDUCIDO de text-gray-700 */}
            </div>
          </div>
        )}
        {/* Botones de acción */}
        <div className="flex flex-wrap gap-2 justify-end pt-4 border-t"> {/* REDUCIDO de gap-3 pt-6 */}
        </div>
      </div>
    );
  };

  // Vista para ver fichas del cliente (lista)
  const renderVistaVerFichas = () => {
    if (detalleFicha) {
      return renderDetalleFicha();
    }

    return (
      <div className="rounded-lg border bg-white p-4">
        <div className="mb-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVistaActual("menu-principal")}
            className="flex items-center gap-1 text-gray-600 hover:text-gray-900 text-xs"
          >
            <ArrowLeft className="w-3 h-3" />
            Volver a opciones
          </Button>
        </div>

        <div className="mb-4">
          <h2 className="text-lg font-bold mb-1">Fichas del Cliente</h2>
          <p className="text-sm text-gray-600">
            {citaSeleccionada?.cliente?.nombre} {citaSeleccionada?.cliente?.apellido || ''}
          </p>
          <p className="text-xs text-gray-500">
          </p>
        </div>

        {loadingFichas ? (
          <div className="text-center py-6"> {/* REDUCIDO de py-8 */}
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mx-auto"></div> {/* REDUCIDO de h-8 w-8 */}
            <p className="mt-2 text-sm text-gray-600">Cargando fichas...</p> {/* REDUCIDO de mt-3 */}
          </div>
        ) : fichasCliente.length === 0 ? (
          <div className="text-center py-6"> {/* REDUCIDO de py-8 */}
            <FileText className="h-10 w-10 mx-auto mb-3 text-gray-300" /> {/* REDUCIDO de h-12 w-12 mb-4 */}
            <p className="text-sm text-gray-600">No se encontraron fichas para este cliente</p>
            <p className="text-xs text-gray-500 mt-1"> {/* REDUCIDO de text-sm mt-2 */}
              Las fichas que crees usando las opciones anteriores aparecerán aquí
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 text-xs"
              onClick={() => setVistaActual("fichas")}
            >
              <FileText className="h-3 w-3 mr-1" />
              Crear primera ficha
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {fichasCliente.map((ficha) => {
              const datosEspecificos = ficha.contenido?.datos_especificos || ficha.contenido;
              const fotos = datosEspecificos?.fotos;
              let tieneFotos = false;

              if (fotos) {
                const fotosAntes = fotos.antes || fotos.antes_urls || [];
                const fotosDespues = fotos.despues || fotos.despues_urls || [];
                tieneFotos = fotosAntes.length > 0 || fotosDespues.length > 0;
              }

              return (
                <div
                  key={ficha.id}
                  className={`border rounded p-3 hover:shadow transition-shadow cursor-pointer ${getColorPorTipoFicha(ficha.tipo_ficha)}`}
                  onClick={() => setDetalleFicha(ficha)}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div>
                      <h3 className="font-semibold text-sm">{ficha.servicio_nombre}</h3>
                      <p className="text-xs">
                        {getNombreTipoFicha(ficha.tipo_ficha)}
                      </p>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded-full text-xs ${getColorPorTipoFicha(ficha.tipo_ficha)}`}> {/* REDUCIDO de px-2 py-1 */}
                      {ficha.estado}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1 text-xs mb-2"> {/* REDUCIDO de gap-2 text-sm mb-3 */}
                    <div>
                      <span className="text-gray-600">Fecha:</span>
                      <span className="ml-1">{formatFecha(ficha.fecha_ficha)}</span> {/* REDUCIDO de ml-2 */}
                    </div>
                    <div>
                      <span className="text-gray-600">Profesional:</span>
                      <span className="ml-1">{ficha.profesional_nombre}</span> {/* REDUCIDO de ml-2 */}
                    </div>
                    <div>
                      <span className="text-gray-600">Sede:</span>
                      <span className="ml-1">{formatSedeNombre(ficha.sede_nombre, 'Sede no especificada')}</span> {/* REDUCIDO de ml-2 */}
                    </div>
                    <div>
                      <span className="text-gray-600">Precio:</span>
                      <span className="ml-1">${ficha.precio.toLocaleString()}</span> {/* REDUCIDO de ml-2 */}
                    </div>
                  </div>

                  {/* Indicador de fotos */}
                  {tieneFotos && (
                    <div className="mt-1 flex items-center gap-1"> {/* REDUCIDO de mt-2 gap-2 */}
                      <Camera className="w-3 h-3 text-gray-500" /> {/* REDUCIDO de w-4 h-4 */}
                      <span className="text-xs text-gray-600">Contiene fotos</span> {/* REDUCIDO de text-sm */}
                    </div>
                  )}

                  <div className="flex justify-end mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetalleFicha(ficha);
                      }}
                      className="text-xs"
                    >
                      <Eye className="h-3 w-3 mr-1" /> {/* REDUCIDO de h-4 w-4 mr-2 */}
                      Ver Detalles
                    </Button>
                    {/* Botón de edición de fichas deshabilitado */}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Vista de gestión de fichas
  const renderVistaFichas = () => {
    const fichasCitaActual = getFichasGuardadasCitaActual();

    return (
      <div className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex justify-between items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVistaActual("menu-principal")}
            className="flex items-center gap-1 text-gray-600 hover:text-gray-900 text-xs"
          >
            <ArrowLeft className="w-3 h-3" />
            Volver a opciones
          </Button>
        </div>

        <div className="mb-4">
          <h2 className="text-lg font-bold mb-1">Fichas Técnicas</h2>
          <p className="text-sm text-gray-600">
            Selecciona una ficha para crear o continuar el diagnóstico
          </p>
        </div>

        {fichasCitaActual.length > 0 && (
          <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded"> {/* REDUCIDO de mb-6 p-4 rounded-lg */}
            <h4 className="font-semibold text-gray-800 mb-1 text-sm">Fichas en progreso ({fichasCitaActual.length})</h4> {/* REDUCIDO de mb-2 */}
            <div className="space-y-1"> {/* REDUCIDO de space-y-2 */}
              {fichasCitaActual.map((ficha, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-white rounded border"> {/* REDUCIDO de p-3 */}
                  <div className="flex items-center">
                    <FileText className="w-4 h-4 text-gray-600 mr-2" /> {/* REDUCIDO de w-5 h-5 mr-3 */}
                    <div>
                      <p className="font-medium text-sm">{getNombreTipoFicha(ficha.tipo)}</p> {/* REDUCIDO texto */}
                      <p className="text-xs text-gray-500"> {/* REDUCIDO de text-sm */}
                        Guardado: {new Date(ficha.fechaGuardado).toLocaleString('es-ES')}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTipoFichaSeleccionada(ficha.tipo)}
                    className="text-xs"
                  >
                    Continuar
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"> {/* REDUCIDO de gap-4 */}
          {[
            {
              tipo: "DIAGNOSTICO_RIZOTIPO" as TipoFicha,
              titulo: "Diagnóstico Rizotipo",
              descripcion: "Análisis del tipo de cabello y diagnóstico completo",
              color: "bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100"
            },
            {
              tipo: "COLOR" as TipoFicha,
              titulo: "Diagnóstico Cromático",
              descripcion: "Diagnóstico cromático RF® y registro de procesos de coloración",
              color: "bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100"
            },
            {
              tipo: "ASESORIA_CORTE" as TipoFicha,
              titulo: "Asesoría de Corte",
              descripcion: "Recomendaciones y plan de corte personalizado",
              color: "bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100"
            },
            {
              tipo: "CUIDADO_POST_COLOR" as TipoFicha,
              titulo: "Cuidado Post Color",
              descripcion: "Recomendaciones para mantenimiento después del color",
              color: "bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100"
            },
            {
              tipo: "VALORACION_PRUEBA_COLOR" as TipoFicha,
              titulo: "Valoración Prueba Color",
              descripcion: "Evaluación de pruebas de color y resultados",
              color: "bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100"
            },
            {
              tipo: "OZONOTERAPIA_CAPILAR" as TipoFicha,
              titulo: "Ozonoterapia Capilar RF®",
              descripcion: "Protocolo de ozonoterapia y tratamiento capilar RF®",
              color: "bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100"
            }
          ].map((ficha) => (
            <button
              key={ficha.tipo}
              className={`p-4 rounded border-2 text-left transition-all hover:shadow ${ficha.color}`}
              onClick={() => setTipoFichaSeleccionada(ficha.tipo)}
            >
              <div className="flex items-center mb-2">
                <FileText className="w-6 h-6 mr-2" />
                <h4 className="font-semibold text-base">{ficha.titulo}</h4>
              </div>
              <p className="text-xs opacity-80">{ficha.descripcion}</p>
            </button>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t">
          <p className="text-xs text-gray-500">
            <strong>Nota:</strong> Las fichas se guardan automáticamente en tu navegador hasta que finalices el servicio.
          </p>
        </div>
      </div>
    );
  };

  // Vista de gestión de productos
  const renderVistaProductos = () => {
    if (!citaSeleccionada) {
      return (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVistaActual("menu-principal")}
              className="flex items-center gap-1 text-gray-600 hover:text-gray-900 text-xs"
            >
              <ArrowLeft className="w-3 h-3" />
              Volver a opciones
            </Button>
          </div>

          <div className="mb-4">
            <h2 className="text-lg font-bold mb-1">Gestión de Productos</h2>
            <p className="text-sm text-gray-600">
              Selecciona y gestiona los productos utilizados en este servicio
            </p>
          </div>

          <div className="text-center py-8">
            <Package className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-base font-semibold text-gray-700 mb-1">
              No hay cita seleccionada
            </h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              Por favor, selecciona una cita para gestionar productos
            </p>
          </div>
        </div>
      );
    }

    const nombreCliente =
      citaSeleccionada?.cliente?.nombre ||
      citaSeleccionada?.cliente_nombre ||
      "Cliente";
    const correoCliente =
      citaSeleccionada?.cliente?.email ||
      citaSeleccionada?.cliente_email ||
      "";

    return (
      <div className="rounded-lg border bg-white p-4">
        <div className="mb-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVistaActual("menu-principal")}
            className="flex items-center gap-1 text-gray-600 hover:text-gray-900 text-xs"
          >
            <ArrowLeft className="w-3 h-3" />
            Volver a opciones
          </Button>
        </div>

        <div className="mb-4">
          <h2 className="text-lg font-bold mb-1">Gestión de Productos</h2>
          <p className="text-sm text-gray-600">
            Selecciona y gestiona los productos utilizados en este servicio
          </p>

          {/* Información de la cita */}
          <div className="mt-2 p-3 bg-gray-50 rounded border">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="font-medium text-gray-600">Cliente:</span>
                <p className="font-semibold">
                  {nombreCliente}
                </p>
              </div>
              <div>
                <span className="font-medium text-gray-600">Servicio:</span>
                <p className="font-semibold">
                  {citaSeleccionada.servicios?.map((s: any) => s.nombre).join(', ') || citaSeleccionada.servicio?.nombre || 'Sin servicio'}
                </p>
              </div>
              {correoCliente && (
                <div className="col-span-2">
                  <span className="font-medium text-gray-600">Correo:</span>
                  <p className="truncate">{correoCliente}</p>
                </div>
              )}
              <div>
                <span className="font-medium text-gray-600">Fecha:</span>
                <p>{citaSeleccionada.fecha}</p>
              </div>
              <div>
                <span className="font-medium text-gray-600">Hora:</span>
                <p>{citaSeleccionada.hora_inicio} - {citaSeleccionada.hora_fin}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Integración del panel de productos */}
        <ProductManagementPanel
          citaId={citaSeleccionada.cita_id}
          onProductsUpdated={(total) => {
            console.log('Total productos actualizado:', total);
            setTotalProductos(total);
          }}
          disabled={false}
        />

        {/* Información adicional */}
        <div className="mt-6 pt-4 border-t">
          <p className="text-xs text-gray-500">
            <strong>Nota:</strong> Los productos seleccionados se guardarán automáticamente
            en la cita y estarán disponibles para facturación.
          </p>
        </div>
      </div>
    );
  };

  // Vista del calendario (vista inicial)
  const renderVistaCalendario = () => {
    const monthInfo = getMonthInfo(mesActual);
    const diasSemana = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    return (
      <div className="rounded-lg border bg-white p-4"> {/* REDUCIDO de p-6 */}
        <div className="mb-4"> {/* REDUCIDO de mb-6 */}
          <div className="flex justify-between items-center mb-3"> {/* REDUCIDO de mb-4 */}
            <div>
              <h2 className="text-lg font-bold">Calendario de Citas</h2> {/* REDUCIDO de text-2xl */}
            </div>
            <button
              onClick={() => abrirModalBloqueos()}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors text-xs"
              aria-label="Crear bloqueo de horario"
            >
              <Ban className="w-3 h-3" /> {/* REDUCIDO de w-4 h-4 */}
              <span className="font-medium">Bloquear horario</span>
            </button>
          </div>
        </div>

        {/* Controles del calendario */}
        <div className="flex justify-between items-center mb-4">
          <button
            onClick={mesAnterior}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
          </button>
          <div className="text-center">
            <h3 className="text-base font-semibold">{monthInfo.monthName} {monthInfo.year}</h3> {/* REDUCIDO de text-xl */}
          </div>
          <button
            onClick={mesSiguiente}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Días de la semana */}
        <div className="grid grid-cols-7 gap-1 mb-1"> {/* REDUCIDO de mb-2 */}
          {diasSemana.map((dia) => (
            <div key={dia} className="text-center font-medium text-gray-500 py-1 text-xs"> {/* REDUCIDO de py-2, AÑADIDO text-xs */}
              {dia}
            </div>
          ))}
        </div>

        {/* Días del mes */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: monthInfo.firstDayOffset }).map((_, index) => (
            <div key={`empty-${index}`} className="h-10" />
          ))}

          {Array.from({ length: monthInfo.totalDays }).map((_, index) => {
            const dia = index + 1;
            const esHoy = dia === monthInfo.today &&
              monthInfo.monthNumber === monthInfo.currentMonth &&
              monthInfo.year === monthInfo.currentYear;

            return (
              <button
                key={dia}
                onClick={(e) => handleDiaClick(dia, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const { year, monthNumber } = getMonthInfo(mesActual);
                  const mesFormateado = (monthNumber + 1).toString().padStart(2, '0');
                  const diaFormateado = dia.toString().padStart(2, '0');
                  const fechaFormateada = `${year}-${mesFormateado}-${diaFormateado}`;
                  abrirModalBloqueos(fechaFormateada);
                }}
                className={`
        h-10 flex items-center justify-center rounded border text-xs
        ${esHoy
                    ? 'bg-gray-100 border-gray-300 text-gray-700'
                    : 'hover:bg-gray-100 border-gray-200'
                  }
      `}
                aria-label={`Seleccionar día ${dia}`}
              >
                <span className={esHoy ? 'font-bold' : ''}>{dia}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t"> {/* REDUCIDO de mt-8 pt-6 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Calendar className="w-4 h-4 mr-1 text-gray-400" /> {/* REDUCIDO de w-5 h-5 mr-2 */}
              <span className="text-xs text-gray-600"> {/* REDUCIDO de text-sm */}
                Selecciona un día para ver las citas programadas
              </span>
            </div>
            {onVolver && (
              <Button
                variant="outline"
                size="sm"
                onClick={onVolver}
                className="text-xs"
              >
                ← Volver al listado
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Vista del menú principal con opciones
  // Vista del menú principal con opciones - VERSIÓN COMPLETA CON PRODUCTOS
  const renderVistaMenuPrincipal = () => {
    const estadoInfo = getEstadoCita(citaSeleccionada);
    const fichasCitaActual = getFichasGuardadasCitaActual();
    const nombreCliente =
      citaSeleccionada?.cliente?.nombre ||
      citaSeleccionada?.cliente_nombre ||
      "Cliente";
    const correoCliente =
      citaSeleccionada?.cliente?.email ||
      citaSeleccionada?.cliente_email ||
      "";
    const notaCita = (
      citaSeleccionada?.comentario ||
      (citaSeleccionada as any)?.comentarios ||
      (citaSeleccionada as any)?.notas ||
      (citaSeleccionada as any)?.nota ||
      (citaSeleccionada as any)?.observaciones ||
      ""
    )
      .toString()
      .trim();

    // Extraer productos de la cita si existen
    const productosCita = citaSeleccionada?.productos || [];
    const tieneProductos = productosCita.length > 0;

    // Calcular total de productos
    const totalProductosCalculado = productosCita.reduce((sum: number, p: any) =>
      sum + (p.subtotal || (p.precio_unitario || 0) * (p.cantidad || 1)), 0
    );

    return (
      <div className="rounded-lg border bg-white p-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold">Protocolo de atención</h2>
            <p className="text-sm text-gray-600 mt-1">
              {nombreCliente} - {
                citaSeleccionada.servicios?.map((s: any) => s.nombre).join(', ') ||  citaSeleccionada.servicio?.nombre || 'Sin servicio'}
            </p>
            {correoCliente && (
              <p className="text-xs text-gray-500 truncate">{correoCliente}</p>
            )}
            <p className="text-xs text-gray-500">
              {citaSeleccionada.fecha} • {citaSeleccionada.hora_inicio} - {citaSeleccionada.hora_fin}
            </p>
          </div>
          <div className={`${estadoInfo.color} text-xs px-2 py-1 rounded-full border flex items-center gap-1`}>
            {estadoInfo.icon}
            <span className="font-medium">{estadoInfo.estado}</span>
          </div>
        </div>

        {notaCita && (
          <div className="mb-4 flex items-start justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
            <div className="flex min-w-0 items-start gap-2">
              <FileText className="mt-[2px] h-4 w-4 text-gray-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-900">Notas de la cita</p>
                <p className="whitespace-pre-line break-words leading-5 text-gray-800">{notaCita}</p>
              </div>
            </div>
          </div>
        )}

        {fichasCitaActual.length > 0 && (
          <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Save className="w-3 h-3 text-gray-600 mr-1" />
                <span className="text-xs font-medium text-gray-800">
                  Tienes {fichasCitaActual.length} ficha(s) pendiente(s)
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVistaActual("fichas")}
                className="text-xs"
              >
                Continuar
              </Button>
            </div>
          </div>
        )}

        {/* Contador de fichas existentes */}
        {fichasCliente.length > 0 && (
          <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Eye className="w-3 h-3 text-gray-600 mr-1" />
                <span className="text-xs font-medium text-gray-800">
                  Tienes {fichasCliente.length} ficha(s) creada(s) para este cliente
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVistaActual("ver-fichas")}
                className="text-xs"
              >
                Ver Fichas
              </Button>
            </div>
          </div>
        )}

        {/* Contador de productos existentes en la cita */}
        {tieneProductos && (
          <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <ShoppingCart className="w-3 h-3 text-gray-600 mr-1" />
                <span className="text-xs font-medium text-gray-800">
                  {productosCita.length} producto(s) en la cita - Total: ${totalProductosCalculado.toLocaleString()}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVistaActual("productos")}
                className="text-xs"
              >
                <ShoppingCart className="h-3 w-3 mr-1" />
                Ver/Modificar
              </Button>
            </div>

            {/* Lista rápida de productos */}
            <div className="mt-2 space-y-1">
              {productosCita.slice(0, 3).map((producto: any, index: number) => (
                <div key={index} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 mr-2">{producto.nombre}</span>
                  <span className="font-medium text-gray-700 whitespace-nowrap">
                    {producto.cantidad || 1}x ${(producto.precio_unitario || 0).toLocaleString()}
                  </span>
                </div>
              ))}
              {productosCita.length > 3 && (
                <div className="text-xs text-gray-500 text-center">
                  +{productosCita.length - 3} más...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bloque de calificación del cliente desactivado temporalmente. */}

        <div className="mb-4">
          <h3 className="mb-3 font-semibold text-sm">¿Qué deseas hacer?</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              className="p-4 rounded border-2 border-gray-200 bg-gray-50 text-left transition-all hover:shadow hover:border-gray-300"
              onClick={() => setVistaActual("fichas")}
            >
              <div className="flex items-center mb-2">
                <FileText className="w-6 h-6 text-gray-600 mr-2" />
                <h4 className="font-semibold text-gray-800 text-base">Gestionar Fichas</h4>
              </div>
              <p className="text-xs text-gray-600">
                Crear y gestionar fichas técnicas de diagnóstico y tratamiento
              </p>
            </button>

            <button
              className="p-4 rounded border-2 border-gray-200 bg-gray-50 text-left transition-all hover:shadow hover:border-gray-300"
              onClick={() => setVistaActual("productos")}
            >
              <div className="flex items-center mb-2">
                <ShoppingCart className="w-6 h-6 text-gray-600 mr-2" />
                <h4 className="font-semibold text-gray-800 text-base">Gestionar Productos</h4>
              </div>
              <p className="text-xs text-gray-600">
                Seleccionar productos y gestionar inventario del servicio
              </p>
              {tieneProductos && (
                <div className="mt-2 inline-flex items-center px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded-full">
                  <ShoppingCart className="w-3 h-3 mr-1" />
                  {productosCita.length} producto(s) - ${totalProductosCalculado.toLocaleString()}
                </div>
              )}
              {!tieneProductos && totalProductos > 0 && (
                <div className="mt-2 inline-flex items-center px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded-full">
                  <ShoppingCart className="w-3 h-3 mr-1" />
                  ${totalProductos.toLocaleString()} en productos
                </div>
              )}
            </button>

            <button
              className="p-4 rounded border-2 border-gray-200 bg-gray-50 text-left transition-all hover:shadow hover:border-gray-300"
              onClick={() => setVistaActual("ver-fichas")}
            >
              <div className="flex items-center mb-2">
                <Eye className="w-6 h-6 text-gray-600 mr-2" />
                <h4 className="font-semibold text-gray-800 text-base">Ver Fichas Existentes</h4>
              </div>
              <p className="text-xs text-gray-600">
                Consultar fichas técnicas creadas anteriormente para este cliente
              </p>
            </button>
          </div>
        </div>

        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.location.reload();
            }}
            className="flex-1 text-xs"
          >
            <ArrowLeft className="w-3 h-3 mr-1" />
            Volver al calendario
          </Button>

          {citaSeleccionada && puedeMostrarFinalizar(citaSeleccionada) && (
            <Button
              size="sm"
              className={`flex-1 text-xs shadow ${primaryActionButtonClass}`}
              onClick={() => setMostrarConfirmacionFinalizar(true)}
              disabled={loadingFinalizar}
            >
              {loadingFinalizar ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                  {usuarioRol === "estilista" ? "Finalizando..." : "Procesando..."}
                </>
              ) : (
                <>
                  {usuarioRol === "estilista" ? (
                    <>
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Finalizar Servicio (Estilista)
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Finalizar y Facturar
                    </>
                  )}
                </>
              )}
            </Button>
          )}

          {/* INDICADOR SI YA ESTÁ FINALIZADA */}
          {citaSeleccionada && !puedeMostrarFinalizar(citaSeleccionada) && (
            <div className="flex-1 flex items-center justify-center p-1 bg-gray-100 text-gray-600 rounded border text-xs">
              <CheckCircle className="w-3 h-3 mr-1 text-gray-600" />
              <span className="font-medium">
                Servicio {getEstadoCita(citaSeleccionada).estado.toLowerCase()}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Si hay cita seleccionada pero no se ha elegido una vista específica
  if (citaSeleccionada && vistaActual === "calendario" && !mostrarConfirmacionFinalizar) {
    return renderVistaMenuPrincipal();
  }

  if (citaSeleccionada && tipoFichaSeleccionada) {
    const datosGuardados = cargarFichaGuardada(tipoFichaSeleccionada);
    const datosDesdeFicha = extraerDatosInicialesFicha(fichaEnEdicion, tipoFichaSeleccionada);
    const datosIniciales = datosDesdeFicha || datosGuardados;

    const fichaProps = {
      cita: citaSeleccionada,
      datosIniciales,
      onGuardar: (datos: any) => guardarFicha(tipoFichaSeleccionada, datos),
      fichaId: fichaEnEdicion?.id,
      modoEdicion: Boolean(fichaEnEdicion),
      onSubmit: (_: any) => {
        const citaId = getCitaId(citaSeleccionada);
        const clienteIdActual = citaSeleccionada?.cliente?.cliente_id || citaSeleccionada?.cliente_id;
        const tipoActual = tipoFichaSeleccionada;

        if (citaId && tipoActual) {
          setFichasGuardadas((prev) =>
            prev.filter((ficha) => !(ficha.citaId === citaId && ficha.tipo === tipoActual))
          );
        }

        if (clienteIdActual) {
          fetchFichasCliente(clienteIdActual);
        }

        setFichaEnEdicion(null);
        setTipoFichaSeleccionada(null);
        setVistaActual("fichas");
        scrollBottomSheetToTop();
      },
      onCancelar: () => {
        setFichaEnEdicion(null);
        setTipoFichaSeleccionada(null);
        setVistaActual("fichas");
        scrollBottomSheetToTop();
      }
    };

    const renderFicha = () => {
      switch (tipoFichaSeleccionada) {
        case "DIAGNOSTICO_RIZOTIPO":
          return <FichaDiagnosticoRizotipo {...fichaProps} />;
        case "COLOR":
          return <FichaColor {...fichaProps} />;
        case "ASESORIA_CORTE":
          return <FichaAsesoriaCorte {...fichaProps} />;
        case "CUIDADO_POST_COLOR":
          return <FichaCuidadoPostColor {...fichaProps} />;
        case "VALORACION_PRUEBA_COLOR":
          return <FichaValoracionPruebaColor {...fichaProps} />;
        case "OZONOTERAPIA_CAPILAR":
          return <FichaOzonoterapiaCapilar {...fichaProps} />;
        default:
          return null;
      }
    };

    return (
      <div>
        {/* SOLO EN FICHAS ESPECÍFICAS: BOTÓN PARA VOLVER AL SELECTOR DE FICHAS */}
        <div className="mb-3 flex items-center space-x-1"> {/* REDUCIDO de mb-4 space-x-2 */}
          <button
            onClick={() => {
              setTipoFichaSeleccionada(null);
              setVistaActual("fichas");
            }}
            className="text-[oklch(0.55_0.25_280)] hover:underline text-xs flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" /> {/* REDUCIDO de w-4 h-4 */}
            Volver al selector de fichas
          </button>
        </div>
        {renderFicha()}
      </div>
    );
  }


  // Modal de confirmación para finalizar servicio
  if (mostrarConfirmacionFinalizar) {
    const fichasCitaActual = getFichasGuardadasCitaActual();

    return (
      <div className="rounded-lg border bg-white p-4"> {/* REDUCIDO de p-6 */}
        <div className="text-center py-6"> {/* REDUCIDO de py-8 */}
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3"> {/* REDUCIDO de w-16 h-16 mb-4 */}
            <CheckCircle className="w-6 h-6 text-gray-600" /> {/* REDUCIDO de w-8 h-8 */}
          </div>
          <h4 className="text-base font-semibold text-gray-900 mb-1">¿Finalizar servicio?</h4> {/* REDUCIDO de text-lg mb-2 */}
          <p className="text-sm text-gray-600 mb-3"> {/* REDUCIDO de mb-4 */}
            ¿Estás seguro de que deseas finalizar el servicio para <strong>{citaSeleccionada?.cliente.nombre}</strong>?
          </p>

          {fichasCitaActual.length > 0 && (
            <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded"> {/* REDUCIDO de mb-4 p-3 rounded-lg */}
              <p className="text-gray-700 text-xs"> {/* REDUCIDO de text-sm */}
                <strong>⚠️ Advertencia:</strong> Tienes {fichasCitaActual.length} ficha(s) pendiente(s) que se perderán.
              </p>
              <div className="mt-1 text-xs text-gray-600"> {/* REDUCIDO de mt-2 */}
                {fichasCitaActual.map((ficha, index) => (
                  <div key={index}>• {ficha.tipo.replace(/_/g, ' ')}</div>
                ))}
              </div>
            </div>
          )}

          {/* Dentro del modal, busca los botones y reemplaza: */}
          <div className="flex space-x-2 justify-center"> {/* REDUCIDO de space-x-3 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMostrarConfirmacionFinalizar(false)}
              disabled={loadingFinalizar}
              className="px-4 text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className={`px-4 text-xs ${primaryActionButtonClass}`}
              onClick={() => finalizarServicioAPI(getCitaId(citaSeleccionada))}
              disabled={loadingFinalizar || !getCitaId(citaSeleccionada)}
            >
              {loadingFinalizar ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div> {/* REDUCIDO de h-4 w-4 mr-2 */}
                  {usuarioRol === "estilista" ? "Finalizando..." : "Procesando..."}
                </>
              ) : usuarioRol === "estilista" ? (
                'Sí, Finalizar como Estilista'
              ) : (
                'Sí, Finalizar y Facturar'
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }
  // 🆕 AÑADIR ESTO ANTES DEL ÚLTIMO CIERRE DEL COMPONENTE:

  // Modal de bloqueos (al final del componente, antes del último return)
  if (mostrarModalBloqueos) {
    return (
      <>
        {/* Overlay */}
        <div className="fixed inset-0 z-[70] bg-black/50" onClick={cerrarModalBloqueos} />

        {/* Modal centrado */}
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4">
          <div className="relative w-full max-w-[24rem] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl max-h-[88vh] sm:max-w-md">
            <BloqueosModal
              onClose={cerrarModalBloqueos}
              fecha={fechaSeleccionadaParaBloqueo}
              compact
            />
          </div>
        </div>

        {/* Renderizar calendario en el fondo (opcional) */}
        {renderVistaCalendario()}
      </>
    );
  }

  // ... tu return final existente ...

  // Renderizar vistas según la selección
  switch (vistaActual) {
    case "fichas":
      return renderVistaFichas();
    case "productos":
      return renderVistaProductos();
    case "ver-fichas":
      return renderVistaVerFichas();
    case "menu-principal":
      return renderVistaMenuPrincipal();
    default:
      return renderVistaCalendario();
  }
}
