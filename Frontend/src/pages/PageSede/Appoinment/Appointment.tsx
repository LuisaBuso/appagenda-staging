import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Plus, User, X, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Sidebar } from "../../../components/Layout/Sidebar";
import Bloqueos from "../../../components/Quotes/Bloqueos";
import AppointmentScheduler from "../../../components/Quotes/AppointmentForm";
import Modal from "../../../components/ui/modal";
import { getCitas } from "../../../components/Quotes/citasApi";
import { getSedes, type Sede } from "../../../components/Branch/sedesApi";
import {
  getEstilistas,
  type Estilista,
} from "../../../components/Professionales/estilistasApi";
import AppointmentDetailsModal from "./AppointmentDetailsModal";
import { AgendaDatePicker } from "./AgendaDatePicker";
import { useAuth } from "../../../components/Auth/AuthContext";
import {
  getBloqueosEstilista,
  deleteBloqueo,
  type Bloqueo,
} from "../../../components/Quotes/bloqueosApi";
import { extractAgendaAdditionalNotes } from "../../../lib/agenda";

interface Appointment {
  id: string;
  title: string;
  profesional: string;
  start: string;
  end: string;
  color: string;
  tipo: string;
  duracion: number;
  precio: number;
  cliente_nombre: string;
  servicio_nombre: string;
  estilista_nombre: string;
  estado: string;
  profesional_id?: string;
  cliente_telefono?: string;
  notas_adicionales?: string;
  servicios_resumen?: string;
  servicios_detalle?: string;
  rawData?: any;
}

interface BloqueoCalendario extends Bloqueo {
  _id: string;
}

interface EstilistaCompleto extends Estilista {
  servicios_no_presta: string[];
  especialidades: boolean;
  unique_key: string;
}

const SLOT_INTERVAL_MINUTES = 60;
const START_HOUR = 5;
const END_HOUR = 19;
const TIME_COLUMN_WIDTH = 56;
const APPOINTMENT_VERTICAL_OFFSET = 3;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => {
  const hour = START_HOUR + i;
  return `${hour.toString().padStart(2, "0")}:00`;
});

const COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-amber-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-pink-500",
  "bg-cyan-500",
];

const CELL_HEIGHT = 68;
const CELL_WIDTH = 150;
const MAX_STYLIST_COLUMN_WIDTH = 280;
const MIN_APPOINTMENT_HEIGHT = 44;
const APPOINTMENT_BORDER_WIDTH = 3;
const CITA_TOOLTIP_WIDTH = 300;
const BLOQUEO_TOOLTIP_WIDTH = 320;
const TOOLTIP_MARGIN = 10;

// ── RF design status system ──────────────────────────────────────────────────
const RF_STATUSES = {
  "pre-cita": { color: "#9CA3AF", bg: "#F3F4F6", label: "Pre-cita" },
  confirmed: { color: "#3B82F6", bg: "#EFF6FF", label: "Confirmada" },
  "in-progress": { color: "#8B5CF6", bg: "#F5F3FF", label: "En curso" },
  finalizado: { color: "#F97316", bg: "#FFF7ED", label: "Finalizado" },
  completed: { color: "#10B981", bg: "#ECFDF5", label: "Facturada" },
  cancelled: { color: "#EF4444", bg: "#FEF2F2", label: "Cancelada" },
  "no-asistio": { color: "#CA8A04", bg: "#FEFCE8", label: "No asistió" },
} as const;
type RFStatusKey = keyof typeof RF_STATUSES;

const resolveRFStatus = (estado: string): RFStatusKey => {
  const v = (estado || "").toLowerCase().trim();
  if (v.includes("cancel")) return "cancelled";
  if (v === "no_asistio" || v === "no asistio" || v.includes("no_asistio") || v.includes("no asistio")) return "no-asistio";
  if (["pre-cita", "pre_cita", "precita", "pre_reservada"].some((s) => v.includes(s)))
    return "pre-cita";
  if (
    [
      "en proc",
      "en_proc",
      "proceso",
      "en curso",
      "en_curso",
      "en-curso",
      "progres",
      "in-prog",
    ].some((s) => v.includes(s))
  )
    return "in-progress";
  if (["finaliz"].some((s) => v.includes(s))) return "finalizado";
  if (
    ["complet", "terminad", "realizad", "factur"].some((s) =>
      v.includes(s),
    )
  )
    return "completed";
  return "confirmed";
};

