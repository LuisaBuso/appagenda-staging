// components/Quotes/AppointmentDetailsModal.tsx
import React, { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { confirmAction } from "../../../components/ui/confirm-dialog";
import { DatePicker } from "../../../components/ui/DatePicker";
import {
  Loader2,
  CheckCircle,
  Plus,
  Minus,
  Package,
  CreditCard as CardIcon,
  Wallet,
  Tag,
  X,
  Bug,
  Wand2,
  Phone,
  Mail,
  DollarSign,
  Save,
  MessageCircle,
  ChevronLeft,
  Search,
} from "lucide-react";
import Modal from "../../../components/ui/modal";
import { useAuth } from "../../../components/Auth/AuthContext";
import { updateQuote, registrarPagoCita, confirmarCita, reenviarCorreoCita, ApiRequestError } from "./citasApi";
import { formatDateDMY } from "../../../lib/dateFormat";
import {
  getServicios,
  type Servicio as ServicioCatalogo,
} from "../../../components/Quotes/serviciosApi";
import {
  getEstilistas,
  type Estilista,
} from "../../../components/Professionales/estilistasApi";
import { API_BASE_URL } from "../../../types/config";
import type { Cliente } from "../../../types/cliente";
import TimeInputWithPicker from "../../../components/ui/time-input-with-picker";
import {
  extractAgendaAdditionalNotes,
  normalizeAgendaTimeValue,
} from "../../../lib/agenda";
import {
  normalizePaymentMethodForBackend,
  PAYMENT_METHOD_OPTIONS,
} from "../../../lib/payment-methods";

// ── RF design status system — estados backend: pre_reservada, confirmada, cancelada, completada, no_asistio ──
const RF_STATUSES = {
  pre_reservada: { color: "#F59E0B", bg: "#FFFBEB", label: "Pre-reservada" },
  confirmada:    { color: "#3B82F6", bg: "#EFF6FF", label: "Confirmada" },
  "in-progress": { color: "#8B5CF6", bg: "#F5F3FF", label: "En curso" },
  finalizado:    { color: "#F97316", bg: "#FFF7ED", label: "Finalizado" },
  completada:    { color: "#10B981", bg: "#ECFDF5", label: "Facturada" },
  cancelada:     { color: "#EF4444", bg: "#FEF2F2", label: "Cancelada" },
  no_asistio:    { color: "#6B7280", bg: "#F3F4F6", label: "No asistió" },
} as const;
type RFStatusKey = keyof typeof RF_STATUSES;

const resolveRFStatus = (estado: string): RFStatusKey => {
  const v = (estado || "").toLowerCase().trim();
  if (v.includes("cancel")) return "cancelada";
  if (v === "no_asistio" || v === "no asistio" || v.includes("no_asistio") || v.includes("no asistio")) return "no_asistio";
  if (["pre_reservada", "pre-cita", "pre_cita", "precita"].some((s) => v.includes(s))) return "pre_reservada";
  if (
    ["en proc", "en_proc", "proceso", "en curso", "en_curso", "en-curso", "progres", "in-prog"].some(
      (s) => v.includes(s),
    )
  ) return "in-progress";
  if (["finaliz"].some((s) => v.includes(s))) return "finalizado";
  if (
    ["complet", "terminad", "realizad", "factur"].some((s) => v.includes(s))
  ) return "completada";
  // "confirmada" o "confirmed" como estado explícito
  if (v === "confirmada" || v === "confirmed") return "confirmada";
  return "confirmada";
};

interface AppointmentDetailsModalProps {
  open: boolean;
  onClose: () => void;
  appointment: any;
  onRefresh?: () => void;
  /** When true, renders content directly (no centered Modal wrapper) for use in a side panel */
  panelMode?: boolean;
}

interface PagoModalData {
  show: boolean;
  tipo: "pago" | "abono";
  monto: number;
  metodoPago: string;
  codigoGiftcard: string;
}

interface ProductoSeleccionado {
  producto_id: string;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  moneda?: string;
  comision_porcentaje?: number;
  comision_valor?: number;
  agregado_por_email?: string;
  agregado_por_rol?: string;
  fecha_agregado?: string;
  profesional_id?: string;
}

interface ServicioSeleccionado {
  servicio_id: string;
  nombre: string;
  precio_unitario: number;
  precio_unitario_input: string;
  precio_base: number;
  cantidad: number;
  duracion_minutos: number;
  subtotal: number;
  precio_personalizado: number | null;
  usa_precio_personalizado: boolean;
}

interface ServicioDisponible {
  servicio_id: string;
  nombre: string;
  precio: number;
  duracion_minutos: number;
}

interface ProductoDisponible {
  producto_id: string;
  nombre: string;
  precio: number;
  moneda: string;
}

interface ProfesionalDisponible {
  profesional_id: string;
  nombre: string;
  hasSchedule: boolean | null;
  invalidAgendaId: boolean;
}

const ESTADOS_NO_EDITABLES_SERVICIOS = new Set([
  "cancelada",
  "completada",
  "finalizada",
  "no asistio",
  "no_asistio",
  "no asistió",
]);

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundMoney = (value: number): number => {
  return Math.round(value * 100) / 100;
};

const extraerMensajeError = (error: any, fallback: string): string => {
  const rawMessage = error?.message ?? error;

  if (!rawMessage) return fallback;
  if (typeof rawMessage === "string") return rawMessage;

  if (Array.isArray(rawMessage)) {
    const joined = rawMessage
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof item.msg === "string")
          return item.msg;
        return JSON.stringify(item);
      })
      .join(" | ");
    return joined || fallback;
  }

  if (typeof rawMessage === "object") {
    if (typeof rawMessage.detail === "string") return rawMessage.detail;
    const entries = Object.entries(rawMessage)
      .map(
        ([key, value]) =>
          `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
      )
      .join(" | ");
    return entries || fallback;
  }

  return fallback;
};

const HORARIO_FLAG_KEYS = [
  "horario_configurado",
  "tiene_horario",
  "has_schedule",
  "tiene_disponibilidad",
  "disponible_para_agenda",
];

const normalizarTexto = (value: string): string => {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
};

const parseBooleanLike = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalizado = normalizarTexto(value);
    if (["true", "si", "sí", "1", "activo", "disponible"].includes(normalizado))
      return true;
    if (["false", "no", "0", "inactivo", "sin horario"].includes(normalizado))
      return false;
  }
  return null;
};

const isMongoObjectIdLike = (value: string): boolean =>
  /^[a-fA-F0-9]{24}$/.test(String(value || "").trim());

const inferirSiTieneHorario = (
  profesional: Record<string, unknown>,
): boolean | null => {
  for (const key of HORARIO_FLAG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(profesional, key)) {
      return parseBooleanLike(profesional[key]);
    }
  }
  return null;
};

const esErrorSinHorarioConfigurado = (mensaje: string): boolean => {
  const normalizado = normalizarTexto(mensaje);
  return normalizado.includes("no tiene horario configurado");
};

const esErrorDisponibilidadHorario = (mensaje: string): boolean => {
  const normalizado = normalizarTexto(mensaje);
  return (
    normalizado.includes("no tiene disponibilidad para esa fecha") ||
    normalizado.includes("fuera del horario laboral del profesional")
  );
};

const construirMensajeErrorCita = (
  error: unknown,
  fallback: string,
): { mensaje: string; sinHorario: boolean } => {
  const mensajeOriginal = extraerMensajeError(error, fallback);

  if (esErrorSinHorarioConfigurado(mensajeOriginal)) {
    return {
      mensaje:
        "No se puede asignar esta cita: el profesional seleccionado no tiene horario configurado. Configura su horario o selecciona otro.",
      sinHorario: true,
    };
  }

  if (esErrorDisponibilidadHorario(mensajeOriginal)) {
    return {
      mensaje:
        "No se puede asignar esta cita en la fecha/hora actual para el profesional seleccionado. Ajusta la fecha u hora, o elige otro profesional.",
      sinHorario: false,
    };
  }

  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        mensaje:
          mensajeOriginal ||
          "Existe un conflicto de agenda para la cita seleccionada.",
        sinHorario: false,
      };
    }
    if (error.status === 400 || error.status === 422) {
      return {
        mensaje:
          mensajeOriginal ||
          "Hay datos inválidos en la edición de la cita. Revisa los campos e intenta de nuevo.",
        sinHorario: false,
      };
    }
    if (error.status >= 500) {
      return {
        mensaje:
          "Ocurrió un error interno al guardar la cita. Intenta nuevamente en unos minutos.",
        sinHorario: false,
      };
    }
  }

  return { mensaje: mensajeOriginal, sinHorario: false };
};

const normalizarServiciosCita = (
  servicios: any[] | undefined,
): ServicioSeleccionado[] => {
  if (!Array.isArray(servicios)) return [];

  return servicios
    .filter((servicio) => servicio && servicio.servicio_id)
    .map((servicio) => {
      const precioUnitario = roundMoney(toNumber(servicio.precio));
      const cantidad = Math.max(
        1,
        Math.trunc(toNumber(servicio.cantidad) || 1),
      );
      const usaPrecioPersonalizado = Boolean(servicio.precio_personalizado);
      const subtotalRaw =
        servicio.subtotal !== undefined
          ? toNumber(servicio.subtotal)
          : precioUnitario * cantidad;

      return {
        servicio_id: String(servicio.servicio_id),
        nombre: String(servicio.nombre || "Servicio"),
        precio_unitario: precioUnitario,
        precio_unitario_input: String(precioUnitario),
        precio_base: precioUnitario,
        cantidad,
        duracion_minutos: Math.max(
          0,
          Math.trunc(
            toNumber(servicio.duracion_minutos || servicio.duracion) || 0,
          ),
        ),
        subtotal: roundMoney(subtotalRaw),
        precio_personalizado: usaPrecioPersonalizado ? precioUnitario : null,
        usa_precio_personalizado: usaPrecioPersonalizado,
      };
    });
};

const normalizarComparacionServicios = (servicios: ServicioSeleccionado[]) => {
  return [...servicios]
    .map((servicio) => ({
      servicio_id: servicio.servicio_id,
      cantidad: servicio.cantidad,
      precio_unitario: roundMoney(servicio.precio_unitario),
      usa_precio_personalizado: servicio.usa_precio_personalizado,
    }))
    .sort((a, b) => a.servicio_id.localeCompare(b.servicio_id));
};

const normalizarComparacionServiciosHorario = (
  servicios: ServicioSeleccionado[],
) => {
  return [...servicios]
    .map((servicio) => ({
      servicio_id: servicio.servicio_id,
      cantidad: servicio.cantidad,
    }))
    .sort((a, b) => a.servicio_id.localeCompare(b.servicio_id));
};

const normalizarProductosCita = (
  productos: any[] | undefined,
): ProductoSeleccionado[] => {
  if (!Array.isArray(productos)) return [];

  return productos
    .filter(
      (producto) =>
        producto && (producto.producto_id || producto.id || producto._id),
    )
    .map((producto) => {
      const productoId = String(
        producto.producto_id || producto.id || producto._id,
      );
      const cantidad = Math.max(
        1,
        Math.trunc(toNumber(producto.cantidad) || 1),
      );
      const precioUnitario = roundMoney(
        toNumber(producto.precio_unitario ?? producto.precio ?? 0),
      );
      const subtotal = roundMoney(
        producto.subtotal !== undefined
          ? toNumber(producto.subtotal)
          : precioUnitario * cantidad,
      );
      const comisionPorcentaje = roundMoney(
        toNumber(producto.comision_porcentaje ?? 0),
      );

      return {
        producto_id: productoId,
        nombre: String(producto.nombre || "Producto"),
        cantidad,
        precio_unitario: precioUnitario,
        subtotal,
        moneda: String(producto.moneda || ""),
        comision_porcentaje: comisionPorcentaje,
        comision_valor: roundMoney(
          producto.comision_valor !== undefined
            ? toNumber(producto.comision_valor)
            : (subtotal * comisionPorcentaje) / 100,
        ),
        agregado_por_email: producto.agregado_por_email,
        agregado_por_rol: producto.agregado_por_rol,
        fecha_agregado: producto.fecha_agregado,
        profesional_id: producto.profesional_id,
      };
    });
};

const normalizarComparacionProductos = (productos: ProductoSeleccionado[]) => {
  return [...productos]
    .map((producto) => ({
      producto_id: producto.producto_id,
      cantidad: producto.cantidad,
      precio_unitario: roundMoney(producto.precio_unitario),
    }))
    .sort((a, b) => a.producto_id.localeCompare(b.producto_id));
};

const normalizeNote = (value: string | null | undefined): string =>
  String(value ?? "").trim();

const AppointmentDetailsModal: React.FC<AppointmentDetailsModalProps> = ({
  open,
  onClose,
  appointment,
  onRefresh,
  panelMode = false,
}) => {
  const { user } = useAuth();
  const [updating, setUpdating] = useState(false);
  const [appointmentDetails, setAppointmentDetails] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [pagoModal, setPagoModal] = useState<PagoModalData>({
    show: false,
    tipo: "pago",
    monto: 0,
    metodoPago: "efectivo",
    codigoGiftcard: "",
  });
  const [registrandoPago, setRegistrandoPago] = useState(false);
  const [productos, setProductos] = useState<ProductoSeleccionado[]>([]);
  const [productosOriginales, setProductosOriginales] = useState<
    ProductoSeleccionado[]
  >([]);
  const [productosDisponibles, setProductosDisponibles] = useState<
    ProductoDisponible[]
  >([]);
  const [productosCatalogoCargado, setProductosCatalogoCargado] =
    useState(false);
  const [_selectedProductId, setSelectedProductId] = useState("");
  const [loadingProductosDisponibles, setLoadingProductosDisponibles] =
    useState(false);
  const [prodSearchQuery, setProdSearchQuery] = useState("");
  const [showProdDropdown, setShowProdDropdown] = useState(false);

  const [profesionalesDisponibles, setProfesionalesDisponibles] = useState<
    ProfesionalDisponible[]
  >([]);
  const [loadingProfesionales, setLoadingProfesionales] = useState(false);
  const [fechaEditada, setFechaEditada] = useState("");
  const [horaInicioEditada, setHoraInicioEditada] = useState("");
  const [horaFinEditada, setHoraFinEditada] = useState("");
  const [horaFinManual, setHoraFinManual] = useState(false);
  const [profesionalEditadoId, setProfesionalEditadoId] = useState("");
  const [horarioOriginal, setHorarioOriginal] = useState({
    fecha: "",
    hora_inicio: "",
    hora_fin: "",
    profesional_id: "",
  });

  const [serviciosDisponibles, setServiciosDisponibles] = useState<
    ServicioDisponible[]
  >([]);
  const [serviciosSeleccionados, setServiciosSeleccionados] = useState<
    ServicioSeleccionado[]
  >([]);
  const [serviciosOriginales, setServiciosOriginales] = useState<
    ServicioSeleccionado[]
  >([]);
  const [_selectedServiceId, setSelectedServiceId] = useState("");
  const [loadingServiciosDisponibles, setLoadingServiciosDisponibles] =
    useState(false);
  const [svcSearchQuery, setSvcSearchQuery] = useState("");
  const [showSvcDropdown, setShowSvcDropdown] = useState(false);
  const [savingServicios, setSavingServicios] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [notasEditadas, setNotasEditadas] = useState("");
  const [notasOriginales, setNotasOriginales] = useState("");
  const [savingNotas, setSavingNotas] = useState(false);
  const [notasError, setNotasError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"cita" | "pagos" | "notas">(
    "cita",
  );
  const [showClientProfile, setShowClientProfile] = useState(false);
  const [clientProfile, setClientProfile] = useState<Cliente | null>(null);
  const [loadingClientProfile, setLoadingClientProfile] = useState(false);
  const [confirmandoCita, setConfirmandoCita] = useState(false);

  const sessionCurrency =
    typeof window !== "undefined"
      ? sessionStorage.getItem("beaux-moneda")
      : null;
  const userCurrency = String(
    user?.moneda ||
      sessionCurrency ||
      appointmentDetails?.rawData?.moneda ||
      "USD",
  ).toUpperCase();
  const isCopCurrency = userCurrency === "COP";

  const sanitizeMetodoPago = (
    metodo: PagoModalData["metodoPago"],
  ): PagoModalData["metodoPago"] => {
    const normalizedMethod = normalizePaymentMethodForBackend(
      metodo,
    ) as PagoModalData["metodoPago"];
    if (!isCopCurrency && normalizedMethod === "addi") {
      return "efectivo";
    }
    return normalizedMethod;
  };

  useEffect(() => {
    if (open && appointment) {
      setAppointmentDetails(appointment);
      setServiceError(null);
      setSelectedServiceId("");
      setSvcSearchQuery("");
      setShowSvcDropdown(false);
      setSelectedProductId("");
      setProdSearchQuery("");
      setShowProdDropdown(false);
      setProductosDisponibles([]);
      setProductosCatalogoCargado(false);
      setActiveTab("cita");
      setShowClientProfile(false);
      setClientProfile(null);

      const rawData = appointment.rawData || {};
      const productosIniciales = normalizarProductosCita(
        rawData.productos || appointment.productos || [],
      );
      setProductos(productosIniciales);
      setProductosOriginales(productosIniciales);

      const fechaInicial = String(rawData.fecha || "").slice(0, 10);
      const horaInicioInicial =
        normalizeAgendaTimeValue(
          String(rawData.hora_inicio || appointment.start || ""),
        ) || String(rawData.hora_inicio || appointment.start || "");
      const horaFinInicial =
        normalizeAgendaTimeValue(
          String(rawData.hora_fin || appointment.end || ""),
        ) || String(rawData.hora_fin || appointment.end || "");
      const profesionalInicial = String(
        rawData.profesional_id || appointment.profesional_id || "",
      );
      setFechaEditada(fechaInicial);
      setHoraInicioEditada(horaInicioInicial);
      setHoraFinEditada(horaFinInicial);
      setHoraFinManual(false);
      setProfesionalEditadoId(profesionalInicial);
      setHorarioOriginal({
        fecha: fechaInicial,
        hora_inicio: horaInicioInicial,
        hora_fin: horaFinInicial,
        profesional_id: profesionalInicial,
      });

      const notasIniciales = normalizeNote(
        extractAgendaAdditionalNotes(appointment),
      );
      setNotasEditadas(notasIniciales);
      setNotasOriginales(notasIniciales);

      // Extraer productos de la cita
      const serviciosIniciales = normalizarServiciosCita(
        appointment.rawData?.servicios || appointment.servicios || [],
      );
      setServiciosSeleccionados(serviciosIniciales);
      setServiciosOriginales(serviciosIniciales);
    }
  }, [open, appointment]);

  useEffect(() => {
    if (!open || !user?.access_token || !appointment) return;

    const citaId = String(
      appointment.id ||
        appointment.rawData?._id ||
        appointment.rawData?.cita_id ||
        "",
    ).trim();
    if (!citaId) return;

    let isCancelled = false;
    const cargarDetalleCita = async () => {
      const endpoints = [
        `${API_BASE_URL}scheduling/quotes/citas/${citaId}`,
        `${API_BASE_URL}scheduling/quotes/${citaId}`,
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            headers: {
              Authorization: `Bearer ${user.access_token}`,
              Accept: "application/json",
            },
          });

          if (!response.ok) continue;

          const data = await response.json();
          const detalle =
            data?.cita && typeof data.cita === "object" ? data.cita : data;
          if (!detalle || typeof detalle !== "object" || isCancelled) return;

          setAppointmentDetails((prev: any) => ({
            ...prev,
            ...detalle,
            rawData: {
              ...(prev?.rawData || {}),
              ...detalle,
            },
          }));

          const notasDetalle = normalizeNote(
            extractAgendaAdditionalNotes(detalle),
          );
          setNotasEditadas(notasDetalle);
          setNotasOriginales(notasDetalle);

          return;
        } catch {
          // Continuar con el siguiente endpoint de detalle disponible.
        }
      }
    };

    void cargarDetalleCita();
    return () => {
      isCancelled = true;
    };
  }, [open, appointment, user?.access_token]);

  useEffect(() => {
    if (!isCopCurrency && pagoModal.metodoPago === "addi") {
      setPagoModal((prev) => ({ ...prev, metodoPago: "efectivo" }));
    }
  }, [isCopCurrency, pagoModal.metodoPago]);

  useEffect(() => {
    if (!open || !user?.access_token) return;

    let isCancelled = false;
    const cargarServiciosDisponibles = async () => {
      setLoadingServiciosDisponibles(true);
      try {
        const catalogoServicios: ServicioCatalogo[] = await getServicios(
          user.access_token,
        );

        if (isCancelled) return;

        const serviciosMapeados = catalogoServicios
          .filter((servicio) => servicio?.activo !== false)
          .map((servicio) => ({
            servicio_id: String(servicio.servicio_id || servicio._id),
            nombre: String(servicio.nombre || "Servicio"),
            precio: roundMoney(
              servicio.precio_local !== undefined
                ? toNumber(servicio.precio_local)
                : toNumber(servicio.precio),
            ),
            duracion_minutos: Math.max(
              0,
              Math.trunc(
                toNumber(servicio.duracion_minutos ?? servicio.duracion) || 0,
              ),
            ),
          }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre));

        setServiciosDisponibles(serviciosMapeados);
      } catch (error: any) {
        if (isCancelled) return;
        setServiciosDisponibles([]);
        setServiceError(
          extraerMensajeError(
            error,
            "No se pudieron cargar los servicios disponibles.",
          ),
        );
      } finally {
        if (!isCancelled) {
          setLoadingServiciosDisponibles(false);
        }
      }
    };

    cargarServiciosDisponibles();
    return () => {
      isCancelled = true;
    };
  }, [open, user?.access_token]);

  const handleVerPerfil = useCallback(async () => {
    const clienteId =
      appointmentDetails?.rawData?.cliente_id ||
      appointmentDetails?.rawData?.client_id;
    if (!clienteId || !user?.access_token) return;

    // Show panel immediately with data already in the appointment
    const partial: Cliente = {
      id: clienteId,
      nombre:
        appointmentDetails.cliente_nombre ||
        appointmentDetails.rawData?.cliente_nombre ||
        "Cliente",
      telefono: appointmentDetails.rawData?.cliente_telefono || "No disponible",
      email: appointmentDetails.rawData?.cliente_email || "No disponible",
      ticketPromedio: 0,
      ltv: 0,
      diasSinVenir: 0,
      diasSinComprar: 0,
      rizotipo: "",
      nota: "",
      sede_id: "",
      historialCitas: [],
      historialCabello: [],
      historialProductos: [],
    };
    setClientProfile(partial);
    setShowClientProfile(true);
    setLoadingClientProfile(true);

    try {
      // Fetch only the two endpoints we actually need, in parallel
      const headers = {
        Authorization: `Bearer ${user.access_token}`,
        accept: "application/json",
      };
      const [clienteRes, historialRes] = await Promise.all([
        fetch(`${API_BASE_URL}clientes/${clienteId}`, { headers }),
        fetch(`${API_BASE_URL}clientes/${clienteId}/historial`, { headers }),
      ]);

      const clienteData = clienteRes.ok ? await clienteRes.json() : null;
      const historialRaw = historialRes.ok ? await historialRes.json() : [];

      const historialCitas: Cliente["historialCitas"] = Array.isArray(
        historialRaw,
      )
        ? historialRaw.map((c: any) => ({
            fecha: c.fecha || "",
            servicio: c.servicio_nombre || c.servicio || "Servicio",
            profesional: c.profesional_nombre || "",
            estilista: c.profesional_nombre || c.estilista || "",
            valor_total: c.valor_total ?? 0,
            estado: c.estado,
          }))
        : [];

      setClientProfile({
        ...partial,
        nombre: clienteData?.nombre || partial.nombre,
        telefono: clienteData?.telefono || partial.telefono,
        email: clienteData?.correo || clienteData?.email || partial.email,
        ticketPromedio: clienteData?.ticket_promedio ?? 0,
        fecha_creacion: clienteData?.fecha_creacion,
        fecha_registro: clienteData?.fecha_registro,
        historialCitas,
        historialCabello: [],
        historialProductos: [],
      });
    } catch {
      // panel already open with partial data
    } finally {
      setLoadingClientProfile(false);
    }
  }, [appointmentDetails, user?.access_token]);

  const cargarProductosDisponibles = useCallback(
    async (force = false) => {
      if (!open || !user?.access_token) return;
      if (!force && (productosCatalogoCargado || loadingProductosDisponibles))
        return;

      setLoadingProductosDisponibles(true);
      setServiceError(null);
      try {
        const params = new URLSearchParams();
        if (userCurrency) {
          params.append("moneda", userCurrency);
        }
        const query = params.toString();
        const url = `${API_BASE_URL}inventary/product/productos/${query ? `?${query}` : ""}`;

        // Endpoint requerido: GET /inventary/product/productos/
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${user.access_token}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Error ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const productosArray: any[] = Array.isArray(data)
          ? data
          : Array.isArray((data as any)?.productos)
            ? (data as any).productos
            : Array.isArray((data as any)?.items)
              ? (data as any).items
              : [];
        const productosMapeados: ProductoDisponible[] = productosArray
          .map((producto: any) => {
            const productoId = String(
              producto.id ?? producto._id ?? producto.producto_id ?? "",
            ).trim();
            const precio = roundMoney(
              toNumber(
                producto.precio_local ??
                  producto.precio ??
                  producto.precios?.[userCurrency] ??
                  producto.precios?.COP ??
                  0,
              ),
            );
            if (!productoId) return null;

            return {
              producto_id: productoId,
              nombre: String(producto.nombre || "Producto"),
              precio,
              moneda: String(
                producto.moneda_local || userCurrency,
              ).toUpperCase(),
            };
          })
          .filter(
            (
              producto: ProductoDisponible | null,
            ): producto is ProductoDisponible => Boolean(producto),
          )
          .sort((a: ProductoDisponible, b: ProductoDisponible) =>
            a.nombre.localeCompare(b.nombre),
          );

        setProductosDisponibles(productosMapeados);
        setProductosCatalogoCargado(true);
      } catch (error: any) {
        setProductosDisponibles([]);
        setProductosCatalogoCargado(false);
        setServiceError(
          extraerMensajeError(
            error,
            "No se pudieron cargar los productos disponibles.",
          ),
        );
      } finally {
        setLoadingProductosDisponibles(false);
      }
    },
    [
      open,
      user?.access_token,
      userCurrency,
      productosCatalogoCargado,
      loadingProductosDisponibles,
    ],
  );

  useEffect(() => {
    if (!open || !user?.access_token) return;

    let isCancelled = false;
    const cargarProfesionales = async () => {
      setLoadingProfesionales(true);
      try {
        const sedeId = appointmentDetails?.rawData?.sede_id || user?.sede_id;
        const estilistas: Estilista[] = await getEstilistas(
          user.access_token,
          sedeId,
        );
        const profesionales = (Array.isArray(estilistas) ? estilistas : [])
          .map((estilista) => {
            const estilistaRaw = estilista as unknown as Record<
              string,
              unknown
            >;
            const agendaId = String(estilista.profesional_id || "").trim();
            const mongoId = String(estilista._id || "").trim();
            return {
              profesional_id:
                agendaId ||
                `invalid:${mongoId || String(estilista.nombre || "").trim()}`,
              nombre: String(estilista.nombre || "Profesional"),
              hasSchedule: inferirSiTieneHorario(estilistaRaw),
              invalidAgendaId: !agendaId,
            };
          })
          .filter((estilista) => estilista.profesional_id)
          .sort((a, b) => a.nombre.localeCompare(b.nombre));

        if (!isCancelled) {
          setProfesionalesDisponibles(profesionales);
        }
      } catch (error: any) {
        if (!isCancelled) {
          setProfesionalesDisponibles([]);
          setServiceError(
            extraerMensajeError(
              error,
              "No se pudieron cargar los profesionales.",
            ),
          );
        }
      } finally {
        if (!isCancelled) {
          setLoadingProfesionales(false);
        }
      }
    };

    cargarProfesionales();
    return () => {
      isCancelled = true;
    };
  }, [
    open,
    user?.access_token,
    user?.sede_id,
    appointmentDetails?.rawData?.sede_id,
  ]);

  useEffect(() => {
    if (!serviciosDisponibles.length) return;

    setServiciosSeleccionados((prev) =>
      prev.map((servicio) => {
        if (servicio.duracion_minutos > 0 && servicio.precio_base > 0)
          return servicio;
        const servicioCatalogo = serviciosDisponibles.find(
          (item) => item.servicio_id === servicio.servicio_id,
        );
        if (!servicioCatalogo) return servicio;

        return {
          ...servicio,
          duracion_minutos:
            servicio.duracion_minutos > 0
              ? servicio.duracion_minutos
              : servicioCatalogo.duracion_minutos,
          precio_base:
            servicio.precio_base > 0
              ? servicio.precio_base
              : servicioCatalogo.precio,
        };
      }),
    );
  }, [serviciosDisponibles]);

  const estadoCitaActual = String(appointmentDetails?.estado || "")
    .toLowerCase()
    .trim();
  const isEstadoNoEditableServicios =
    ESTADOS_NO_EDITABLES_SERVICIOS.has(estadoCitaActual);

  const totalServicios = roundMoney(
    serviciosSeleccionados.reduce(
      (total, servicio) => total + roundMoney(servicio.subtotal),
      0,
    ),
  );
  const totalProductos = roundMoney(
    productos.reduce(
      (total, producto) => total + toNumber(producto.subtotal),
      0,
    ),
  );
  const totalCitaCalculado = roundMoney(totalServicios + totalProductos);

  const duracionTotalServicios = Math.max(
    0,
    serviciosSeleccionados.reduce(
      (total, servicio) =>
        total +
        Math.max(0, servicio.duracion_minutos || 0) *
          Math.max(1, servicio.cantidad || 1),
      0,
    ),
  );

  const hasUnsavedServiceChanges =
    JSON.stringify(normalizarComparacionServicios(serviciosSeleccionados)) !==
    JSON.stringify(normalizarComparacionServicios(serviciosOriginales));
  const hasUnsavedServiceDurationChanges =
    JSON.stringify(
      normalizarComparacionServiciosHorario(serviciosSeleccionados),
    ) !==
    JSON.stringify(normalizarComparacionServiciosHorario(serviciosOriginales));
  const hasUnsavedProductChanges =
    JSON.stringify(normalizarComparacionProductos(productos)) !==
    JSON.stringify(normalizarComparacionProductos(productosOriginales));
  const hasUnsavedNotes =
    normalizeNote(notasEditadas) !== normalizeNote(notasOriginales);
  const hasUnsavedScheduleChanges =
    fechaEditada !== horarioOriginal.fecha ||
    horaInicioEditada !== horarioOriginal.hora_inicio ||
    horaFinEditada !== horarioOriginal.hora_fin ||
    profesionalEditadoId !== horarioOriginal.profesional_id;
  const hasUnsavedChanges =
    hasUnsavedServiceChanges ||
    hasUnsavedProductChanges ||
    hasUnsavedScheduleChanges ||
    hasUnsavedNotes;
  const tieneOpcionesSinHorario = profesionalesDisponibles.some(
    (profesional) => profesional.hasSchedule === false,
  );
  const tieneOpcionesSinIdAgenda = profesionalesDisponibles.some(
    (profesional) => profesional.invalidAgendaId,
  );

  const isServiceActionsDisabled =
    updating || savingServicios || isEstadoNoEditableServicios;

  useEffect(() => {
    if (!open || !user?.access_token || isServiceActionsDisabled) return;
    void cargarProductosDisponibles();
  }, [
    open,
    user?.access_token,
    isServiceActionsDisabled,
    cargarProductosDisponibles,
  ]);

  const sumarMinutosAHora = (hora: string, minutosAgregar: number) => {
    const [hours, minutes] = String(hora || "00:00")
      .split(":")
      .map((value) => Number(value) || 0);
    const totalMinutos = hours * 60 + minutes + Math.max(0, minutosAgregar);
    const newHours = Math.floor(totalMinutos / 60);
    const newMinutes = totalMinutos % 60;
    return `${String(newHours).padStart(2, "0")}:${String(newMinutes).padStart(2, "0")}`;
  };

  const convertirHoraAMinutos = (hora: string): number => {
    const [hours, minutes] = String(hora || "")
      .split(":")
      .map((value) => Number(value));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return NaN;
    return hours * 60 + minutes;
  };

  const calcularDuracionEntreHoras = (
    horaInicio: string,
    horaFin: string,
  ): number => {
    const inicioMinutos = convertirHoraAMinutos(horaInicio);
    const finMinutos = convertirHoraAMinutos(horaFin);
    if (!Number.isFinite(inicioMinutos) || !Number.isFinite(finMinutos))
      return 0;
    return Math.max(0, finMinutos - inicioMinutos);
  };

  const duracionGuardadaPorHorario = calcularDuracionEntreHoras(
    horarioOriginal.hora_inicio,
    horarioOriginal.hora_fin,
  );
  const duracionProgramadaGuardada =
    duracionGuardadaPorHorario > 0
      ? duracionGuardadaPorHorario
      : Math.max(0, toNumber(appointmentDetails?.rawData?.servicio_duracion));
  const duracionProgramadaActual = calcularDuracionEntreHoras(
    horaInicioEditada,
    horaFinEditada,
  );
  const duracionReferenciaHorario = hasUnsavedServiceDurationChanges
    ? duracionTotalServicios > 0
      ? duracionTotalServicios
      : duracionProgramadaActual > 0
        ? duracionProgramadaActual
        : duracionProgramadaGuardada
    : duracionProgramadaGuardada > 0
      ? duracionProgramadaGuardada
      : duracionTotalServicios > 0
        ? duracionTotalServicios
        : duracionProgramadaActual;

  useEffect(() => {
    if (!horaInicioEditada || horaFinManual) return;
    const duracionParaCalculo = duracionReferenciaHorario;

    if (duracionParaCalculo <= 0) return;

    const horaFinCalculada = sumarMinutosAHora(
      horaInicioEditada,
      duracionParaCalculo,
    );
    if (horaFinCalculada !== horaFinEditada) {
      setHoraFinEditada(horaFinCalculada);
    }
  }, [
    duracionReferenciaHorario,
    horaFinEditada,
    horaFinManual,
    horaInicioEditada,
  ]);

  const getPagosData = () => {
    if (!appointmentDetails?.rawData) {
      return {
        totalCita: 0,
        abonado: 0,
        saldoPendiente: 0,
        estadoPago: "pendiente",
        tieneAbono: false,
        estaPagadoCompleto: false,
        pagos: [],
      };
    }

    const rawData = appointmentDetails.rawData;
    const totalCita = parseFloat(rawData.valor_total) || 0;
    const abonado = parseFloat(rawData.abono) || 0;

    const saldoPendienteFromData = parseFloat(rawData.saldo_pendiente);
    let saldoPendiente = saldoPendienteFromData;

    if (isNaN(saldoPendiente) || saldoPendiente < 0) {
      saldoPendiente = Math.max(0, totalCita - abonado);
    }

    const estaPagadoCompleto = saldoPendiente <= 0;

    let estadoPago = rawData.estado_pago || "pendiente";

    if (estaPagadoCompleto) {
      estadoPago = "pagado";
    } else if (abonado > 0) {
      estadoPago = "abonado";
    } else {
      estadoPago = "pendiente";
    }

    const tieneAbono = abonado > 0;

    const pagos =
      Array.isArray(rawData.historial_pagos) &&
      rawData.historial_pagos.length > 0
        ? rawData.historial_pagos
            .filter((pago: { monto?: number }) => (pago.monto ?? 0) > 0)
            .map(
              (pago: {
                fecha?: string;
                monto?: number;
                metodo?: string;
                tipo?: string;
                registrado_por?: string;
                saldo_despues?: number;
                notas?: string;
                codigo_giftcard?: string;
              }) => ({
                fecha: formatDateDMY(pago.fecha, ""),
                tipo:
                  pago.tipo === "abono_inicial"
                    ? "Abono inicial"
                    : pago.tipo === "pago_adicional"
                      ? "Pago adicional"
                      : pago.tipo === "pago_completo"
                        ? "Pago completo"
                        : pago.tipo || "Pago",
                monto: pago.monto ?? 0,
                metodo: pago.metodo || "",
                registradoPor: pago.registrado_por || "",
                saldoDespues: pago.saldo_despues ?? 0,
                notas: pago.notas || null,
                codigoGiftcard: pago.codigo_giftcard || null,
              }),
            )
        : [];

    return {
      totalCita,
      abonado,
      saldoPendiente,
      estadoPago,
      tieneAbono,
      estaPagadoCompleto,
      pagos,
    };
  };

  const shouldDisableActions = () => {
    const pagosData = getPagosData();

    if (updating || savingServicios) return true;

    if (
      ["cancelada", "no asistio", "no_asistio"].includes(
        appointmentDetails?.estado?.toLowerCase(),
      )
    ) {
      return true;
    }

    if (pagosData?.estaPagadoCompleto) {
      return true;
    }

    if (appointmentDetails?.estado?.toLowerCase() === "completada") {
      return true;
    }

    return false;
  };

  const handleUpdateStatus = async (nuevoEstado: string) => {
    if (!appointmentDetails?.id || !user?.access_token) {
      toast.error("No se puede actualizar: falta información de autenticación");
      return;
    }

    const mensajes: Record<string, string> = {
      cancelada: "La cita se marcará como cancelada.",
      no_asistio: "El cliente no se presentó a la cita.",
      "no asistio": "El cliente no se presentó a la cita.",
    };

    const confirmed = await confirmAction({
      title: "Cambiar estado",
      message: mensajes[nuevoEstado as keyof typeof mensajes] || `¿Cambiar estado a "${nuevoEstado}"?`,
      confirmLabel: "Sí, cambiar",
      variant: nuevoEstado === "cancelada" || nuevoEstado === "no_asistio" || nuevoEstado === "no asistio" ? "danger" : "primary",
    });
    if (!confirmed) return;

    setUpdating(true);
    try {
      await updateQuote(
        appointmentDetails.id,
        { estado: nuevoEstado },
        user.access_token,
      );

      setAppointmentDetails({
        ...appointmentDetails,
        estado: nuevoEstado,
      });

      toast.success(`Estado cambiado a: ${nuevoEstado}`);

      if (onRefresh) {
        setTimeout(() => onRefresh(), 500);
      }
    } catch (error: any) {
      console.error("Error actualizando estado:", error);
      toast.error(extraerMensajeError(error, "No se pudo actualizar el estado"));
    } finally {
      setUpdating(false);
    }
  };

  const handleConfirmarCita = async () => {
    if (!appointmentDetails?.id || !user?.access_token) return;

    setConfirmandoCita(true);
    try {
      const result = await confirmarCita(appointmentDetails.id, user.access_token);

      // Usar el estado que devuelve el backend
      const nuevoEstado = result?.estado || "confirmada";
      setAppointmentDetails((prev: any) => ({
        ...prev,
        estado: nuevoEstado,
        rawData: { ...(prev?.rawData || {}), estado: nuevoEstado },
      }));

      // Reenviar correo de confirmación automáticamente
      try {
        await reenviarCorreoCita(appointmentDetails.id, "confirmacion", user.access_token);
      } catch {
        // No bloquear el flujo si el correo falla
      }

      toast.success("Cita confirmada. Se ha enviado correo de confirmación al cliente.");
      if (onRefresh) setTimeout(() => onRefresh(), 500);
    } catch (error: any) {
      toast.error(extraerMensajeError(error, "No se pudo confirmar la cita"));
    } finally {
      setConfirmandoCita(false);
    }
  };

  const handleGuardarNotas = async () => {
    if (!appointmentDetails?.id || !user?.access_token) {
      toast.error("No se puede actualizar: falta información de autenticación");
      return;
    }

    const notasFinales = normalizeNote(notasEditadas);
    setSavingNotas(true);
    setNotasError(null);

    try {
      await updateQuote(
        appointmentDetails.id,
        { notas: notasFinales },
        user.access_token,
      );

      setNotasOriginales(notasFinales);
      setNotasEditadas(notasFinales);
      setAppointmentDetails((prev: any) => ({
        ...prev,
        notas: notasFinales,
        rawData: {
          ...(prev?.rawData || {}),
          notas: notasFinales,
          notas_adicionales: notasFinales,
        },
      }));

      toast.success("Notas actualizadas correctamente");
      if (onRefresh) {
        setTimeout(() => onRefresh(), 200);
      }
    } catch (error: any) {
      const mensaje = extraerMensajeError(
        error,
        "No se pudieron actualizar las notas.",
      );
      setNotasError(mensaje);
      toast.error(mensaje);
    } finally {
      setSavingNotas(false);
    }
  };

  const handleRegistrarPago = async () => {
    if (!appointmentDetails?.id || !user?.access_token) {
      toast.error("No se puede registrar pago: falta información de autenticación");
      return;
    }

    if (pagoModal.monto <= 0) {
      toast.error("El monto debe ser mayor a 0");
      return;
    }

    const pagosData = getPagosData();

    if (pagoModal.monto > pagosData.saldoPendiente) {
      toast.error(
        `El monto excede el saldo pendiente de $${pagosData.saldoPendiente}`,
      );
      return;
    }

    const metodoPagoSeguro = sanitizeMetodoPago(pagoModal.metodoPago);
    const codigoGiftcard = pagoModal.codigoGiftcard.trim();
    if (metodoPagoSeguro === "giftcard" && !codigoGiftcard) {
      toast.error("Debes ingresar el código de la Gift Card para registrar el pago");
      return;
    }
    const confirmacion = await confirmAction({
      title: "Registrar pago",
      message: `¿Registrar ${pagoModal.tipo === "pago" ? "pago" : "abono"} de $${pagoModal.monto} por ${metodoPagoSeguro}?`,
      confirmLabel: "Sí, registrar",
      variant: "primary",
    });

    if (!confirmacion) return;

    setRegistrandoPago(true);
    try {
      const response = await registrarPagoCita(
        appointmentDetails.id,
        {
          monto: pagoModal.monto,
          metodo_pago: metodoPagoSeguro,
          ...(metodoPagoSeguro === "giftcard" && codigoGiftcard
            ? { codigo_giftcard: codigoGiftcard }
            : {}),
        },
        user.access_token,
      );

      const nuevoSaldoPendiente = response.saldo_pendiente ?? 0;
      const abonoAnterior = parseFloat(
        appointmentDetails?.rawData?.abono ?? "0",
      );
      const tipoPago =
        abonoAnterior === 0
          ? nuevoSaldoPendiente <= 0
            ? "pago_completo"
            : "abono_inicial"
          : "pago_adicional";

      const nuevoPagoLocal = {
        fecha: new Date().toISOString(),
        monto: pagoModal.monto,
        metodo: metodoPagoSeguro,
        tipo: tipoPago,
        registrado_por: user?.email || "",
        saldo_despues: nuevoSaldoPendiente,
        ...(metodoPagoSeguro === "giftcard" && codigoGiftcard
          ? { codigo_giftcard: codigoGiftcard }
          : {}),
      };

      setAppointmentDetails((prev: any) => ({
        ...prev,
        rawData: {
          ...prev.rawData,
          abono: response.abono,
          saldo_pendiente: response.saldo_pendiente,
          estado_pago: response.estado_pago,
          metodo_pago: metodoPagoSeguro,
          ...(metodoPagoSeguro === "giftcard" && codigoGiftcard
            ? { codigo_giftcard: codigoGiftcard }
            : {}),
          historial_pagos: [
            ...(prev.rawData?.historial_pagos || []),
            nuevoPagoLocal,
          ],
        },
      }));

      toast.success(
        `${pagoModal.tipo === "pago" ? "Pago" : "Abono"} registrado exitosamente`,
      );

      setPagoModal({
        show: false,
        tipo: "pago",
        monto: 0,
        metodoPago: "efectivo",
        codigoGiftcard: "",
      });
    } catch (error: any) {
      console.error("Error registrando pago:", error);
      toast.error(extraerMensajeError(error, "No se pudo registrar el pago"));
    } finally {
      setRegistrandoPago(false);
    }
  };

  const handleAgregarServicioById = (servicioId: string) => {
    if (
      serviciosSeleccionados.some((s) => s.servicio_id === servicioId)
    ) {
      setServiceError("El servicio ya está agregado en la cita.");
      return;
    }
    const servicioCatalogo = serviciosDisponibles.find(
      (s) => s.servicio_id === servicioId,
    );
    if (!servicioCatalogo) {
      setServiceError("No se encontró el servicio seleccionado.");
      return;
    }
    const nuevoServicio: ServicioSeleccionado = {
      servicio_id: servicioCatalogo.servicio_id,
      nombre: servicioCatalogo.nombre,
      precio_unitario: servicioCatalogo.precio,
      precio_unitario_input: String(servicioCatalogo.precio),
      precio_base: servicioCatalogo.precio,
      cantidad: 1,
      duracion_minutos: servicioCatalogo.duracion_minutos || 0,
      subtotal: roundMoney(servicioCatalogo.precio),
      precio_personalizado: null,
      usa_precio_personalizado: false,
    };
    setServiciosSeleccionados((prev) => [...prev, nuevoServicio]);
    setSvcSearchQuery("");
    setShowSvcDropdown(false);
    setServiceError(null);
  };

  const handleEliminarServicio = (servicioId: string) => {
    setServiciosSeleccionados((prev) =>
      prev.filter((servicio) => servicio.servicio_id !== servicioId),
    );
    setServiceError(null);
  };

  const handleActualizarCantidad = (
    servicioId: string,
    cantidadInput: string,
  ) => {
    const cantidad = Math.max(1, Math.trunc(toNumber(cantidadInput) || 1));

    setServiciosSeleccionados((prev) =>
      prev.map((servicio) => {
        if (servicio.servicio_id !== servicioId) return servicio;
        const subtotal = roundMoney(servicio.precio_unitario * cantidad);
        return {
          ...servicio,
          cantidad,
          subtotal,
        };
      }),
    );
  };

  const handleActualizarPrecioServicio = (
    servicioId: string,
    precioInput: string,
  ) => {
    const normalizado = precioInput.replace(",", ".").trim();

    setServiciosSeleccionados((prev) =>
      prev.map((servicio) => {
        if (servicio.servicio_id !== servicioId) return servicio;
        if (normalizado === "") {
          return {
            ...servicio,
            precio_unitario_input: "",
            precio_unitario: 0,
            precio_personalizado: null,
            usa_precio_personalizado: false,
            subtotal: roundMoney(0 * servicio.cantidad),
          };
        }

        const precioNumerico = roundMoney(toNumber(normalizado));
        const usaPersonalizado =
          roundMoney(precioNumerico) !== roundMoney(servicio.precio_base);
        return {
          ...servicio,
          precio_unitario_input: normalizado,
          precio_unitario: precioNumerico,
          precio_personalizado: usaPersonalizado ? precioNumerico : null,
          usa_precio_personalizado: usaPersonalizado,
          subtotal: roundMoney(precioNumerico * servicio.cantidad),
        };
      }),
    );
  };

  const handleEliminarProducto = (productoId: string) => {
    setProductos((prev) =>
      prev.filter((producto) => producto.producto_id !== productoId),
    );
  };

  const handleActualizarCantidadProducto = (
    productoId: string,
    cantidadInput: string,
  ) => {
    const cantidad = Math.max(1, Math.trunc(toNumber(cantidadInput) || 1));
    setProductos((prev) =>
      prev.map((producto) => {
        if (producto.producto_id !== productoId) return producto;
        const subtotal = roundMoney(producto.precio_unitario * cantidad);
        const comisionPorcentaje = roundMoney(
          toNumber(producto.comision_porcentaje ?? 0),
        );
        return {
          ...producto,
          cantidad,
          subtotal,
          comision_valor: roundMoney((subtotal * comisionPorcentaje) / 100),
        };
      }),
    );
  };

  const handleActualizarPrecioProducto = (
    productoId: string,
    precioInput: string,
  ) => {
    const precio = Math.max(0, roundMoney(toNumber(precioInput)));
    setProductos((prev) =>
      prev.map((producto) => {
        if (producto.producto_id !== productoId) return producto;
        const precioUnitario = precio > 0 ? precio : producto.precio_unitario;
        const subtotal = roundMoney(precioUnitario * producto.cantidad);
        const comisionPorcentaje = roundMoney(
          toNumber(producto.comision_porcentaje ?? 0),
        );
        return {
          ...producto,
          precio_unitario: precioUnitario,
          subtotal,
          comision_valor: roundMoney((subtotal * comisionPorcentaje) / 100),
        };
      }),
    );
  };

  const handleAgregarProductoById = (productoId: string) => {
    if (productos.some((p) => p.producto_id === productoId)) {
      setServiceError("El producto ya está agregado en la cita.");
      return;
    }
    const productoCatalogo = productosDisponibles.find(
      (p) => p.producto_id === productoId,
    );
    if (!productoCatalogo) {
      setServiceError("No se encontró el producto seleccionado.");
      return;
    }
    const nuevoProducto: ProductoSeleccionado = {
      producto_id: productoCatalogo.producto_id,
      nombre: productoCatalogo.nombre,
      cantidad: 1,
      precio_unitario: productoCatalogo.precio,
      subtotal: roundMoney(productoCatalogo.precio),
      moneda: productoCatalogo.moneda,
      comision_porcentaje: 0,
      comision_valor: 0,
      agregado_por_email: user?.email,
      agregado_por_rol: (user as any)?.rol || user?.role,
      fecha_agregado: new Date().toISOString(),
      profesional_id:
        profesionalEditadoId || appointmentDetails?.rawData?.profesional_id,
    };
    setProductos((prev) => [...prev, nuevoProducto]);
    setProdSearchQuery("");
    setShowProdDropdown(false);
    setServiceError(null);
  };

  const handleGuardarServicios = async () => {
    if (!appointmentDetails?.id || !user?.access_token) {
      toast.error("No se puede guardar: falta información de autenticación");
      return;
    }

    if (isEstadoNoEditableServicios) {
      toast.warning("No se pueden editar servicios en el estado actual de la cita");
      return;
    }

    if (serviciosSeleccionados.length === 0) {
      setServiceError("Debes mantener al menos un servicio en la cita.");
      return;
    }

    if (
      !fechaEditada ||
      !horaInicioEditada ||
      !horaFinEditada ||
      !profesionalEditadoId
    ) {
      setServiceError(
        "Debes completar fecha, hora de inicio, hora de fin y profesional.",
      );
      return;
    }

    const profesionalSeleccionado = profesionalesDisponibles.find(
      (profesional) => profesional.profesional_id === profesionalEditadoId,
    );

    if (
      profesionalSeleccionado?.invalidAgendaId ||
      isMongoObjectIdLike(profesionalEditadoId)
    ) {
      setServiceError(
        "El profesional seleccionado no tiene un ID de agenda válido. Verifica su configuración antes de asignar la cita.",
      );
      return;
    }

    const horaInicioMinutos = convertirHoraAMinutos(horaInicioEditada);
    const horaFinMinutos = convertirHoraAMinutos(horaFinEditada);
    if (
      !Number.isFinite(horaInicioMinutos) ||
      !Number.isFinite(horaFinMinutos) ||
      horaFinMinutos <= horaInicioMinutos
    ) {
      setServiceError("La hora de fin debe ser mayor que la hora de inicio.");
      return;
    }

    const servicioConPrecioInvalido = serviciosSeleccionados.find(
      (servicio) => {
        const valorInput = String(servicio.precio_unitario_input ?? "").trim();
        return valorInput === "" || toNumber(valorInput) <= 0;
      },
    );

    if (servicioConPrecioInvalido) {
      setServiceError(
        `El servicio "${servicioConPrecioInvalido.nombre}" tiene un precio inválido.`,
      );
      return;
    }

    setSavingServicios(true);
    setServiceError(null);

    try {
      const serviciosPayload = serviciosSeleccionados.map((servicio) => ({
        servicio_id: servicio.servicio_id,
        precio: roundMoney(toNumber(servicio.precio_unitario_input)),
        cantidad: servicio.cantidad,
      }));
      const productosPayload = productos.map((producto) => ({
        producto_id: producto.producto_id,
        precio: producto.precio_unitario,
        cantidad: producto.cantidad,
      }));
      const notasFinales = normalizeNote(notasEditadas);

      const response = await updateQuote(
        appointmentDetails.id,
        {
          fecha: fechaEditada,
          hora_inicio: horaInicioEditada,
          hora_fin: horaFinEditada,
          profesional_id: profesionalEditadoId,
          servicios: serviciosPayload,
          productos: productosPayload,
          notas: notasFinales,
        },
        user.access_token,
      );

      const citaActualizada = response?.cita || {};
      const serviciosActualizados = normalizarServiciosCita(
        citaActualizada.servicios || [],
      );
      const productosActualizados = normalizarProductosCita(
        citaActualizada.productos || [],
      );

      setServiciosSeleccionados(serviciosActualizados);
      setServiciosOriginales(serviciosActualizados);
      setProductos(productosActualizados);
      setProductosOriginales(productosActualizados);

      const fechaNueva = String(citaActualizada.fecha || fechaEditada).slice(
        0,
        10,
      );
      const horaInicioNueva =
        normalizeAgendaTimeValue(
          String(citaActualizada.hora_inicio || horaInicioEditada),
        ) || horaInicioEditada;
      const horaFinNueva =
        normalizeAgendaTimeValue(
          String(citaActualizada.hora_fin || horaFinEditada),
        ) || horaFinEditada;
      const profesionalNuevo = String(
        citaActualizada.profesional_id || profesionalEditadoId,
      );
      setFechaEditada(fechaNueva);
      setHoraInicioEditada(horaInicioNueva);
      setHoraFinEditada(horaFinNueva);
      setProfesionalEditadoId(profesionalNuevo);
      setHorarioOriginal({
        fecha: fechaNueva,
        hora_inicio: horaInicioNueva,
        hora_fin: horaFinNueva,
        profesional_id: profesionalNuevo,
      });

      setAppointmentDetails((prev: any) => ({
        ...prev,
        start: citaActualizada.hora_inicio || prev?.start,
        end: citaActualizada.hora_fin || prev?.end,
        servicio_nombre:
          citaActualizada.servicio_nombre || prev?.servicio_nombre,
        estilista_nombre:
          citaActualizada.profesional_nombre || prev?.estilista_nombre,
        profesional_id: citaActualizada.profesional_id || prev?.profesional_id,
        notas: notasFinales,
        rawData: {
          ...prev?.rawData,
          ...citaActualizada,
          servicios:
            citaActualizada.servicios || prev?.rawData?.servicios || [],
          productos:
            citaActualizada.productos || prev?.rawData?.productos || [],
          fecha: citaActualizada.fecha || prev?.rawData?.fecha,
          hora_inicio:
            citaActualizada.hora_inicio || prev?.rawData?.hora_inicio,
          hora_fin: citaActualizada.hora_fin || prev?.rawData?.hora_fin,
          profesional_id:
            citaActualizada.profesional_id || prev?.rawData?.profesional_id,
          profesional_nombre:
            citaActualizada.profesional_nombre ||
            prev?.rawData?.profesional_nombre,
          valor_total:
            citaActualizada.valor_total ?? prev?.rawData?.valor_total,
          saldo_pendiente:
            citaActualizada.saldo_pendiente ?? prev?.rawData?.saldo_pendiente,
          estado_pago:
            citaActualizada.estado_pago ?? prev?.rawData?.estado_pago,
          notas: notasFinales,
          notas_adicionales: notasFinales,
        },
      }));

      setNotasOriginales(notasFinales);
      setNotasEditadas(notasFinales);

      toast.success("Cita actualizada correctamente");
      onClose();
      if (onRefresh) {
        setTimeout(() => onRefresh(), 200);
      }
    } catch (error: any) {
      const { mensaje, sinHorario } = construirMensajeErrorCita(
        error,
        "No se pudieron guardar los cambios de la cita.",
      );

      if (
        sinHorario &&
        profesionalEditadoId !== horarioOriginal.profesional_id
      ) {
        setProfesionalEditadoId(horarioOriginal.profesional_id);
      }

      setServiceError(mensaje);
      toast.error(`Error al guardar cambios: ${mensaje}`);
    } finally {
      setSavingServicios(false);
    }
  };

  const getPrecio = () => {
    if (!appointmentDetails) return "0";

    const precioGuardado =
      appointmentDetails.valor_total ||
      appointmentDetails.rawData?.valor_total ||
      appointmentDetails.precio ||
      "0";

    const precioNumericoGuardado = toNumber(precioGuardado);
    const usarTotalCalculado =
      serviciosSeleccionados.length > 0 || productos.length > 0;
    const total = usarTotalCalculado
      ? totalCitaCalculado
      : precioNumericoGuardado;

    return roundMoney(total).toString();
  };

  const getTotalProductos = () => {
    if (productos.length === 0) return 0;
    return productos.reduce(
      (total, producto) => total + toNumber(producto.subtotal),
      0,
    );
  };

  const getTotalComision = () => {
    if (productos.length === 0) return 0;
    return productos.reduce(
      (total, producto) => total + toNumber(producto.comision_valor),
      0,
    );
  };

  const renderPagoModal = () => {
    if (!pagoModal.show) return null;

    const pagosData = getPagosData();
    const maxMonto = pagosData.saldoPendiente;
    const fmtPago = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");

    const metodos = PAYMENT_METHOD_OPTIONS;

    return (
      <div
        className="rounded-2xl p-5 space-y-4"
        style={{
          border: "1px solid #E2E8F0",
          background: "#fff",
          boxShadow: "0 1px 4px 0 rgba(0,0,0,0.06)",
        }}
      >
        {/* Title */}
        <p className="text-base font-semibold" style={{ color: "#1E293B" }}>
          {pagoModal.tipo === "pago" ? "Agregar Abono" : "Registrar Pago"}
        </p>

        {/* Tipo toggle */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "#64748B" }}>
            Tipo
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                setPagoModal((prev) => ({ ...prev, tipo: "abono", monto: 0 }))
              }
              disabled={registrandoPago}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              style={
                pagoModal.tipo === "abono"
                  ? {
                      background: "#fff",
                      color: "#1E293B",
                      border: "2px solid #1E293B",
                    }
                  : {
                      background: "#fff",
                      color: "#94A3B8",
                      border: "1px solid #E2E8F0",
                    }
              }
            >
              Abono parcial
            </button>
            <button
              type="button"
              onClick={() =>
                setPagoModal((prev) => ({
                  ...prev,
                  tipo: "pago",
                  monto: maxMonto,
                }))
              }
              disabled={registrandoPago}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              style={
                pagoModal.tipo === "pago"
                  ? {
                      background: "#fff",
                      color: "#1E293B",
                      border: "2px solid #1E293B",
                    }
                  : {
                      background: "#fff",
                      color: "#94A3B8",
                      border: "1px solid #E2E8F0",
                    }
              }
            >
              Pago total
            </button>
          </div>
        </div>

        {/* Monto */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "#64748B" }}>
            Monto
          </p>
          <div
            className="flex items-center rounded-xl px-4 py-2.5 gap-1"
            style={{ border: "1px solid #E2E8F0" }}
          >
            <span className="text-sm mr-1" style={{ color: "#94A3B8" }}>
              $
            </span>
            <input
              type="number"
              min="0"
              max={maxMonto}
              step="0.01"
              value={pagoModal.monto || ""}
              onChange={(e) =>
                setPagoModal((prev) => ({
                  ...prev,
                  monto: parseFloat(e.target.value) || 0,
                }))
              }
              className="flex-1 bg-transparent text-sm font-medium focus:outline-none focus:ring-0 border-0 p-0"
              style={{ color: "#1E293B" }}
              placeholder="0"
              disabled={registrandoPago}
            />
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: "#94A3B8" }}>
            Saldo pendiente: {fmtPago(maxMonto)}
          </p>
        </div>

        {/* Método de pago */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "#64748B" }}>
            Método de pago
          </p>
          <div className="flex flex-wrap gap-2">
            {metodos.map(({ id, label }) => {
              const isSelected = sanitizeMetodoPago(pagoModal.metodoPago) === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setPagoModal((prev) => ({ ...prev, metodoPago: id }))
                  }
                  disabled={registrandoPago}
                  className="px-3 py-1.5 rounded-full text-xs transition-colors disabled:opacity-50"
                  style={{
                    background: "#fff",
                    color: isSelected ? "#1E293B" : "#64748B",
                    fontWeight: isSelected ? 600 : 400,
                    border: isSelected
                      ? "2px solid #1E293B"
                      : "1px solid #E2E8F0",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Gift card code */}
        {pagoModal.metodoPago === "giftcard" && (
          <div>
            <p
              className="text-xs font-medium mb-2"
              style={{ color: "#64748B" }}
            >
              Código Gift Card *
            </p>
            <input
              type="text"
              value={pagoModal.codigoGiftcard}
              onChange={(e) =>
                setPagoModal((prev) => ({
                  ...prev,
                  codigoGiftcard: e.target.value,
                }))
              }
              className="w-full rounded-xl px-4 py-2.5 text-sm focus:ring-0 focus:outline-none"
              style={{ border: "1px solid #E2E8F0", color: "#1E293B" }}
              placeholder="Ej: RFC-GCP-1234"
              disabled={registrandoPago}
            />
          </div>
        )}

        {/* Footer actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={() => setPagoModal((prev) => ({ ...prev, show: false }))}
            disabled={registrandoPago}
            className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{
              border: "1px solid #E2E8F0",
              color: "#475569",
              background: "#fff",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleRegistrarPago}
            disabled={
              registrandoPago ||
              pagoModal.monto <= 0 ||
              pagoModal.monto > maxMonto ||
              (pagoModal.metodoPago === "giftcard" &&
                !pagoModal.codigoGiftcard.trim())
            }
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "#1E293B" }}
          >
            {registrandoPago ? (
              <span className="flex items-center justify-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin" />
                Registrando...
              </span>
            ) : (
              "Confirmar"
            )}
          </button>
        </div>
      </div>
    );
  };

  const renderProductos = () => {
    const productosDisponiblesParaAgregar = productosDisponibles.filter(
      (producto) =>
        !productos.some(
          (seleccionado) => seleccionado.producto_id === producto.producto_id,
        ),
    );

    const productosFiltrados = productosDisponiblesParaAgregar.filter((p) =>
      p.nombre.toLowerCase().includes(prodSearchQuery.toLowerCase()),
    );

    return (
      <div className="space-y-3">
        {/* ── Buscador ── */}
        <div
          className="relative"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setTimeout(() => setShowProdDropdown(false), 150);
            }
          }}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={prodSearchQuery}
            onChange={(e) => {
              setProdSearchQuery(e.target.value);
              setShowProdDropdown(true);
            }}
            onFocus={async () => {
              if (!productosCatalogoCargado) await cargarProductosDisponibles();
              setShowProdDropdown(true);
            }}
            disabled={isServiceActionsDisabled}
            placeholder={
              loadingProductosDisponibles
                ? "Cargando productos..."
                : "Buscar y agregar producto..."
            }
            className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:text-slate-400 transition-colors"
          />

          {/* Dropdown de resultados */}
          {showProdDropdown && prodSearchQuery && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto z-20">
              {loadingProductosDisponibles ? (
                <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Cargando...
                </div>
              ) : productosFiltrados.length === 0 ? (
                <div className="py-3 text-center text-sm text-slate-400">
                  Sin resultados
                </div>
              ) : (
                productosFiltrados.map((producto) => (
                  <button
                    key={producto.producto_id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      handleAgregarProductoById(producto.producto_id)
                    }
                    className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 border-b border-slate-100 last:border-0 text-left"
                  >
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-slate-500">
                      {producto.nombre[0].toUpperCase()}
                    </div>
                    <span className="flex-1 text-sm font-medium text-slate-800 truncate">
                      {producto.nombre}
                    </span>
                    <span className="text-sm font-semibold text-slate-500 whitespace-nowrap">
                      ${producto.precio}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Lista de productos ── */}
        {productos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-5 border border-dashed border-slate-200 rounded-xl text-slate-400">
            <Package className="w-6 h-6 mb-1.5 text-slate-300" />
            <p className="text-xs">No hay productos en esta cita</p>
          </div>
        ) : (
          <div className="space-y-2">
            {productos.map((producto) => (
              <div
                key={producto.producto_id}
                className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 rounded-xl"
              >
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {producto.nombre}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs text-slate-400">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      value={producto.precio_unitario}
                      onChange={(e) =>
                        handleActualizarPrecioProducto(
                          producto.producto_id,
                          e.target.value,
                        )
                      }
                      disabled={isServiceActionsDisabled}
                      className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-600 outline-none focus:border-slate-400 disabled:bg-transparent disabled:border-transparent transition-colors"
                      placeholder="0"
                    />
                    <span className="text-xs text-slate-400">c/u</span>
                  </div>
                </div>

                {/* Stepper cantidad */}
                <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden flex-shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      handleActualizarCantidadProducto(
                        producto.producto_id,
                        String(producto.cantidad - 1),
                      )
                    }
                    disabled={
                      isServiceActionsDisabled || producto.cantidad <= 1
                    }
                    className="w-6 h-6 flex items-center justify-center bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 transition-colors"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-7 h-6 flex items-center justify-center text-xs font-semibold border-x border-slate-200 bg-white select-none">
                    {producto.cantidad}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleActualizarCantidadProducto(
                        producto.producto_id,
                        String(producto.cantidad + 1),
                      )
                    }
                    disabled={isServiceActionsDisabled}
                    className="w-6 h-6 flex items-center justify-center bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {/* Subtotal */}
                <p className="text-sm font-bold text-slate-800 whitespace-nowrap min-w-[56px] text-right">
                  ${producto.subtotal}
                </p>

                {/* Eliminar */}
                <button
                  type="button"
                  onClick={() => handleEliminarProducto(producto.producto_id)}
                  disabled={isServiceActionsDisabled}
                  className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-50 transition-colors"
                  aria-label="Eliminar producto"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Resumen ── */}
        <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-xl p-3 text-xs">
          <div className="text-center">
            <div className="text-slate-500 mb-0.5">Total productos</div>
            <div className="font-bold text-slate-800">
              ${roundMoney(totalProductos)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-slate-500 mb-0.5">Comisión total</div>
            <div className="font-bold text-slate-800">
              $
              {roundMoney(
                productos.reduce(
                  (acc, p) => acc + toNumber(p.comision_valor ?? 0),
                  0,
                ),
              )}
            </div>
          </div>
          <div className="text-center">
            <div className="text-slate-500 mb-0.5">Cantidad</div>
            <div className="font-bold text-slate-800">{productos.length}</div>
          </div>
        </div>

      </div>
    );
  };

  const renderServiciosEditor = () => {
    const serviciosDisponiblesParaAgregar = serviciosDisponibles.filter(
      (servicio) =>
        !serviciosSeleccionados.some(
          (seleccionado) => seleccionado.servicio_id === servicio.servicio_id,
        ),
    );

    const serviciosFiltrados = serviciosDisponiblesParaAgregar.filter((s) =>
      s.nombre.toLowerCase().includes(svcSearchQuery.toLowerCase()),
    );

    return (
      <div className="space-y-3">
        {/* ── Alertas ── */}
        {serviceError && (
          <div className="px-3 py-2 border border-red-200 bg-red-50 rounded-xl text-xs text-red-700">
            {serviceError}
          </div>
        )}

        {isEstadoNoEditableServicios && (
          <div className="px-3 py-2 border border-slate-200 bg-slate-50 rounded-xl text-xs text-slate-600">
            Esta cita no permite edición de servicios por su estado actual.
          </div>
        )}

        {/* ── Buscador ── */}
        <div
          className="relative"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setTimeout(() => setShowSvcDropdown(false), 150);
            }
          }}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={svcSearchQuery}
            onChange={(e) => {
              setSvcSearchQuery(e.target.value);
              setShowSvcDropdown(true);
            }}
            onFocus={() => setShowSvcDropdown(true)}
            disabled={isServiceActionsDisabled}
            placeholder={
              loadingServiciosDisponibles
                ? "Cargando servicios..."
                : "Buscar y agregar servicio..."
            }
            className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:text-slate-400 transition-colors"
          />

          {/* Dropdown de resultados */}
          {showSvcDropdown && svcSearchQuery && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto z-20">
              {loadingServiciosDisponibles ? (
                <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Cargando...
                </div>
              ) : serviciosFiltrados.length === 0 ? (
                <div className="py-3 text-center text-sm text-slate-400">
                  Sin resultados
                </div>
              ) : (
                serviciosFiltrados.map((servicio) => (
                  <button
                    key={servicio.servicio_id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      handleAgregarServicioById(servicio.servicio_id)
                    }
                    className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 border-b border-slate-100 last:border-0 text-left"
                  >
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-slate-500">
                      {servicio.nombre[0].toUpperCase()}
                    </div>
                    <span className="flex-1 text-sm font-medium text-slate-800 truncate">
                      {servicio.nombre}
                    </span>
                    <span className="text-sm font-semibold text-slate-500 whitespace-nowrap">
                      ${servicio.precio}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Lista de servicios ── */}
        {serviciosSeleccionados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-5 border border-dashed border-slate-200 rounded-xl text-slate-400">
            <Tag className="w-6 h-6 mb-1.5 text-slate-300" />
            <p className="text-xs">No hay servicios en esta cita</p>
          </div>
        ) : (
          <div className="space-y-2">
            {serviciosSeleccionados.map((servicio) => (
              <div
                key={servicio.servicio_id}
                className="px-3 py-2.5 bg-slate-50 rounded-xl"
              >
                {/* Fila principal: nombre + stepper + subtotal + eliminar */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {servicio.nombre}
                    </p>
                    {servicio.usa_precio_personalizado && (
                      <span className="inline-block text-[9px] px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded-full font-medium mt-0.5">
                        Precio personalizado
                      </span>
                    )}
                  </div>

                  {/* Stepper cantidad */}
                  <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden flex-shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        handleActualizarCantidad(
                          servicio.servicio_id,
                          String(servicio.cantidad - 1),
                        )
                      }
                      disabled={
                        isServiceActionsDisabled || servicio.cantidad <= 1
                      }
                      className="w-6 h-6 flex items-center justify-center bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-7 h-6 flex items-center justify-center text-xs font-semibold border-x border-slate-200 bg-white select-none">
                      {servicio.cantidad}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleActualizarCantidad(
                          servicio.servicio_id,
                          String(servicio.cantidad + 1),
                        )
                      }
                      disabled={isServiceActionsDisabled}
                      className="w-6 h-6 flex items-center justify-center bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Subtotal */}
                  <p className="text-sm font-bold text-slate-800 whitespace-nowrap min-w-[56px] text-right">
                    ${servicio.subtotal}
                  </p>

                  {/* Eliminar */}
                  <button
                    type="button"
                    onClick={() =>
                      handleEliminarServicio(servicio.servicio_id)
                    }
                    disabled={isServiceActionsDisabled}
                    className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-50 transition-colors"
                    aria-label="Eliminar servicio"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Fila secundaria: precio editable */}
                <div className="flex items-center gap-1.5 mt-1.5 pl-0">
                  <span className="text-xs text-slate-400">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    value={servicio.precio_unitario_input}
                    onChange={(e) =>
                      handleActualizarPrecioServicio(
                        servicio.servicio_id,
                        e.target.value,
                      )
                    }
                    disabled={isServiceActionsDisabled}
                    className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-600 outline-none focus:border-slate-400 disabled:bg-transparent disabled:border-transparent transition-colors"
                    placeholder="0"
                  />
                  <span className="text-xs text-slate-400">c/u</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Resumen ── */}
        <div className="grid grid-cols-2 gap-2 bg-slate-50 rounded-xl p-3 text-xs">
          <div className="text-center">
            <div className="text-slate-500 mb-0.5">Total servicios</div>
            <div className="font-bold text-slate-800">${totalServicios}</div>
          </div>
          <div className="text-center">
            <div className="text-slate-500 mb-0.5">Total estimado</div>
            <div className="font-bold text-slate-800">
              ${totalCitaCalculado}
            </div>
          </div>
        </div>

        {/* Indicador de cambios sin guardar */}
        {hasUnsavedServiceChanges &&
          !hasUnsavedProductChanges &&
          !hasUnsavedScheduleChanges && (
            <p className="text-[10px] text-slate-500 text-right">
              Hay cambios sin guardar
            </p>
          )}
      </div>
    );
  };

  if (!appointmentDetails) return null;

  const pagosData = getPagosData();

  return (
    <>
      {(() => {
        // ── render-local helpers ─────────────────────────────────────────────
        const rfStatus = resolveRFStatus(appointmentDetails?.estado || "");
        // Flujo normal de estados (sin cancelada/no_asistio que son terminales)
        const STATUS_STEPS = [
          "pre_reservada",
          "confirmada",
          "in-progress",
          "finalizado",
          "completada",
        ] as const;
        const currentStepIdx = STATUS_STEPS.findIndex((s) => s === rfStatus);
        const fmtM = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
        const ini2 = (name: string) =>
          (name || "")
            .trim()
            .split(" ")
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() ?? "")
            .join("");
        const profActual = profesionalesDisponibles.find(
          (p) => p.profesional_id === profesionalEditadoId,
        );
        const profNombre =
          profActual?.nombre || appointmentDetails.estilista_nombre || "";
        const stepLabel: Record<string, string> = {
          pre_reservada: "Pre-reservada",
          confirmada: "Confirmada",
          "in-progress": "En curso",
          finalizado: "Finalizado",
          completada: "Facturada",
        };
        const stepIcon: Record<string, string> = {
          pre_reservada: "⏳",
          confirmada: "✓",
          "in-progress": "▶",
          finalizado: "◉",
          completada: "✔",
        };
        const isPreReservada = rfStatus === "pre_reservada";

        const innerContent = (
          <div
            className={
              panelMode ? "flex flex-col h-full" : "flex flex-col max-h-[90vh]"
            }
            style={{ background: "#fff" }}
          >
            {/* Client profile panel */}
            {showClientProfile && clientProfile && (
              <div className="flex flex-col h-full overflow-hidden">
                <div
                  className="shrink-0 px-5 pt-5 pb-4"
                  style={{ borderBottom: "1px solid #E2E8F0" }}
                >
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setShowClientProfile(false)}
                      className="flex items-center gap-1.5 text-sm font-semibold hover:opacity-70 transition-opacity"
                      style={{
                        color: "#1E293B",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Perfil del cliente
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                      style={{ color: "#94A3B8" }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
                  {/* Avatar + name */}
                  <div className="flex flex-col items-center text-center gap-2">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white"
                      style={{ background: "#1E293B" }}
                    >
                      {ini2(clientProfile.nombre)}
                    </div>
                    <div>
                      <p
                        className="text-lg font-bold"
                        style={{ color: "#1E293B" }}
                      >
                        {clientProfile.nombre}
                      </p>
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: "#64748B" }}
                      >
                        Cliente desde{" "}
                        {clientProfile.fecha_creacion
                          ? new Date(clientProfile.fecha_creacion).getFullYear()
                          : clientProfile.fecha_registro
                            ? new Date(
                                clientProfile.fecha_registro,
                              ).getFullYear()
                            : "—"}
                      </p>
                    </div>
                  </div>
                  {/* Action buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      {
                        icon: <MessageCircle className="w-4 h-4" />,
                        label: "WhatsApp",
                        href: `https://wa.me/${clientProfile.telefono.replace(/\D/g, "")}`,
                      },
                      {
                        icon: <Mail className="w-4 h-4" />,
                        label: "Email",
                        href: `mailto:${clientProfile.email}`,
                      },
                    ].map(({ icon, label, href }) => (
                      <a
                        key={label}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-1.5 py-3 rounded-xl hover:bg-slate-50 transition-colors"
                        style={{
                          border: "1px solid #E2E8F0",
                          color: "#1E293B",
                          textDecoration: "none",
                        }}
                      >
                        {icon}
                        <span className="text-xs font-medium">{label}</span>
                      </a>
                    ))}
                  </div>
                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        label: "VISITAS",
                        value: loadingClientProfile
                          ? null
                          : String(clientProfile.historialCitas?.length ?? 0),
                      },
                      {
                        label: "TICKET PROMEDIO",
                        value: loadingClientProfile
                          ? null
                          : fmtM(clientProfile.ticketPromedio),
                      },
                      {
                        label: "ÚLTIMA VISITA",
                        value: loadingClientProfile
                          ? null
                          : clientProfile.historialCitas?.[0]?.fecha
                            ? formatDateDMY(
                                clientProfile.historialCitas[0].fecha,
                              )
                            : "—",
                      },
                      {
                        label: "TELÉFONO",
                        value:
                          clientProfile.telefono &&
                          clientProfile.telefono !== "No disponible"
                            ? clientProfile.telefono
                            : "—",
                      },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="p-3 rounded-xl"
                        style={{ background: "#F8FAFC" }}
                      >
                        <p
                          className="text-[9px] font-bold uppercase tracking-wider mb-1"
                          style={{ color: "#94A3B8" }}
                        >
                          {label}
                        </p>
                        {value === null ? (
                          <div
                            className="h-4 w-12 rounded animate-pulse mt-1"
                            style={{ background: "#E2E8F0" }}
                          />
                        ) : (
                          <p
                            className="text-sm font-bold truncate"
                            style={{ color: "#1E293B" }}
                          >
                            {value}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Last service */}
                  {clientProfile.historialCitas &&
                    clientProfile.historialCitas.length > 0 && (
                      <div>
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider mb-2"
                          style={{ color: "#94A3B8" }}
                        >
                          Último servicio
                        </p>
                        <div
                          className="flex items-center gap-3 p-3 rounded-xl"
                          style={{ background: "#F8FAFC" }}
                        >
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                            style={{ background: "#1E293B" }}
                          >
                            {ini2(
                              (clientProfile.historialCitas[0] as any)
                                .estilista || "P",
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className="text-sm font-semibold truncate"
                              style={{ color: "#1E293B" }}
                            >
                              {clientProfile.historialCitas[0].servicio}
                            </p>
                            <p className="text-xs" style={{ color: "#94A3B8" }}>
                              {clientProfile.historialCitas[0].fecha
                                ? formatDateDMY(
                                    clientProfile.historialCitas[0].fecha,
                                  )
                                : "—"}
                              {(clientProfile.historialCitas[0] as any)
                                .estilista
                                ? ` · con ${(clientProfile.historialCitas[0] as any).estilista}`
                                : ""}
                            </p>
                          </div>
                          <p
                            className="text-sm font-bold shrink-0"
                            style={{ color: "#1E293B" }}
                          >
                            {typeof clientProfile.historialCitas[0]
                              .valor_total === "number"
                              ? fmtM(
                                  clientProfile.historialCitas[0]
                                    .valor_total as number,
                                )
                              : clientProfile.historialCitas[0].valor_total ||
                                "—"}
                          </p>
                        </div>
                      </div>
                    )}
                  {/* Contact */}
                  <div>
                    <p
                      className="text-[10px] font-bold uppercase tracking-wider mb-2"
                      style={{ color: "#94A3B8" }}
                    >
                      Contacto
                    </p>
                    <div className="space-y-2">
                      {clientProfile.telefono &&
                        clientProfile.telefono !== "No disponible" && (
                          <div className="flex items-center gap-2">
                            <Phone
                              className="w-3.5 h-3.5 shrink-0"
                              style={{ color: "#94A3B8" }}
                            />
                            <span
                              className="text-sm"
                              style={{ color: "#1E293B" }}
                            >
                              {clientProfile.telefono}
                            </span>
                          </div>
                        )}
                      {clientProfile.email &&
                        clientProfile.email !== "No disponible" && (
                          <div className="flex items-center gap-2">
                            <Mail
                              className="w-3.5 h-3.5 shrink-0"
                              style={{ color: "#94A3B8" }}
                            />
                            <span
                              className="text-sm truncate"
                              style={{ color: "#1E293B" }}
                            >
                              {clientProfile.email}
                            </span>
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Loading overlay */}
            {!showClientProfile && updating && (
              <div className="flex-1 flex flex-col items-center justify-center py-10">
                <Loader2
                  className="w-5 h-5 animate-spin mb-2"
                  style={{ color: "#1E293B" }}
                />
                <p className="text-xs" style={{ color: "#64748B" }}>
                  Actualizando estado...
                </p>
              </div>
            )}

            {!showClientProfile && !updating && (
              <>
                {/* ══ HEADER ══════════════════════════════════════════════════ */}
                <div
                  className="shrink-0 px-5 pt-5 pb-4"
                  style={{ borderBottom: "1px solid #E2E8F0" }}
                >
                  {/* Client + close */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                        style={{ background: "#1E293B" }}
                      >
                        {ini2(appointmentDetails.cliente_nombre || "C")}
                      </div>
                      <div className="min-w-0">
                        <p
                          className="text-base font-semibold leading-tight truncate"
                          style={{ color: "#1E293B" }}
                        >
                          {appointmentDetails.cliente_nombre || "Cliente"}
                        </p>
                        <button
                          type="button"
                          onClick={handleVerPerfil}
                          disabled={loadingClientProfile}
                          className="text-xs mt-0.5 hover:underline transition-opacity disabled:opacity-50 text-left"
                          style={{
                            color: "#64748B",
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                          }}
                        >
                          {loadingClientProfile
                            ? "Cargando..."
                            : "Ver perfil →"}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={onClose}
                      className="shrink-0 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                      style={{ color: "#94A3B8" }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Status stepper – visual display of current appointment progress */}
                  <div className="mb-4">
                    <p
                      className="text-[10px] font-bold uppercase tracking-wider mb-2"
                      style={{ color: "#94A3B8" }}
                    >
                      Estado
                    </p>
                    {/* Badge para estados terminales */}
                    {(rfStatus === "cancelada" || rfStatus === "no_asistio") ? (
                      <div
                        className="flex items-center justify-center py-2 rounded-xl text-sm font-semibold"
                        style={{
                          background: RF_STATUSES[rfStatus].bg,
                          color: RF_STATUSES[rfStatus].color,
                          border: `1px solid ${RF_STATUSES[rfStatus].color}`,
                        }}
                      >
                        {RF_STATUSES[rfStatus].label}
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-1.5">
                        {STATUS_STEPS.map((step, idx) => {
                          const si = RF_STATUSES[step];
                          const isActive = step === rfStatus;
                          const isPast = idx < currentStepIdx;
                          return (
                            <div
                              key={step}
                              className="flex flex-col items-center py-2 rounded-xl text-[10px] font-semibold text-center select-none"
                              style={{
                                border: `${isActive ? 2 : 1}px solid ${isActive || isPast ? si.color : "#E2E8F0"}`,
                                background: isActive || isPast ? si.bg : "transparent",
                                color: isActive || isPast ? si.color : "#CBD5E1",
                                opacity: isActive ? 1 : isPast ? 0.65 : 0.35,
                              }}
                            >
                              <span className="text-sm leading-none mb-0.5">
                                {stepIcon[step]}
                              </span>
                              {stepLabel[step]}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Financial summary card */}
                  <div
                    className="flex items-center justify-between rounded-xl px-4 py-3"
                    style={{ background: "#F8FAFC" }}
                  >
                    <div>
                      <p
                        className="text-[10px] font-medium mb-0.5"
                        style={{ color: "#94A3B8" }}
                      >
                        Total cita
                      </p>
                      <p
                        className="text-lg font-bold"
                        style={{ color: "#1E293B" }}
                      >
                        {fmtM(parseFloat(getPrecio()) || 0)}
                      </p>
                    </div>
                    <div className="text-right">
                      {pagosData.saldoPendiente > 0 ? (
                        <>
                          <p
                            className="text-[10px] font-medium mb-0.5"
                            style={{ color: "#F59E0B" }}
                          >
                            Saldo pendiente
                          </p>
                          <p
                            className="text-base font-bold"
                            style={{ color: "#F59E0B" }}
                          >
                            {fmtM(pagosData.saldoPendiente)}
                          </p>
                        </>
                      ) : (
                        <>
                          <p
                            className="text-[10px] font-medium mb-0.5"
                            style={{ color: "#10B981" }}
                          >
                            Pagado
                          </p>
                          <p
                            className="text-base font-bold"
                            style={{ color: "#10B981" }}
                          >
                            ✓
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* ══ TABS ════════════════════════════════════════════════════ */}
                <div
                  className="shrink-0 flex px-5"
                  style={{
                    borderBottom: "1px solid #E2E8F0",
                    background: "#fff",
                  }}
                >
                  {(["cita", "pagos", "notas"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className="relative px-4 py-3 text-sm border-b-2 -mb-px transition-colors focus:outline-none"
                      style={{
                        borderBottomColor:
                          activeTab === tab ? "#1E293B" : "transparent",
                        color: activeTab === tab ? "#1E293B" : "#94A3B8",
                        fontWeight: activeTab === tab ? 600 : 400,
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      {tab === "cita"
                        ? "Cita"
                        : tab === "pagos"
                          ? "Pagos"
                          : "Notas"}
                      {tab === "pagos" && pagosData.saldoPendiente > 0 && (
                        <span
                          className="absolute rounded-full"
                          style={{
                            width: 6,
                            height: 6,
                            background: "#F59E0B",
                            top: 8,
                            right: 2,
                          }}
                        />
                      )}
                    </button>
                  ))}
                </div>

                {/* ══ TAB CONTENT ═════════════════════════════════════════════ */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                  {/* Debug panel */}
                  {showDebug && (
                    <div className="bg-black text-white p-2 rounded-xl text-[9px] max-h-40 overflow-y-auto">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold flex items-center gap-1">
                          <Bug className="w-2.5 h-2.5" /> Debug
                        </span>
                        <button onClick={() => setShowDebug(false)}>
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      <div>
                        Total: ${pagosData.totalCita} | Abonado: $
                        {pagosData.abonado} | Saldo: ${pagosData.saldoPendiente}
                      </div>
                      <div>
                        Productos: ${getTotalProductos()} | Comisión: $
                        {getTotalComision()}
                      </div>
                    </div>
                  )}

                  {/* ─ TAB: CITA ─────────────────────────────────────────── */}
                  {activeTab === "cita" && (
                    <>
                      {/* Professional card */}
                      <section>
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider mb-2"
                          style={{ color: "#94A3B8" }}
                        >
                          Profesional asignado
                        </p>
                        <div
                          className="flex items-center gap-3 rounded-xl p-3"
                          style={{ background: "#F8FAFC" }}
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                            style={{ background: "#1E293B" }}
                          >
                            {ini2(profNombre || "?")}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className="text-sm font-semibold truncate"
                              style={{ color: "#1E293B" }}
                            >
                              {profNombre || "Sin asignar"}
                            </p>
                          </div>
                          <select
                            value={profesionalEditadoId}
                            onChange={(e) => {
                              setProfesionalEditadoId(e.target.value);
                              setServiceError(null);
                            }}
                            disabled={
                              isServiceActionsDisabled || loadingProfesionales
                            }
                            className="text-[11px] rounded-lg border px-2 py-1.5 focus:ring-0 focus:outline-none disabled:opacity-50"
                            style={{
                              borderColor: "#E2E8F0",
                              color: "#64748B",
                              background: "#fff",
                            }}
                          >
                            <option value="">
                              {loadingProfesionales
                                ? "Cargando..."
                                : "Cambiar..."}
                            </option>
                            {profesionalesDisponibles.map((p) => (
                              <option
                                key={p.profesional_id}
                                value={p.profesional_id}
                                disabled={
                                  p.hasSchedule === false || p.invalidAgendaId
                                }
                              >
                                {p.nombre}
                                {p.invalidAgendaId
                                  ? " (Sin ID)"
                                  : p.hasSchedule === false
                                    ? " (Sin horario)"
                                    : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                        {tieneOpcionesSinHorario && (
                          <p
                            className="text-[10px] mt-1.5"
                            style={{ color: "#F59E0B" }}
                          >
                            Algunos profesionales no tienen horario configurado.
                          </p>
                        )}
                        {tieneOpcionesSinIdAgenda && (
                          <p
                            className="text-[10px] mt-1"
                            style={{ color: "#EF4444" }}
                          >
                            Algunos profesionales requieren configuración de ID
                            agenda.
                          </p>
                        )}
                      </section>

                      {/* Schedule */}
                      <section>
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider mb-2"
                          style={{ color: "#94A3B8" }}
                        >
                          Horario
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div
                            className="rounded-xl p-3"
                            style={{ background: "#F8FAFC" }}
                          >
                            <p
                              className="text-[10px] mb-1.5"
                              style={{ color: "#94A3B8" }}
                            >
                              Fecha
                            </p>
                            <DatePicker
                              value={fechaEditada}
                              onChange={(v) => setFechaEditada(v)}
                              disabled={isServiceActionsDisabled}
                            />
                          </div>
                          <div
                            className="rounded-xl p-3"
                            style={{ background: "#F8FAFC" }}
                          >
                            <p
                              className="text-[10px] mb-1.5"
                              style={{ color: "#94A3B8" }}
                            >
                              Duración
                            </p>
                            <p
                              className="text-sm font-medium"
                              style={{ color: "#1E293B" }}
                            >
                              {duracionProgramadaActual > 0
                                ? duracionProgramadaActual
                                : duracionReferenciaHorario}{" "}
                              min
                            </p>
                          </div>
                          <div
                            className="rounded-xl p-3"
                            style={{ background: "#F8FAFC" }}
                          >
                            <p
                              className="text-[10px] mb-1.5"
                              style={{ color: "#94A3B8" }}
                            >
                              Inicio
                            </p>
                            <TimeInputWithPicker
                              value={horaInicioEditada}
                              onChange={(e) =>
                                setHoraInicioEditada(e.target.value)
                              }
                              disabled={isServiceActionsDisabled}
                              inputClassName="w-full bg-transparent text-sm font-medium focus:ring-0 focus:outline-none disabled:opacity-50 border-0 p-0"
                              buttonClassName="h-4 w-4"
                            />
                          </div>
                          <div
                            className="rounded-xl p-3"
                            style={{ background: "#F8FAFC" }}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <p
                                className="text-[10px]"
                                style={{ color: "#94A3B8" }}
                              >
                                Fin
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!horaInicioEditada) return;
                                  const duracionParaAuto =
                                    duracionReferenciaHorario > 0
                                      ? duracionReferenciaHorario
                                      : 30;
                                  setHoraFinEditada(
                                    sumarMinutosAHora(
                                      horaInicioEditada,
                                      duracionParaAuto,
                                    ),
                                  );
                                  setHoraFinManual(false);
                                }}
                                disabled={
                                  isServiceActionsDisabled || !horaInicioEditada
                                }
                                className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 disabled:opacity-40 transition-colors"
                                style={{
                                  fontSize: 9,
                                  color: "#64748B",
                                  borderColor: "#E2E8F0",
                                  background: "#fff",
                                }}
                              >
                                <Wand2 className="h-2.5 w-2.5" />
                                Auto
                              </button>
                            </div>
                            <TimeInputWithPicker
                              value={horaFinEditada}
                              onChange={(e) => {
                                setHoraFinEditada(e.target.value);
                                setHoraFinManual(true);
                              }}
                              disabled={isServiceActionsDisabled}
                              inputClassName="w-full bg-transparent text-sm font-medium focus:ring-0 focus:outline-none disabled:opacity-50 border-0 p-0"
                              buttonClassName="h-4 w-4"
                            />
                          </div>
                        </div>
                        {serviceError && (
                          <div
                            className="mt-2 rounded-xl p-3 text-xs"
                            style={{
                              background: "#FEF2F2",
                              color: "#EF4444",
                              border: "1px solid #FCA5A5",
                            }}
                          >
                            {serviceError}
                          </div>
                        )}
                      </section>

                      {/* Services editor */}
                      <section>
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider mb-2"
                          style={{ color: "#94A3B8" }}
                        >
                          Servicios{" "}
                          {serviciosSeleccionados.length > 0 &&
                            `(${serviciosSeleccionados.length})`}
                        </p>
                        {renderServiciosEditor()}
                      </section>

                      {/* Products editor */}
                      <section>
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider mb-2"
                          style={{ color: "#94A3B8" }}
                        >
                          Productos{" "}
                          {productos.length > 0 && `(${productos.length})`}
                        </p>
                        {renderProductos()}
                      </section>
                    </>
                  )}

                  {/* ─ TAB: PAGOS ────────────────────────────────────────── */}
                  {activeTab === "pagos" && (
                    <>
                      {/* Summary cards */}
                      <div className="grid grid-cols-3 gap-2">
                        <div
                          className="rounded-xl p-3 text-center"
                          style={{ background: "#F8FAFC" }}
                        >
                          <p
                            className="text-[10px] font-medium mb-0.5"
                            style={{ color: "#94A3B8" }}
                          >
                            Total
                          </p>
                          <p
                            className="text-sm font-bold"
                            style={{ color: "#1E293B" }}
                          >
                            {fmtM(
                              hasUnsavedChanges
                                ? totalCitaCalculado
                                : pagosData.totalCita,
                            )}
                          </p>
                        </div>
                        <div
                          className="rounded-xl p-3 text-center"
                          style={{ background: "#EFF6FF" }}
                        >
                          <p
                            className="text-[10px] font-medium mb-0.5"
                            style={{ color: "#3B82F6", opacity: 0.8 }}
                          >
                            Abonado
                          </p>
                          <p
                            className="text-sm font-bold"
                            style={{ color: "#3B82F6" }}
                          >
                            {fmtM(pagosData.abonado)}
                          </p>
                        </div>
                        <div
                          className="rounded-xl p-3 text-center"
                          style={{
                            background:
                              pagosData.saldoPendiente > 0
                                ? "#FFFBEB"
                                : "#ECFDF5",
                          }}
                        >
                          <p
                            className="text-[10px] font-medium mb-0.5"
                            style={{
                              color:
                                pagosData.saldoPendiente > 0
                                  ? "#F59E0B"
                                  : "#10B981",
                              opacity: 0.8,
                            }}
                          >
                            {pagosData.saldoPendiente > 0 ? "Saldo" : "Pagado"}
                          </p>
                          <p
                            className="text-sm font-bold"
                            style={{
                              color:
                                pagosData.saldoPendiente > 0
                                  ? "#F59E0B"
                                  : "#10B981",
                            }}
                          >
                            {pagosData.estaPagadoCompleto
                              ? "✓"
                              : fmtM(pagosData.saldoPendiente)}
                          </p>
                        </div>
                      </div>

                      {/* Payment action buttons */}
                      {!pagosData.estaPagadoCompleto && (
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              setPagoModal({
                                show: true,
                                tipo: "abono",
                                monto: 0,
                                metodoPago: "efectivo",
                                codigoGiftcard: "",
                              })
                            }
                            disabled={
                              pagosData.estaPagadoCompleto ||
                              registrandoPago ||
                              hasUnsavedChanges
                            }
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50"
                            style={{
                              border: "1px solid #E2E8F0",
                              color: "#475569",
                              background: "#fff",
                            }}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Agregar Abono
                          </button>
                          <button
                            onClick={() =>
                              setPagoModal({
                                show: true,
                                tipo: "pago",
                                monto: pagosData.saldoPendiente,
                                metodoPago: "efectivo",
                                codigoGiftcard: "",
                              })
                            }
                            disabled={
                              pagosData.estaPagadoCompleto ||
                              registrandoPago ||
                              hasUnsavedChanges
                            }
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                            style={{ background: "#1E293B" }}
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            Registrar Pago
                          </button>
                        </div>
                      )}

                      {hasUnsavedChanges && (
                        <div
                          className="rounded-xl p-3 text-xs"
                          style={{
                            background: "#F8FAFC",
                            color: "#64748B",
                            border: "1px solid #E2E8F0",
                          }}
                        >
                          Guarda los cambios pendientes antes de registrar pagos
                          o abonos.
                        </div>
                      )}

                      {/* Inline payment / abono form */}
                      {renderPagoModal()}

                      {/* Payment history */}
                      <section>
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider mb-2"
                          style={{ color: "#94A3B8" }}
                        >
                          Historial de pagos
                        </p>
                        {pagosData.pagos.length > 0 ? (
                          <div className="space-y-2">
                            {pagosData.pagos.map((pago: any, idx: number) => {
                              const esPagoCompleto =
                                pago.tipo === "Pago completo" ||
                                pago.saldoDespues === 0;
                              const iconColor = esPagoCompleto
                                ? "#10B981"
                                : "#3B82F6";
                              const metodoLower = String(
                                pago.metodo || "",
                              ).toLowerCase();
                              const esEfectivo =
                                metodoLower === "efectivo" ||
                                metodoLower === "cash";
                              return (
                                <div
                                  key={idx}
                                  className="rounded-xl p-3"
                                  style={{ background: "#F8FAFC" }}
                                >
                                  <div className="flex items-center gap-3">
                                    <div
                                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                      style={{
                                        background: "#fff",
                                        border: "1px solid #E2E8F0",
                                      }}
                                    >
                                      {esEfectivo ? (
                                        <Wallet
                                          className="w-3.5 h-3.5"
                                          style={{ color: iconColor }}
                                        />
                                      ) : (
                                        <CardIcon
                                          className="w-3.5 h-3.5"
                                          style={{ color: iconColor }}
                                        />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between">
                                        <p
                                          className="text-xs font-semibold"
                                          style={{ color: "#1E293B" }}
                                        >
                                          {pago.tipo}
                                        </p>
                                        <p
                                          className="text-xs font-bold"
                                          style={{ color: "#1E293B" }}
                                        >
                                          {fmtM(pago.monto)}
                                        </p>
                                      </div>
                                      <p
                                        className="text-[10px]"
                                        style={{ color: "#94A3B8" }}
                                      >
                                        {pago.fecha}
                                        {pago.metodo ? ` · ${pago.metodo}` : ""}
                                      </p>
                                    </div>
                                    <CheckCircle
                                      className="w-4 h-4 shrink-0"
                                      style={{ color: iconColor }}
                                    />
                                  </div>
                                  {(pago.registradoPor ||
                                    pago.saldoDespues != null ||
                                    pago.notas ||
                                    pago.codigoGiftcard) && (
                                    <div
                                      className="mt-1.5 pl-11 space-y-0.5"
                                    >
                                      {pago.registradoPor && (
                                        <p
                                          className="text-[10px]"
                                          style={{ color: "#94A3B8" }}
                                        >
                                          Registrado por: {pago.registradoPor}
                                        </p>
                                      )}
                                      {pago.saldoDespues != null && (
                                        <p
                                          className="text-[10px]"
                                          style={{ color: "#94A3B8" }}
                                        >
                                          Saldo después: {fmtM(pago.saldoDespues)}
                                        </p>
                                      )}
                                      {pago.codigoGiftcard && (
                                        <p
                                          className="text-[10px]"
                                          style={{ color: "#94A3B8" }}
                                        >
                                          Gift Card: {pago.codigoGiftcard}
                                        </p>
                                      )}
                                      {pago.notas && (
                                        <p
                                          className="text-[10px] italic"
                                          style={{ color: "#94A3B8" }}
                                        >
                                          {pago.notas}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div
                            className="flex flex-col items-center justify-center py-8 rounded-xl"
                            style={{ background: "#F8FAFC" }}
                          >
                            <Wallet
                              className="w-6 h-6 mb-2"
                              style={{ color: "#CBD5E1" }}
                            />
                            <p className="text-xs" style={{ color: "#94A3B8" }}>
                              No hay pagos registrados
                            </p>
                          </div>
                        )}
                      </section>
                    </>
                  )}

                  {/* ─ TAB: NOTAS ────────────────────────────────────────── */}
                  {activeTab === "notas" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: "#94A3B8" }}
                        >
                          Notas adicionales
                        </p>
                        {hasUnsavedNotes && (
                          <span
                            className="text-[10px] font-medium"
                            style={{ color: "#F59E0B" }}
                          >
                            Cambios sin guardar
                          </span>
                        )}
                      </div>
                      <textarea
                        value={notasEditadas}
                        onChange={(event) =>
                          setNotasEditadas(event.target.value)
                        }
                        rows={6}
                        className="w-full rounded-xl text-sm resize-none focus:outline-none"
                        style={{
                          border: "1px solid #E2E8F0",
                          padding: "12px 14px",
                          color: "#1E293B",
                          lineHeight: 1.6,
                        }}
                        placeholder="Notas de la cita, pagos, detalles del cliente..."
                        disabled={savingNotas || updating}
                      />
                      {notasError && (
                        <div
                          className="rounded-xl p-3 text-xs"
                          style={{
                            background: "#FEF2F2",
                            color: "#EF4444",
                            border: "1px solid #FCA5A5",
                          }}
                        >
                          {notasError}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleGuardarNotas}
                          disabled={
                            savingNotas ||
                            updating ||
                            (!hasUnsavedNotes &&
                              !notasEditadas &&
                              !notasOriginales)
                          }
                          className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                          style={{ background: "#1E293B" }}
                        >
                          {savingNotas ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Save className="w-3 h-3" />
                          )}
                          Guardar notas
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNotasEditadas(notasOriginales);
                            setNotasError(null);
                          }}
                          disabled={
                            savingNotas ||
                            (!hasUnsavedNotes &&
                              notasEditadas === notasOriginales)
                          }
                          className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
                          style={{
                            border: "1px solid #E2E8F0",
                            color: "#475569",
                            background: "#fff",
                          }}
                        >
                          <X className="w-3 h-3" />
                          Restaurar
                        </button>
                      </div>
                      <p className="text-[10px]" style={{ color: "#94A3B8" }}>
                        Visible para el equipo con acceso a la agenda.
                      </p>
                    </div>
                  )}
                </div>

                {/* ══ FOOTER ══════════════════════════════════════════════════ */}
                <div
                  className="shrink-0 px-5 py-4 flex gap-2"
                  style={{ borderTop: "1px solid #E2E8F0", background: "#fff" }}
                >
                  {hasUnsavedChanges ? (
                    /* Save pending edits to schedule / services / products */
                    <button
                      onClick={handleGuardarServicios}
                      disabled={
                        isServiceActionsDisabled ||
                        serviciosSeleccionados.length === 0
                      }
                      className="flex-[2] flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                      style={{ background: "#1E293B" }}
                    >
                      {savingServicios ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />{" "}
                          Guardando...
                        </>
                      ) : (
                        "Guardar cambios"
                      )}
                    </button>
                  ) : isPreReservada ? (
                    /* Botón confirmar cuando estado = pre_reservada */
                    <button
                      onClick={handleConfirmarCita}
                      disabled={confirmandoCita}
                      className="flex-[2] flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                      style={{ background: "#1E293B" }}
                    >
                      {confirmandoCita ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Confirmando...</>
                      ) : (
                        <><CheckCircle className="w-4 h-4" /> Confirmar cita</>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={onClose}
                      className="flex-[2] flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
                      style={{
                        border: "1px solid #E2E8F0",
                        color: "#64748B",
                        background: "#F8FAFC",
                      }}
                    >
                      Cerrar
                    </button>
                  )}

                  {!shouldDisableActions() && (
                    <>
                      <button
                        onClick={() => handleUpdateStatus("no_asistio")}
                        className="flex-1 flex items-center justify-center py-3 rounded-xl text-sm font-semibold"
                        style={{
                          border: "1px solid #FDE68A",
                          color: "#D97706",
                          background: "transparent",
                        }}
                      >
                        No asistió
                      </button>
                      <button
                        onClick={() => handleUpdateStatus("cancelada")}
                        className="flex-1 flex items-center justify-center py-3 rounded-xl text-sm font-semibold"
                        style={{
                          border: "1px solid #FCA5A5",
                          color: "#EF4444",
                          background: "transparent",
                        }}
                      >
                        Cancelar cita
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        );

        return panelMode ? (
          innerContent
        ) : (
          <Modal
            open={open}
            onClose={onClose}
            title=""
            className="w-full max-w-[95vw] lg:max-w-[85vw] xl:max-w-[75vw]"
          >
            {innerContent}
          </Modal>
        );
      })()}
    </>
  );
};

export default AppointmentDetailsModal;