const fmtH = (hour: number): string => {
  const h = Math.floor(hour);
  const m = Math.round((hour % 1) * 60);
  const ap = h >= 12 ? "p.m." : "a.m.";
  const d = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${d}:${m === 0 ? "00" : String(m).padStart(2, "0")} ${ap}`;
};

const shortName = (name: string): string =>
  name.trim().split(" ").filter(Boolean).slice(0, 2).join(" ");

const formatCOP = (amount: number): string =>
  "$" + Math.round(amount).toLocaleString("es-CO");

const hourLabelFromStr = (hourStr: string): string => {
  const h = parseInt(hourStr.split(":")[0], 10);
  const d = h > 12 ? h - 12 : h;
  return `${d}:00`;
};

const getTextValue = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value).trim();
  return "";
};

const getFirstNonEmptyText = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = getTextValue(value);
    if (normalized) return normalized;
  }
  return "";
};

const extractClientName = (cita: any): string => {
  const nestedNombre = getFirstNonEmptyText(
    cita?.cliente?.nombre,
    cita?.cliente?.name,
  );
  const nestedApellido = getFirstNonEmptyText(
    cita?.cliente?.apellido,
    cita?.cliente?.lastName,
  );
  const nestedFullName = [nestedNombre, nestedApellido]
    .filter(Boolean)
    .join(" ")
    .trim();

  return (
    getFirstNonEmptyText(
      cita?.cliente_nombre,
      cita?.clientName,
      cita?.nombre_cliente,
      cita?.clienteName,
      nestedFullName,
      nestedNombre,
    ) || "(Sin nombre)"
  );
};

const extractProfessionalName = (cita: any): string => {
  const nestedName = getFirstNonEmptyText(
    cita?.profesional?.nombre,
    cita?.estilista?.nombre,
  );
  return (
    getFirstNonEmptyText(
      cita?.profesional_nombre,
      cita?.estilista_nombre,
      cita?.professionalName,
      cita?.nombre_profesional,
      nestedName,
    ) || "(Sin profesional)"
  );
};

const extractClientPhone = (cita: any): string => {
  return getFirstNonEmptyText(
    cita?.cliente_telefono,
    cita?.telefono_cliente,
    cita?.cliente?.telefono,
    cita?.cliente?.phone,
    cita?.telefono,
  );
};

const extractServicesInfo = (
  cita: any,
): { detalle: string; resumen: string } => {
  const servicesSet = new Set<string>();

  const directService = getFirstNonEmptyText(
    cita?.servicio_nombre,
    cita?.serviceName,
    cita?.nombre_servicio,
    cita?.tipo_servicio,
  );
  if (directService) servicesSet.add(directService);

  const servicios = Array.isArray(cita?.servicios) ? cita.servicios : [];
  servicios.forEach((servicio: any) => {
    const nombreServicio =
      typeof servicio === "string"
        ? getTextValue(servicio)
        : getFirstNonEmptyText(
            servicio?.nombre,
            servicio?.servicio_nombre,
            servicio?.name,
            servicio?.titulo,
          );
    if (nombreServicio) {
      servicesSet.add(nombreServicio);
    }
  });

  const serviciosList = Array.from(servicesSet);
  if (serviciosList.length === 0) {
    return {
      detalle: "(Sin servicio)",
      resumen: "(Sin servicio)",
    };
  }

  return {
    detalle: serviciosList.join(", "),
    resumen:
      serviciosList.length > 1
        ? `${serviciosList[0]} +${serviciosList.length - 1}`
        : serviciosList[0],
  };
};

const supportsHoverTooltips = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
};

const CalendarScheduler: React.FC = () => {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedSede, setSelectedSede] = useState<Sede | null>(null);
  const [selectedEstilista, setSelectedEstilista] =
    useState<EstilistaCompleto | null>(null);
  const [estilistas, setEstilistas] = useState<EstilistaCompleto[]>([]);
  const [citas, setCitas] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [_, setShowOptions] = useState(false);
  const [showBloqueoModal, setShowBloqueoModal] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{
    estilista: EstilistaCompleto;
    hora: string;
  } | null>(null);
  const [citaTooltip, setCitaTooltip] = useState({
    visible: false,
    x: 0,
    y: 0,
    cita: null as Appointment | null,
  });
  const [bloqueoTooltip, setBloqueoTooltip] = useState({
    visible: false,
    x: 0,
    y: 0,
    bloqueo: null as BloqueoCalendario | null,
    profesional: "",
  });
  // const [hoveredCell, setHoveredCell] = useState<{ estilista: EstilistaCompleto, hora: string } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showAppointmentDetails, setShowAppointmentDetails] = useState(false);
  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);
  const [bloqueos, setBloqueos] = useState<BloqueoCalendario[]>([]);
  const [loadingBloqueos, setLoadingBloqueos] = useState(false);
  const [selectedBloqueo, setSelectedBloqueo] =
    useState<BloqueoCalendario | null>(null);
  const [bloqueoAEliminar, setBloqueoAEliminar] =
    useState<BloqueoCalendario | null>(null);
  const [eliminandoBloqueo, setEliminandoBloqueo] = useState(false);
  const [calendarViewportWidth, setCalendarViewportWidth] = useState(0);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const optionsRef = useRef<HTMLDivElement>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const calendarViewportRef = useRef<HTMLDivElement | null>(null);

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const selectedDateString = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
    const day = selectedDate.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, [selectedDate]);

  const sedeIdActual = useMemo(() => {
    return selectedSede?.sede_id || "";
  }, [selectedSede]);

  const handleCitaClick = useCallback((apt: Appointment) => {
    console.log("Cita clickeada:", apt);
    setSelectedAppointment(apt);
    setShowAppointmentDetails(true);
  }, []);

  const cargarBloqueos = useCallback(async () => {
    if (!user?.access_token || !selectedSede || estilistas.length === 0) return;

    setLoadingBloqueos(true);
    try {
      let todosBloqueos: Bloqueo[] = [];

      console.log("🔍 CARGANDO BLOQUEOS PARA:", {
        sede: selectedSede.nombre,
        estilistasCount: estilistas.length,
        estilistaIds: estilistas.map((e) => e.profesional_id),
      });

      if (estilistas.length > 0) {
        const bloqueosPromises = estilistas.map(async (estilista) => {
          try {
            console.log(
              `📡 Solicitando bloqueos para estilista: ${estilista.nombre} (${estilista.profesional_id})`,
            );
            const bloqueosEstilista = await getBloqueosEstilista(
              estilista.profesional_id,
              user.access_token,
            );
            console.log(
              `✅ Bloqueos recibidos para ${estilista.nombre}:`,
              bloqueosEstilista?.length || 0,
            );
            return Array.isArray(bloqueosEstilista) ? bloqueosEstilista : [];
          } catch (error) {
            console.error(
              `❌ Error cargando bloqueos para ${estilista.nombre}:`,
              error,
            );
            return [];
          }
        });

        const resultados = await Promise.all(bloqueosPromises);
        todosBloqueos = resultados.flat();
      }

      console.log("📊 TOTAL DE BLOQUEOS SIN FILTRAR:", todosBloqueos.length);

      const bloqueosFiltrados = todosBloqueos.filter((bloqueo) => {
        try {
          let fechaBloqueo: string;

          if (bloqueo.fecha.includes("T")) {
            fechaBloqueo = bloqueo.fecha.split("T")[0];
          } else {
            fechaBloqueo = bloqueo.fecha;
          }

          const coincide = fechaBloqueo === selectedDateString;

          if (coincide) {
            console.log("✅ Bloqueo coincide con fecha:", {
              fechaBloqueo,
              selectedDateString,
              estilista: bloqueo.profesional_id,
              horario: `${bloqueo.hora_inicio}-${bloqueo.hora_fin}`,
              motivo: bloqueo.motivo,
            });
          }

          return coincide;
        } catch (error) {
          console.error("Error procesando fecha del bloqueo:", error, bloqueo);
          return false;
        }
      });

      const bloqueosConId: BloqueoCalendario[] = bloqueosFiltrados.filter(
        (bloqueo): bloqueo is BloqueoCalendario =>
          typeof bloqueo._id === "string" && bloqueo._id.trim().length > 0,
      );

      console.log("🔒 BLOQUEOS CARGADOS Y FILTRADOS:", {
        total: todosBloqueos.length,
        filtrados: bloqueosConId.length,
        fecha: selectedDateString,
        sede: selectedSede.nombre,
        detalles: bloqueosConId.map((b) => ({
          id: b._id,
          estilista: b.profesional_id,
          horario: `${b.hora_inicio} - ${b.hora_fin}`,
          motivo: b.motivo,
          fecha: b.fecha,
        })),
      });

      setBloqueos(bloqueosConId);
    } catch (error) {
      console.error("Error general cargando bloqueos:", error);
      setBloqueos([]);
    } finally {
      setLoadingBloqueos(false);
    }
  }, [estilistas, user, selectedDateString, selectedSede]);

  useEffect(() => {
    if (estilistas.length > 0 && selectedSede) {
      cargarBloqueos();
    } else {
      setBloqueos([]);
    }
  }, [cargarBloqueos, estilistas, selectedSede]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        optionsRef.current &&
        !optionsRef.current.contains(event.target as Node)
      ) {
        setShowOptions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    };
  }, []);

  const cargarDatos = useCallback(async () => {
    if (!user?.access_token) return;

    setLoading(true);
    try {
      const [sedesData, citasData] = await Promise.all([
        getSedes(user.access_token),
        getCitas({}, user.access_token),
      ]);

      let citasFiltradas = citasData.citas || citasData || [];

      if (user.sede_id) {
        citasFiltradas = citasFiltradas.filter((cita: any) => {
          return cita.sede_id === user.sede_id;
        });
      }

      setCitas(citasFiltradas);

      if (sedesData.length > 0) {
        const sedeUsuario = sedesData.find(
          (sede) => sede.sede_id === user.sede_id,
        );
        if (sedeUsuario) {
          setSelectedSede(sedeUsuario);
          console.log("✅ Sede del usuario establecida:", sedeUsuario.nombre);
        } else {
          setSelectedSede(sedesData[0]);
        }
      }
    } catch (error) {
      console.error("Error cargando datos:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const cargarEstilistas = useCallback(async () => {
    if (!user?.access_token) {
      setEstilistas([]);
      setSelectedEstilista(null);
      return;
    }

    setLoading(true);
    try {
      const estilistasData = await getEstilistas(user.access_token);

      if (!Array.isArray(estilistasData)) {
        setEstilistas([]);
        return;
      }

      const estilistasFiltrados = (estilistasData || [])
        .filter(Boolean)
        .map(
          (est) =>
            ({
              ...est,
              servicios_no_presta: est.servicios_no_presta || [],
              especialidades: est.especialidades || false,
              unique_key: `stylist-${est.profesional_id}`,
            }) as EstilistaCompleto,
        );

      setEstilistas(estilistasFiltrados);
    } catch (error) {
      console.error("Error cargando estilistas:", error);
      setEstilistas([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const cargarCitas = useCallback(async () => {
    if (!user?.access_token) return;

    setLoading(true);
    try {
      const params: any = { fecha: selectedDateString };

      if (selectedEstilista)
        params.profesional_id = selectedEstilista.profesional_id;

      const response = await getCitas(params, user.access_token);
      const citasFiltradas = response.citas || response || [];

      setCitas(citasFiltradas);
    } catch (error) {
      console.error("Error al cargar citas:", error);
      setCitas([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDateString, selectedEstilista, user]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  useEffect(() => {
    cargarEstilistas();
  }, [cargarEstilistas]);

  useEffect(() => {
    cargarCitas();
  }, [cargarCitas, refreshTrigger]);

  const profesionales = useMemo(() => {
    const result = estilistas.map((est) => ({
      name: est.nombre,
      initials: est.nombre
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .substring(0, 2),
      estilista: est,
    }));

    console.log("👥 PROFESIONALES CALCULADOS:", {
      count: result.length,
      nombres: result.map((p) => p.name),
      ids: result.map((p) => p.estilista.profesional_id),
    });

    return result;
  }, [estilistas]);

  useEffect(() => {
    const element = calendarViewportRef.current;
    if (!element) return;

    const updateWidth = () => {
      setCalendarViewportWidth(element.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [profesionales.length]);

  const effectiveCellWidth = useMemo(() => {
    if (profesionales.length === 0) return CELL_WIDTH;
    const availableWidth = Math.max(
      calendarViewportWidth - TIME_COLUMN_WIDTH,
      0,
    );
    if (availableWidth <= 0) return CELL_WIDTH;
    const expandedWidth = Math.max(
      CELL_WIDTH,
      availableWidth / profesionales.length,
    );
    return Math.min(expandedWidth, MAX_STYLIST_COLUMN_WIDTH);
  }, [calendarViewportWidth, profesionales.length]);

  const getTooltipLeft = useCallback(
    (cursorX: number, tooltipWidth: number) => {
      if (typeof window === "undefined") return cursorX + TOOLTIP_MARGIN;
      const preferredRight = cursorX + TOOLTIP_MARGIN;
      const maxLeft = window.innerWidth - tooltipWidth - TOOLTIP_MARGIN;

      if (preferredRight <= maxLeft) return preferredRight;
      return Math.max(cursorX - tooltipWidth - TOOLTIP_MARGIN, TOOLTIP_MARGIN);
    },
    [],
  );

  const clearHoverTooltips = useCallback(() => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    setCitaTooltip((prev) =>
      prev.visible ? { visible: false, x: 0, y: 0, cita: null } : prev,
    );
    setBloqueoTooltip((prev) =>
      prev.visible
        ? { visible: false, x: 0, y: 0, bloqueo: null, profesional: "" }
        : prev,
    );
  }, []);

  const handleCalendarMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!supportsHoverTooltips()) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const hoveringAgendaModule = Boolean(
        target.closest(
          '[data-hover-source="appointment"], [data-hover-source="bloqueo"]',
        ),
      );
      if (!hoveringAgendaModule) {
        clearHoverTooltips();
      }
    },
    [clearHoverTooltips],
  );

  const handleCalendarMouseLeave = useCallback(() => {
    if (!supportsHoverTooltips()) return;
    clearHoverTooltips();
  }, [clearHoverTooltips]);

  const professionalsTrackWidth = useMemo(
    () => effectiveCellWidth * profesionales.length,
    [effectiveCellWidth, profesionales.length],
  );

  const calendarMinWidth = useMemo(
    () =>
      Math.max(
        TIME_COLUMN_WIDTH + professionalsTrackWidth,
        calendarViewportWidth || 0,
      ),
    [calendarViewportWidth, professionalsTrackWidth],
  );

  const appointmentLayoutByProfessional = useMemo(() => {
    type AppointmentLayoutItem = {
      key: string;
      start: number;
      end: number;
    };
    type AppointmentLayoutInfo = {
      column: number;
      columns: number;
      start: number;
      end: number;
    };

    const groupedByProfessional = new Map<string, AppointmentLayoutItem[]>();
    const normalizedDate = (value: unknown): string => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      if (raw.includes("T")) return raw.split("T")[0];
      if (raw.includes(" ")) return raw.split(" ")[0];
      return raw;
    };

    const parseMinutesFromStart = (timeValue: unknown): number | null => {
      const raw = String(timeValue || "").trim();
      if (!raw) return null;
      const [hours, minutes] = raw.split(":").map(Number);
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
      return (hours - START_HOUR) * 60 + minutes;
    };

    (citas || []).forEach((cita: any) => {
      const fecha = normalizedDate(cita?.fecha);
      if (fecha !== selectedDateString) return;

      const profesionalId = String(cita?.profesional_id || "").trim();
      if (!profesionalId) return;

      const start = parseMinutesFromStart(cita?.hora_inicio);
      const end = parseMinutesFromStart(cita?.hora_fin);
      if (start === null || end === null || end <= start) return;

      const citaId = String(cita?._id || "").trim();
      if (!citaId) return;

      const key = `${citaId}-${cita.hora_inicio}-${cita.hora_fin}-${profesionalId}`;
      const list = groupedByProfessional.get(profesionalId) || [];
      list.push({ key, start, end });
      groupedByProfessional.set(profesionalId, list);
    });

    const layoutByProfessional = new Map<
      string,
      Map<string, AppointmentLayoutInfo>
    >();

    groupedByProfessional.forEach((items, profesionalId) => {
      const sortedItems = [...items].sort(
        (a, b) =>
          a.start - b.start || a.end - b.end || a.key.localeCompare(b.key),
      );

      const layoutMap = new Map<string, AppointmentLayoutInfo>();
      let group: AppointmentLayoutItem[] = [];
      let groupEnd = -Infinity;

      const commitGroup = () => {
        if (group.length === 0) return;

        const columnsEnd: number[] = [];
        const assignedColumns = new Map<string, number>();

        group.forEach((item) => {
          let columnIndex = columnsEnd.findIndex(
            (columnEnd) => columnEnd <= item.start,
          );
          if (columnIndex === -1) {
            columnIndex = columnsEnd.length;
            columnsEnd.push(item.end);
          } else {
            columnsEnd[columnIndex] = item.end;
          }

          assignedColumns.set(item.key, columnIndex);
        });

        const totalColumns = Math.max(columnsEnd.length, 1);
        group.forEach((item) => {
          layoutMap.set(item.key, {
            column: assignedColumns.get(item.key) ?? 0,
            columns: totalColumns,
            start: item.start,
            end: item.end,
          });
        });
      };

      sortedItems.forEach((item) => {
        if (group.length === 0) {
          group = [item];
          groupEnd = item.end;
          return;
        }

        if (item.start < groupEnd) {
          group.push(item);
          groupEnd = Math.max(groupEnd, item.end);
          return;
        }

        commitGroup();
        group = [item];
        groupEnd = item.end;
      });

      commitGroup();
      layoutByProfessional.set(profesionalId, layoutMap);
    });

    return layoutByProfessional;
  }, [citas, selectedDateString]);

  const getAppointmentPosition = useCallback(
    (apt: Appointment) => {
      console.log(
        `\n📐 CALCULANDO POSICIÓN PARA: ${apt.cliente_nombre} (${apt.profesional})`,
      );

      const citaProfesionalId =
        apt.profesional_id || apt.rawData?.profesional_id;
      const profIndex = profesionales.findIndex((p) => {
        const estilistaId = p.estilista.profesional_id;
        return citaProfesionalId === estilistaId;
      });

      if (profIndex === -1) {
        console.log(`❌ PROFESIONAL NO ENCONTRADO PARA: ${apt.cliente_nombre}`);
        console.log(
          `ID en cita: ${apt.profesional_id || apt.rawData?.profesional_id}`,
        );
        console.log(
          `📋 ESTILISTAS DISPONIBLES:`,
          profesionales.map((p) => ({
            id: p.estilista.profesional_id,
            nombre: p.name,
          })),
        );
        return null;
      }

      console.log(`✅ ENCONTRADO: ${apt.profesional} en índice ${profIndex}`);

      const [startHour, startMin] = apt.start.split(":").map(Number);
      const [endHour, endMin] = apt.end.split(":").map(Number);

      const startMinutesFrom5AM = (startHour - START_HOUR) * 60 + startMin;
      const endMinutesFrom5AM = (endHour - START_HOUR) * 60 + endMin;

      const startBlock = startMinutesFrom5AM / SLOT_INTERVAL_MINUTES;
      const endBlock = endMinutesFrom5AM / SLOT_INTERVAL_MINUTES;
      const totalBlocks = endBlock - startBlock;

      const tieneBloqueoSolapado = bloqueos.some((bloqueo) => {
        if (bloqueo.profesional_id !== citaProfesionalId) return false;

        const [bloqueoStartHour, bloqueoStartMin] = bloqueo.hora_inicio
          .split(":")
          .map(Number);
        const [bloqueoEndHour, bloqueoEndMin] = bloqueo.hora_fin
          .split(":")
          .map(Number);
        if (
          [
            bloqueoStartHour,
            bloqueoStartMin,
            bloqueoEndHour,
            bloqueoEndMin,
          ].some(Number.isNaN)
        )
          return false;

        const bloqueoInicio =
          (bloqueoStartHour - START_HOUR) * 60 + bloqueoStartMin;
        const bloqueoFin = (bloqueoEndHour - START_HOUR) * 60 + bloqueoEndMin;

        return (
          startMinutesFrom5AM < bloqueoFin && endMinutesFrom5AM > bloqueoInicio
        );
      });

      const eventHeight = Math.max(
        totalBlocks * CELL_HEIGHT - 4,
        MIN_APPOINTMENT_HEIGHT,
      );

      const aptKey = `${apt.id}-${apt.start}-${apt.end}-${citaProfesionalId}`;
      const layoutInfo = appointmentLayoutByProfessional
        .get(citaProfesionalId)
        ?.get(aptKey);
      const appointmentColumnIndex = layoutInfo?.column ?? 0;
      const appointmentColumns = Math.max(layoutInfo?.columns ?? 1, 1);

      const baseLeft = profIndex * effectiveCellWidth;
      const topPosition =
        startBlock * CELL_HEIGHT + APPOINTMENT_VERTICAL_OFFSET;
      const anchoTotalCelda = effectiveCellWidth - APPOINTMENT_BORDER_WIDTH;
      const totalColumns = appointmentColumns + (tieneBloqueoSolapado ? 1 : 0);
      const anchoCita = Math.max(anchoTotalCelda / totalColumns, 24);
      const leftPosition = baseLeft + appointmentColumnIndex * anchoCita;

      const position = {
        left: leftPosition,
        top: topPosition,
        height: eventHeight,
        width: anchoCita,
      };

      console.log(`✅ POSICIÓN CALCULADA:`, {
        profesional: apt.profesional,
        index: profIndex,
        start: apt.start,
        end: apt.end,
        startBlock,
        endBlock,
        totalBlocks,
        minHeight: eventHeight,
        leftPosition,
        topPosition,
        tieneBloqueoSolapado,
        appointmentColumnIndex,
        appointmentColumns,
        columnaHoras: 64,
        cellWidth: effectiveCellWidth,
      });

      return position;
    },
    [
      profesionales,
      bloqueos,
      appointmentLayoutByProfessional,
      effectiveCellWidth,
    ],
  );

  const appointments = useMemo(() => {
    console.log("🔍 PROCESANDO CITAS CON DATOS COMPLETOS DEL BACKEND");

    if (!citas.length) {
      console.log("❌ No hay citas para procesar");
      return [];
    }

    const citasFiltradas = citas.filter((cita) => {
      return cita.fecha === selectedDateString;
    });

    console.log("📋 CITAS FILTRADAS PARA FECHA:", citasFiltradas.length);
    console.log(
      "📊 DETALLE DE CITAS:",
      citasFiltradas.map((cita) => ({
        id: cita._id,
        cliente: cita.cliente_nombre,
        servicio: cita.servicio_nombre,
        estilista: cita.profesional_nombre,
        estilista_id: cita.profesional_id,
        sede_id: cita.sede_id,
        horario: `${cita.hora_inicio} - ${cita.hora_fin}`,
        rawData: cita,
      })),
    );

    const appointmentsResult = citasFiltradas.map((cita, index) => {
      const clienteNombre = extractClientName(cita);
      const profesionalNombre = extractProfessionalName(cita);
      const servicesInfo = extractServicesInfo(cita);
      const estado =
        getFirstNonEmptyText(cita?.estado, cita?.status, cita?.estado_cita) ||
        "pendiente";

      console.log(`📝 CITA ${index + 1}:`, {
        cliente: clienteNombre,
        servicio: servicesInfo.detalle,
        estilista: profesionalNombre,
        estilista_id: cita.profesional_id,
        sede_id: cita.sede_id,
        horario: `${cita.hora_inicio} - ${cita.hora_fin}`,
        rawData: cita,
      });

      const estilistaIndex = estilistas.findIndex(
        (e) => e.profesional_id === cita.profesional_id,
      );

      console.log(`🎯 BUSCANDO ESTILISTA ID: ${cita.profesional_id}`);
      console.log(`✅ ÍNDICE ENCONTRADO: ${estilistaIndex}`);

      const colorIndex =
        estilistaIndex >= 0
          ? estilistaIndex % COLORS.length
          : index % COLORS.length;
      const colorClass = COLORS[colorIndex];

      const parseTime = (time: string) => {
        const [hours, minutes] = time.split(":").map(Number);
        return (hours - START_HOUR) * 60 + minutes;
      };

      const startMinutes = parseTime(cita.hora_inicio);
      const endMinutes = parseTime(cita.hora_fin);
      const duracion = Math.max(0, endMinutes - startMinutes);

      const appointment = {
        id: cita._id,
        title: clienteNombre,
        profesional: profesionalNombre,
        start: cita.hora_inicio,
        end: cita.hora_fin,
        color: colorClass,
        tipo: servicesInfo.resumen,
        duracion: duracion,
        precio: 0,
        cliente_nombre: clienteNombre,
        servicio_nombre: servicesInfo.detalle,
        servicios_resumen: servicesInfo.resumen,
        servicios_detalle: servicesInfo.detalle,
        estilista_nombre: profesionalNombre,
        cliente_telefono: extractClientPhone(cita),
        estado,
        profesional_id: cita.profesional_id,
        notas_adicionales: extractAgendaAdditionalNotes(cita),
        rawData: cita,
      };

      return appointment;
    });

    console.log("✅ APPOINTMENTS PROCESADOS:", appointmentsResult.length);

    return appointmentsResult;
  }, [citas, selectedDateString, estilistas]);

  // ── RF summary stats for the summary bar ─────────────────────────────────
  const rfActiveApts = useMemo(
    () => appointments.filter((a) => resolveRFStatus(a.estado) !== "cancelled"),
    [appointments],
  );
  const rfSummary = useMemo(
    () => ({
      pre: rfActiveApts.filter((a) => resolveRFStatus(a.estado) === "pre-cita")
        .length,
      confirmed: rfActiveApts.filter(
        (a) => resolveRFStatus(a.estado) === "confirmed",
      ).length,
      inProgress: rfActiveApts.filter(
        (a) => resolveRFStatus(a.estado) === "in-progress",
      ).length,
      finalizado: rfActiveApts.filter(
        (a) => resolveRFStatus(a.estado) === "finalizado",
      ).length,
      total: appointments.reduce(
        (s, a) => s + (parseFloat(a.rawData?.valor_total || "0") || 0),
        0,
      ),
    }),
    [rfActiveApts, appointments],
  );

  const getBloqueoPosition = useCallback(
    (bloqueo: BloqueoCalendario) => {
      const profIndex = profesionales.findIndex(
        (profesional) =>
          profesional.estilista.profesional_id === bloqueo.profesional_id,
      );

      if (profIndex === -1) return null;

      const [startHour, startMin] = bloqueo.hora_inicio.split(":").map(Number);
      const [endHour, endMin] = bloqueo.hora_fin.split(":").map(Number);
      if ([startHour, startMin, endHour, endMin].some(Number.isNaN))
        return null;

      const startMinutesFrom5AM = (startHour - START_HOUR) * 60 + startMin;
      const endMinutesFrom5AM = (endHour - START_HOUR) * 60 + endMin;
      const startBlock = startMinutesFrom5AM / SLOT_INTERVAL_MINUTES;
      const endBlock = endMinutesFrom5AM / SLOT_INTERVAL_MINUTES;
      const totalBlocks = Math.max(endBlock - startBlock, 1);

      const layoutMap = appointmentLayoutByProfessional.get(
        bloqueo.profesional_id,
      );
      let maxAppointmentColumns = 0;
      if (layoutMap) {
        layoutMap.forEach((layoutInfo) => {
          const overlaps =
            startMinutesFrom5AM < layoutInfo.end &&
            endMinutesFrom5AM > layoutInfo.start;
          if (overlaps) {
            maxAppointmentColumns = Math.max(
              maxAppointmentColumns,
              layoutInfo.columns,
            );
          }
        });
      }

      const anchoTotalCelda = effectiveCellWidth - APPOINTMENT_BORDER_WIDTH;
      const totalColumns =
        maxAppointmentColumns > 0 ? maxAppointmentColumns + 1 : 1;
      const anchoBloqueo = Math.max(anchoTotalCelda / totalColumns, 24);
      const leftBase = profIndex * effectiveCellWidth;
      const leftPosition =
        maxAppointmentColumns > 0
          ? leftBase + anchoTotalCelda - anchoBloqueo
          : leftBase;

      return {
        left: leftPosition,
        top: startBlock * CELL_HEIGHT + APPOINTMENT_VERTICAL_OFFSET,
        height: Math.max(totalBlocks * CELL_HEIGHT - 4, 40),
        width: anchoBloqueo,
      };
    },
    [profesionales, appointmentLayoutByProfessional, effectiveCellWidth],
  );

  const handleClose = useCallback(() => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    setShowAppointmentModal(false);
    setShowBloqueoModal(false);
    setSelectedCell(null);
    setSelectedBloqueo(null);
    setShowOptions(false);
    setCitaTooltip({ visible: false, x: 0, y: 0, cita: null });
    setBloqueoTooltip({
      visible: false,
      x: 0,
      y: 0,
      bloqueo: null,
      profesional: "",
    });
  }, []);

  const handleCitaCreada = useCallback(() => {
    console.log("🔄 Recargando citas después de crear nueva cita...");
    cargarCitas();
    cargarEstilistas();
    setRefreshTrigger((prev) => prev + 1);
    handleClose();
  }, [cargarCitas, cargarEstilistas, handleClose]);

  const handleBloqueoCreado = useCallback(() => {
    cargarCitas();
    cargarEstilistas();
    cargarBloqueos();
    setRefreshTrigger((prev) => prev + 1);
    handleClose();
  }, [cargarCitas, cargarEstilistas, cargarBloqueos, handleClose]);

  const handleConfirmarEliminarBloqueo = useCallback(async () => {
    if (!bloqueoAEliminar || !user?.access_token) return;
    setEliminandoBloqueo(true);
    try {
      await deleteBloqueo(bloqueoAEliminar._id, user.access_token);
      setBloqueoAEliminar(null);
      cargarBloqueos();
    } catch (error) {
      console.error("Error eliminando bloqueo:", error);
    } finally {
      setEliminandoBloqueo(false);
    }
  }, [bloqueoAEliminar, user, cargarBloqueos]);

  const overlapsSlot = useCallback(
    (startMinutes: number, endMinutes: number, slotStartMinutes: number) => {
      const slotEndMinutes = slotStartMinutes + SLOT_INTERVAL_MINUTES;
      return startMinutes < slotEndMinutes && endMinutes > slotStartMinutes;
    },
    [],
  );

  const getBloqueosEnSlot = useCallback(
    (profesionalId: string, hora: string): BloqueoCalendario[] => {
      const [blockHour, blockMin] = hora.split(":").map(Number);
      if (Number.isNaN(blockHour) || Number.isNaN(blockMin)) return [];

      const blockMinutesFrom5AM = (blockHour - START_HOUR) * 60 + blockMin;

      return bloqueos.filter((bloqueo) => {
        if (bloqueo.profesional_id !== profesionalId) return false;

        const [startHour, startMin] = bloqueo.hora_inicio
          .split(":")
          .map(Number);
        const [endHour, endMin] = bloqueo.hora_fin.split(":").map(Number);

        if ([startHour, startMin, endHour, endMin].some(Number.isNaN))
          return false;

        const startMinutesFrom5AM = (startHour - START_HOUR) * 60 + startMin;
        const endMinutesFrom5AM = (endHour - START_HOUR) * 60 + endMin;

        return overlapsSlot(
          startMinutesFrom5AM,
          endMinutesFrom5AM,
          blockMinutesFrom5AM,
        );
      });
    },
    [bloqueos, overlapsSlot],
  );

  const getCitaEnSlot = useCallback(
    (profesionalId: string, hora: string): Appointment | null => {
      const [blockHour, blockMin] = hora.split(":").map(Number);
      if (Number.isNaN(blockHour) || Number.isNaN(blockMin)) return null;

      const blockMinutesFrom5AM = (blockHour - START_HOUR) * 60 + blockMin;

      return (
        appointments.find((apt) => {
          const aptProfesionalId =
            apt.profesional_id || apt.rawData?.profesional_id;
          if (aptProfesionalId !== profesionalId) return false;

          const [startHour, startMin] = apt.start.split(":").map(Number);
          const [endHour, endMin] = apt.end.split(":").map(Number);
          if ([startHour, startMin, endHour, endMin].some(Number.isNaN))
            return false;

          const startMinutesFrom5AM = (startHour - START_HOUR) * 60 + startMin;
          const endMinutesFrom5AM = (endHour - START_HOUR) * 60 + endMin;

          return overlapsSlot(
            startMinutesFrom5AM,
            endMinutesFrom5AM,
            blockMinutesFrom5AM,
          );
        }) || null
      );
    },
    [appointments, overlapsSlot],
  );

  // const handleCellHover = useCallback((estilista: EstilistaCompleto, hora: string) => {
  //   setHoveredCell({ estilista, hora });
  // }, []);

  // const handleCellHoverLeave = useCallback(() => {
  //   setHoveredCell(null);
  // }, []);

  const openAppointmentModal = useCallback(
    (estilista: EstilistaCompleto, hora: string) => {
      setSelectedCell({ estilista, hora });
      setShowAppointmentModal(true);
      setShowOptions(false);
    },
    [],
  );

  const openBloqueoModal = useCallback(
    (
      estilista: EstilistaCompleto,
      hora: string,
      bloqueo: BloqueoCalendario | null = null,
    ) => {
      setSelectedCell({ estilista, hora });
      setSelectedBloqueo(bloqueo);
      setShowBloqueoModal(true);
      setShowOptions(false);
    },
    [],
  );

  const CalendarCell = React.memo(
    ({ prof, hour }: { prof: any; hour: string }) => {
      const [showButtons, setShowButtons] = useState(false);
      const cellRef = useRef<HTMLDivElement>(null);
      const timeoutRef = useRef<NodeJS.Timeout | null>(null);
      const profesionalId = prof.estilista.profesional_id;

      const citaEnSlot = useMemo(
        () => getCitaEnSlot(profesionalId, hour),
        [getCitaEnSlot, profesionalId, hour],
      );
      const bloqueosEnSlot = useMemo(
        () => getBloqueosEnSlot(profesionalId, hour),
        [getBloqueosEnSlot, profesionalId, hour],
      );
      const tieneCitaEnEstaHora = Boolean(citaEnSlot);
      const tieneBloqueoEnEstaHora = bloqueosEnSlot.length > 0;
      const userEmail = user?.email?.toLowerCase().trim() || "";
      const userId = user?.id?.toLowerCase().trim() || "";
      const bloqueoEditable = useMemo(() => {
        if (!bloqueosEnSlot.length) return null;
        if (user?.role === "super_admin") return bloqueosEnSlot[0];

        const editablePorAutor = bloqueosEnSlot.find((bloqueo) => {
          const creadoPor = (bloqueo.creado_por || "").toLowerCase().trim();
          if (!creadoPor) return false;
          return creadoPor === userEmail || creadoPor === userId;
        });

        if (editablePorAutor) return editablePorAutor;

        // Compatibilidad con bloqueos antiguos sin trazabilidad de autor.
        const hayInfoDeAutor = bloqueosEnSlot.some((bloqueo) =>
          Boolean((bloqueo.creado_por || "").trim()),
        );
        return hayInfoDeAutor ? null : bloqueosEnSlot[0];
      }, [bloqueosEnSlot, user?.role, userEmail, userId]);

      // Limpiar timeout cuando el componente se desmonta
      useEffect(() => {
        return () => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
      }, []);

      const handleCellClick = useCallback(
        (e: React.MouseEvent) => {
          e.stopPropagation();

          if (tieneCitaEnEstaHora && citaEnSlot) {
            handleCitaClick(citaEnSlot);
            setShowButtons(false);
            return;
          }

          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setShowButtons(true);
        },
        [tieneCitaEnEstaHora, citaEnSlot, handleCitaClick],
      );

      const handleReservarClick = useCallback(
        (e: React.MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          console.log("CLICK reservar");
          openAppointmentModal(prof.estilista, hour);
          setShowButtons(false);
        },
        [prof.estilista, hour, openAppointmentModal],
      );

      const handleBloquearClick = useCallback(
        (e: React.MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          openBloqueoModal(prof.estilista, hour);
          setShowButtons(false);
        },
        [prof.estilista, hour, openBloqueoModal],
      );

      const handleEditarBloqueoClick = useCallback(
        (e: React.MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          if (!bloqueoEditable) return;
          openBloqueoModal(prof.estilista, hour, bloqueoEditable);
          setShowButtons(false);
        },
        [bloqueoEditable, prof.estilista, hour, openBloqueoModal],
      );

      // Ocultar botones después de tiempo
      useEffect(() => {
        if (showButtons) {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            setShowButtons(false);
          }, 2000);
        }

        return () => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
      }, [showButtons]);

      const handleMouseEnter = useCallback(() => {
        // Limpiar timeout de ocultar
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        // Mantener visible el detalle del bloqueo en hover; controles solo en celdas libres
        if (!tieneCitaEnEstaHora && !tieneBloqueoEnEstaHora) {
          setShowButtons(true);
        }
      }, [tieneCitaEnEstaHora, tieneBloqueoEnEstaHora]);

      const handleMouseLeave = useCallback(() => {
        // Ocultar inmediatamente cuando el mouse sale
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setShowButtons(false);
      }, []);

      const handleButtonContainerMouseEnter = useCallback(() => {
        // Cancelar timeout cuando el mouse está sobre los botones
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }, []);

      const handleButtonContainerMouseLeave = useCallback(() => {
        // Ocultar botones cuando el mouse sale de ellos
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setShowButtons(false);
      }, []);

      return (
        <div
          ref={cellRef}
          onClick={handleCellClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="relative cursor-pointer transition-colors duration-100"
          style={{
            width: `${effectiveCellWidth}px`,
            height: `${CELL_HEIGHT}px`,
            borderBottom: "1px solid #F1F5F9",
            background:
              tieneBloqueoEnEstaHora && !tieneCitaEnEstaHora
                ? "rgba(239,68,68,.03)"
                : "transparent",
          }}
        >
          {/* BOTONES DE RESERVAR Y BLOQUEAR */}
          {!tieneCitaEnEstaHora && showButtons && (
            <div
              className="absolute inset-0 flex items-center justify-center z-[50]"
              onMouseEnter={handleButtonContainerMouseEnter}
              onMouseLeave={handleButtonContainerMouseLeave}
            >
              <div
                className="flex gap-0.5 bg-white/95 backdrop-blur-sm rounded-md p-0.5 shadow-lg border border-gray-300 animate-fadeIn"
                onClick={(e) => e.stopPropagation()}
              >
                {!tieneBloqueoEnEstaHora && (
                  <button
                    onClick={handleReservarClick}
                    className="group flex items-center justify-center gap-0.5 bg-white text-gray-900 hover:bg-gray-900 hover:text-white active:bg-gray-800 active:text-white border border-gray-300 hover:border-gray-900 px-1.5 py-0.5 rounded text-[10px] font-medium min-w-[50px] transition-all duration-150 shadow-sm hover:shadow-md cursor-pointer focus:outline-none focus:ring-1 focus:ring-gray-900"
                  >
                    <Plus className="w-2.5 h-2.5 transition-colors" />
                    Reservar
                  </button>
                )}

                <button
                  onClick={handleBloquearClick}
                  className="group flex items-center justify-center gap-0.5 bg-white text-gray-900 hover:bg-gray-900 hover:text-white active:bg-gray-800 active:text-white border border-gray-300 hover:border-gray-900 px-1.5 py-0.5 rounded text-[10px] font-medium min-w-[50px] transition-all duration-150 shadow-sm hover:shadow-md cursor-pointer focus:outline-none focus:ring-1 focus:ring-gray-900"
                >
                  <X className="w-2.5 h-2.5 transition-colors" />
                  Bloquear
                </button>

                {tieneBloqueoEnEstaHora && bloqueoEditable && (
                  <button
                    onClick={handleEditarBloqueoClick}
                    className="group flex items-center justify-center gap-0.5 bg-white text-gray-900 hover:bg-gray-900 hover:text-white active:bg-gray-800 active:text-white border border-gray-300 hover:border-gray-900 px-1.5 py-0.5 rounded text-[10px] font-medium min-w-[50px] transition-all duration-150 shadow-sm hover:shadow-md cursor-pointer focus:outline-none focus:ring-1 focus:ring-gray-900"
                  >
                    Editar
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      );
    },
  );

  const CitaComponent = React.memo(({ apt }: { apt: Appointment }) => {
    const position = getAppointmentPosition(apt);
    const isSelected = selectedAppointment?.id === apt.id;

    if (!position) return null;

    // RF status colors
    const rfStatus = resolveRFStatus(apt.estado);
    const statusInfo = RF_STATUSES[rfStatus];
    const isPrecita = rfStatus === "pre-cita";

    // Payment indicators
    const totalCita = parseFloat(apt.rawData?.valor_total || "0") || 0;
    const abonado = parseFloat(apt.rawData?.abono || "0") || 0;
    const rawSaldo = parseFloat(apt.rawData?.saldo_pendiente);
    const saldoCalc = isNaN(rawSaldo)
      ? Math.max(0, totalCita - abonado)
      : Math.max(0, rawSaldo);
    const isPaid = saldoCalc <= 0 && totalCita > 0;
    const hasAbono = abonado > 0 && !isPaid;

    const clienteNombre = shortName(
      getTextValue(apt.cliente_nombre) || "(Sin nombre)",
    );
    const serviceText =
      getFirstNonEmptyText(apt.servicios_resumen, apt.servicio_nombre) ||
      "(Sin servicio)";

    const [sh, sm] = apt.start.split(":").map(Number);
    const [eh, em] = apt.end.split(":").map(Number);
    const startH = sh + sm / 60;
    const endH = eh + em / 60;

    const handleEventMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!supportsHoverTooltips()) return;
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
      setBloqueoTooltip({
        visible: false,
        x: 0,
        y: 0,
        bloqueo: null,
        profesional: "",
      });
      setCitaTooltip({ visible: true, x: e.clientX, y: e.clientY, cita: apt });
    };

    const handleEventMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!supportsHoverTooltips()) return;
      setCitaTooltip((prev) => {
        if (!prev.visible || prev.cita?.id !== apt.id) return prev;
        if (prev.x === e.clientX && prev.y === e.clientY) return prev;
        return { ...prev, x: e.clientX, y: e.clientY };
      });
    };

    const handleEventMouseLeave = () => {
      if (!supportsHoverTooltips()) return;
      clearHoverTooltips();
    };

    const handleEventClick = () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
      setCitaTooltip({ visible: false, x: 0, y: 0, cita: null });
      setBloqueoTooltip({
        visible: false,
        x: 0,
        y: 0,
        bloqueo: null,
        profesional: "",
      });
      handleCitaClick(apt);
    };

    return (
      <div
        data-hover-source="appointment"
        className="absolute cursor-pointer overflow-hidden transition-shadow hover:shadow-md pointer-events-auto"
        style={{
          ...position,
          background: statusInfo.bg,
          borderLeft: `3px solid ${statusInfo.color}`,
          borderRadius: 6,
          padding: "6px 8px",
          boxShadow: isSelected
            ? `0 0 0 2px ${statusInfo.color}, 0 1px 3px rgba(0,0,0,.08)`
            : "0 1px 3px rgba(0,0,0,.04)",
          opacity: isPrecita ? 0.75 : 1,
          minHeight: MIN_APPOINTMENT_HEIGHT,
          zIndex: 20,
        }}
        onClick={handleEventClick}
        onMouseEnter={handleEventMouseEnter}
        onMouseMove={handleEventMouseMove}
        onMouseLeave={handleEventMouseLeave}
      >
        {isPrecita && (
          <div
            style={{
              color: statusInfo.color,
              fontSize: 8,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".5px",
              marginBottom: 1,
            }}
          >
            Pre-cita
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#1E293B",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {clienteNombre}
        </div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: statusInfo.color,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {serviceText}
        </div>
        {position.height >= 58 && (
          <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}>
            {fmtH(startH)} – {fmtH(endH)}
          </div>
        )}
        {(isPaid || hasAbono) && (
          <div className="absolute flex gap-0.5" style={{ top: 6, right: 6 }}>
            {isPaid && (
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#10B981",
                }}
              />
            )}
            {hasAbono && (
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#F59E0B",
                }}
              />
            )}
          </div>
        )}
      </div>
    );
  });

  const BloqueoComponent = React.memo(
    ({ bloqueo }: { bloqueo: BloqueoCalendario }) => {
      const position = getBloqueoPosition(bloqueo);
      if (!position) return null;

      const motivo = bloqueo.motivo?.trim() || "Bloqueo de agenda";
      const profesional = profesionales.find(
        (item) => item.estilista.profesional_id === bloqueo.profesional_id,
      );
      const nombreProfesional = profesional?.name || bloqueo.profesional_id;

      const handleBloqueoClick = (event: React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (!profesional?.estilista) return;
        if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
        setBloqueoTooltip({
          visible: false,
          x: 0,
          y: 0,
          bloqueo: null,
          profesional: "",
        });
        openBloqueoModal(profesional.estilista, bloqueo.hora_inicio, bloqueo);
      };

      const handleBloqueoMouseEnter = (
        event: React.MouseEvent<HTMLDivElement>,
      ) => {
        if (!supportsHoverTooltips()) return;
        if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
        setCitaTooltip({ visible: false, x: 0, y: 0, cita: null });
        setBloqueoTooltip({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          bloqueo,
          profesional: nombreProfesional,
        });
      };

      const handleBloqueoMouseMove = (
        event: React.MouseEvent<HTMLDivElement>,
      ) => {
        if (!supportsHoverTooltips()) return;
        setBloqueoTooltip((prev) => {
          if (!prev.visible || prev.bloqueo?._id !== bloqueo._id) return prev;
          if (prev.x === event.clientX && prev.y === event.clientY) return prev;
          return { ...prev, x: event.clientX, y: event.clientY };
        });
      };

      const handleBloqueoMouseLeave = () => {
        if (!supportsHoverTooltips()) return;
        clearHoverTooltips();
      };

      return (
        <div
          data-hover-source="bloqueo"
          className="absolute z-10 rounded-md border border-gray-300/70 bg-gradient-to-b from-gray-100 to-gray-50 shadow-sm overflow-hidden pointer-events-auto cursor-pointer group"
          style={{ ...position, minHeight: 40 }}
          onClick={handleBloqueoClick}
          onMouseEnter={handleBloqueoMouseEnter}
          onMouseMove={handleBloqueoMouseMove}
          onMouseLeave={handleBloqueoMouseLeave}
        >
          <button
            className="absolute top-1 right-1 z-20 p-1 rounded bg-white/80 hover:bg-gray-100 text-gray-400 hover:text-gray-900"
            onClick={(e) => {
              e.stopPropagation();
              setBloqueoAEliminar(bloqueo);
            }}
            title="Eliminar bloqueo"
          >
            <Trash2 size={14} />
          </button>
          <div className="h-full w-full px-2 py-1 flex flex-col overflow-hidden">
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-800 truncate">
              Bloq
            </div>
            <div className="text-[10px] leading-4 font-medium text-gray-700 truncate">
              {motivo}
            </div>
            <div className="mt-auto text-[9px] leading-3.5 text-gray-600 truncate">
              {`${bloqueo.hora_inicio}-${bloqueo.hora_fin} · ${nombreProfesional}`}
            </div>
          </div>
        </div>
      );
    },
  );

  useEffect(() => {
    console.log("🎯 ESTADO ACTUAL DEL CALENDARIO:", {
      citasCount: citas.length,
      appointmentsCount: appointments.length,
      estilistasCount: estilistas.length,
      profesionalesCount: profesionales.length,
      sedeUsuario: user?.sede_id,
      sedeActual: selectedSede?.nombre,
      refreshTrigger: refreshTrigger,
    });
  }, [
    citas,
    appointments,
    estilistas,
    profesionales,
    refreshTrigger,
    user,
    selectedSede,
  ]);

  const closeDetailPanel = useCallback(() => {
    setShowAppointmentDetails(false);
    setSelectedAppointment(null);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ── Top bar ───────────────────────────────────────────────────── */}
        <div
          className="shrink-0 flex flex-col md:flex-row md:justify-between md:items-center bg-white gap-2 px-4 py-3 md:px-[22px] md:py-[14px]"
          style={{ borderBottom: "1px solid #E2E8F0" }}
        >
          <div>
            <h1
              className="text-xl font-bold tracking-tight"
              style={{ color: "#1E293B", letterSpacing: "-.3px" }}
            >
              Agenda
            </h1>
            <div className="text-xs mt-0.5" style={{ color: "#64748B" }}>
              {selectedDate.toLocaleDateString("es-CO", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {" · "}
              {selectedSede?.nombre || "Tu sede"}
              {(loading || loadingBloqueos) && " · Actualizando..."}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Day navigation */}
            <div
              className="flex items-center gap-0.5 rounded-lg"
              style={{ background: "#F8FAFC", padding: 3, position: "relative" }}
            >
              <button
                onClick={() =>
                  setSelectedDate((d) => {
                    const n = new Date(d);
                    n.setDate(n.getDate() - 1);
                    return n;
                  })
                }
                className="flex items-center rounded-md transition-colors"
                style={{ padding: "5px 7px", color: "#64748B" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#E2E8F0")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowDatePicker((v) => !v)}
                className="text-xs font-medium transition-colors rounded-md"
                style={{ padding: "5px 10px", color: "#334155", cursor: "pointer" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#E2E8F0")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {(() => {
                  const isToday =
                    selectedDate.getFullYear() === today.getFullYear() &&
                    selectedDate.getMonth() === today.getMonth() &&
                    selectedDate.getDate() === today.getDate();
                  if (isToday) return "Hoy";
                  return selectedDate.toLocaleDateString("es-CO", {
                    day: "numeric",
                    month: "short",
                  });
                })()}
              </button>
              <button
                onClick={() =>
                  setSelectedDate((d) => {
                    const n = new Date(d);
                    n.setDate(n.getDate() + 1);
                    return n;
                  })
                }
                className="flex items-center rounded-md transition-colors"
                style={{ padding: "5px 7px", color: "#64748B" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#E2E8F0")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {showDatePicker && (
                <AgendaDatePicker
                  selectedDate={selectedDate}
                  today={today}
                  onSelect={(date) => {
                    setSelectedDate(
                      new Date(date.getFullYear(), date.getMonth(), date.getDate())
                    );
                  }}
                  onClose={() => setShowDatePicker(false)}
                />
              )}
            </div>

            {/* Nueva cita */}
            <button
              onClick={() => {
                setSelectedCell(null);
                setShowAppointmentModal(true);
              }}
              className="flex items-center gap-1.5 text-white rounded-lg text-xs font-medium transition-colors"
              style={{ padding: "9px 16px", background: "#1E293B" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#334155")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "#1E293B")
              }
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva cita
            </button>
          </div>
        </div>

        {/* ── Summary bar ───────────────────────────────────────────────── */}
        <div
          className="shrink-0 flex flex-wrap gap-5 text-xs bg-white"
          style={{
            padding: "8px 22px",
            borderBottom: "1px solid #F1F5F9",
            color: "#64748B",
          }}
        >
          <span>
            <b className="font-semibold" style={{ color: "#1E293B" }}>
              {rfActiveApts.length}
            </b>{" "}
            citas
          </span>
          <span>
            <b className="font-semibold" style={{ color: "#9CA3AF" }}>
              {rfSummary.pre}
            </b>{" "}
            pre-citas
          </span>
          <span>
            <b className="font-semibold" style={{ color: "#3B82F6" }}>
              {rfSummary.confirmed}
            </b>{" "}
            confirmadas
          </span>
          <span>
            <b className="font-semibold" style={{ color: "#8B5CF6" }}>
              {rfSummary.inProgress}
            </b>{" "}
            en curso
          </span>
          <span>
            <b className="font-semibold" style={{ color: "#F97316" }}>
              {rfSummary.finalizado}
            </b>{" "}
            finalizadas
          </span>
          <span className="ml-auto">
            <b className="font-semibold" style={{ color: "#1E293B" }}>
              {formatCOP(rfSummary.total)}
            </b>{" "}
            estimado
          </span>
        </div>

        {/* ── Calendar grid ─────────────────────────────────────────────── */}
        <div
          ref={calendarViewportRef}
          className="flex-1 overflow-auto bg-white"
          onMouseMove={handleCalendarMouseMove}
          onMouseLeave={handleCalendarMouseLeave}
        >
          <div style={{ minWidth: `${calendarMinWidth}px` }}>
            {/* Sticky header row: time spacer + stylist headers */}
            <div
              className="flex sticky top-0 z-30 bg-white"
              style={{ borderBottom: "1px solid #E2E8F0" }}
            >
              {/* Time column spacer */}
              <div
                style={{
                  width: TIME_COLUMN_WIDTH,
                  flexShrink: 0,
                  borderRight: "1px solid #F1F5F9",
                }}
              />

              {profesionales.length > 0 ? (
                <div
                  className="flex"
                  style={{ width: `${professionalsTrackWidth}px` }}
                >
                  {profesionales.map((prof) => (
                    <div
                      key={prof.estilista.unique_key}
                      className="flex items-center justify-center gap-1.5 shrink-0"
                      style={{
                        width: `${effectiveCellWidth}px`,
                        height: 52,
                        borderRight: "1px solid #F1F5F9",
                        padding: "0 6px",
                      }}
                    >
                      <div
                        className="flex items-center justify-center shrink-0 rounded-full text-white"
                        style={{
                          width: 30,
                          height: 30,
                          background: "#1E293B",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {prof.initials}
                      </div>
                      <div className="overflow-hidden">
                        <div
                          className="truncate"
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#1E293B",
                          }}
                        >
                          {prof.name}
                        </div>
                        <div style={{ fontSize: 9, color: "#94A3B8" }}>
                          {
                            appointments.filter(
                              (a) =>
                                a.profesional_id ===
                                prof.estilista.profesional_id,
                            ).length
                          }{" "}
                          citas
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center py-4">
                  <span className="text-sm" style={{ color: "#64748B" }}>
                    {user?.sede_id
                      ? "No hay estilistas en tu sede"
                      : "Selecciona una sede"}
                  </span>
                </div>
              )}
            </div>

            {/* Body: hour rows + absolute overlays */}
            {profesionales.length > 0 && (
              <div className="relative">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="flex relative"
                    style={{ borderBottom: "1px solid #F1F5F9" }}
                  >
                    {/* Time label */}
                    <div
                      className="shrink-0 sticky left-0 z-10 bg-white"
                      style={{
                        width: TIME_COLUMN_WIDTH,
                        height: CELL_HEIGHT,
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "flex-end",
                        paddingRight: 10,
                        paddingTop: 4,
                        borderRight: "1px solid #F1F5F9",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          color: "#94A3B8",
                          fontWeight: 500,
                        }}
                      >
                        {hourLabelFromStr(hour)}
                      </span>
                    </div>

                    {/* Stylist cells */}
                    {profesionales.map((prof) => (
                      <CalendarCell
                        key={`${hour}-${prof.estilista.unique_key}`}
                        prof={prof}
                        hour={hour}
                      />
                    ))}
                  </div>
                ))}

                {/* Bloqueos – global absolute layer (position calc uses profIndex offset) */}
                <div
                  className="absolute top-0 right-0 bottom-0 pointer-events-none"
                  style={{ left: TIME_COLUMN_WIDTH, zIndex: 10 }}
                >
                  {bloqueos.map((bloqueo) => (
                    <BloqueoComponent
                      key={`bloqueo-${bloqueo._id}`}
                      bloqueo={bloqueo}
                    />
                  ))}
                </div>

                {/* Appointments – global absolute layer */}
                <div
                  className="absolute top-0 right-0 bottom-0 pointer-events-none"
                  style={{ left: TIME_COLUMN_WIDTH, zIndex: 20 }}
                >
                  {appointments.map((apt) => (
                    <CitaComponent
                      key={`${apt.id}-${apt.start}-${apt.profesional_id}`}
                      apt={apt}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Legend ────────────────────────────────────────────────────── */}
        <div
          className="shrink-0 flex flex-wrap gap-4 bg-white"
          style={{
            padding: "10px 22px",
            borderTop: "1px solid #F1F5F9",
            fontSize: 10,
            color: "#64748B",
          }}
        >
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "#9CA3AF",
                opacity: 0.6,
                display: "inline-block",
              }}
            />
            Pre-cita
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "#3B82F6",
                display: "inline-block",
              }}
            />
            Confirmada
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "#8B5CF6",
                display: "inline-block",
              }}
            />
            En curso
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "#F97316",
                display: "inline-block",
              }}
            />
            Finalizado
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "#10B981",
                display: "inline-block",
              }}
            />
            Facturada
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "#EF4444",
                display: "inline-block",
              }}
            />
            Cancelada
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "#CA8A04",
                display: "inline-block",
              }}
            />
            No asistió
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#10B981",
                display: "inline-block",
              }}
            />
            Pagado
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#F59E0B",
                display: "inline-block",
              }}
            />
            Abono parcial
          </span>
        </div>
      </div>

      {/* ── Right panel overlay ───────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{
          background: "rgba(0,0,0,.15)",
          backdropFilter: showAppointmentDetails ? "blur(2px)" : "none",
          opacity: showAppointmentDetails ? 1 : 0,
          pointerEvents: showAppointmentDetails ? "auto" : "none",
        }}
        onClick={closeDetailPanel}
      />
      <div
        className="fixed top-0 right-0 bottom-0 bg-white flex flex-col z-50"
        style={{
          width: 460,
          boxShadow: "-8px 0 30px rgba(0,0,0,.08)",
          transform: showAppointmentDetails
            ? "translateX(0)"
            : "translateX(100%)",
          transition: "transform .25s ease",
        }}
      >
        {showAppointmentDetails && selectedAppointment && (
          <AppointmentDetailsModal
            open={true}
            onClose={closeDetailPanel}
            appointment={selectedAppointment}
            onRefresh={() => {
              cargarCitas();
              setRefreshTrigger((prev) => prev + 1);
            }}
            panelMode={true}
          />
        )}
      </div>

      {/* ── Tooltips ──────────────────────────────────────────────────── */}
      {citaTooltip.visible && citaTooltip.cita && (
        <div
          className="pointer-events-none fixed z-50 bg-white rounded-xl shadow-lg p-2.5 max-w-[18rem] -translate-y-1/2"
          style={{
            left: `${getTooltipLeft(citaTooltip.x, CITA_TOOLTIP_WIDTH)}px`,
            top: `${citaTooltip.y}px`,
            border: "1px solid #E2E8F0",
          }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "#1E293B" }}
            >
              <User className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3
                className="font-bold text-[13px] truncate"
                style={{ color: "#1E293B" }}
              >
                {getTextValue(citaTooltip.cita.cliente_nombre) ||
                  "(Sin nombre)"}
              </h3>
              <p className="text-xs truncate" style={{ color: "#64748B" }}>
                {citaTooltip.cita.start} – {citaTooltip.cita.end}
              </p>
            </div>
          </div>
          <div className="space-y-1" style={{ fontSize: 11, color: "#475569" }}>
            <div>
              {getFirstNonEmptyText(
                citaTooltip.cita.servicios_detalle,
                citaTooltip.cita.servicio_nombre,
              ) || "(Sin servicio)"}
            </div>
            <div style={{ color: "#64748B" }}>
              {getTextValue(citaTooltip.cita.estilista_nombre)}
            </div>
          </div>
          {(() => {
            const rfSt = resolveRFStatus(getTextValue(citaTooltip.cita.estado));
            const si = RF_STATUSES[rfSt];
            return (
              <div
                className="inline-flex items-center gap-1 rounded-full text-[10px] font-medium mt-2"
                style={{
                  padding: "3px 8px",
                  background: si.bg,
                  color: si.color,
                }}
              >
                <div
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: si.color,
                  }}
                />
                {si.label}
              </div>
            );
          })()}
        </div>
      )}

      {bloqueoTooltip.visible && bloqueoTooltip.bloqueo && (
        <div
          className="pointer-events-none fixed z-50 bg-white rounded-xl shadow-xl p-3 max-w-xs -translate-y-1/2"
          style={{
            left: `${getTooltipLeft(bloqueoTooltip.x, BLOQUEO_TOOLTIP_WIDTH)}px`,
            top: `${bloqueoTooltip.y}px`,
            border: "1px solid #E2E8F0",
          }}
        >
          <div
            className="font-semibold text-sm mb-1"
            style={{ color: "#1E293B" }}
          >
            Bloqueo
          </div>
          <div className="text-xs space-y-1" style={{ color: "#64748B" }}>
            <div>
              {bloqueoTooltip.bloqueo.hora_inicio} –{" "}
              {bloqueoTooltip.bloqueo.hora_fin}
            </div>
            <div>{bloqueoTooltip.bloqueo.motivo || "Bloqueo de agenda"}</div>
            <div>{bloqueoTooltip.profesional}</div>
          </div>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────── */}
      {showBloqueoModal && (
        <Modal
          open={showBloqueoModal}
          onClose={handleClose}
          title={selectedBloqueo ? "Editar bloqueo" : "Bloqueo de horario"}
        >
          <Bloqueos
            onClose={handleBloqueoCreado}
            estilistaId={selectedCell?.estilista.profesional_id}
            fecha={selectedDateString}
            horaInicio={selectedCell?.hora}
            editingBloqueo={selectedBloqueo}
          />
        </Modal>
      )}

      {showAppointmentModal && (
        <Modal
          open={showAppointmentModal}
          onClose={handleClose}
          title="Nueva Cita"
          className="w-full"
        >
          <AppointmentScheduler
            sedeId={sedeIdActual}
            estilistaId={selectedCell?.estilista.profesional_id}
            fecha={selectedDateString}
            horaSeleccionada={selectedCell?.hora}
            estilistas={estilistas}
            onClose={handleCitaCreada}
          />
        </Modal>
      )}

      {bloqueoAEliminar && (
        <Modal
          open={!!bloqueoAEliminar}
          onClose={() => setBloqueoAEliminar(null)}
          title="Eliminar bloqueo"
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-700">
              ¿Eliminar el bloqueo <strong>{bloqueoAEliminar.motivo || "sin motivo"}</strong> de{" "}
              {bloqueoAEliminar.hora_inicio}–{bloqueoAEliminar.hora_fin}?
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
                onClick={() => setBloqueoAEliminar(null)}
                disabled={eliminandoBloqueo}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50"
                onClick={handleConfirmarEliminarBloqueo}
                disabled={eliminandoBloqueo}
              >
                {eliminandoBloqueo ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default React.memo(CalendarScheduler);
