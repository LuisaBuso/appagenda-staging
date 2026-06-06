import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, User, X, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { Sidebar } from '../../../components/Layout/Sidebar';
import Bloqueos from "../../../components/Quotes/Bloqueos";
import AppointmentScheduler from "../../../components/Quotes/AppointmentForm";
import Modal from "../../../components/ui/modal";
import { getCitas } from '../../../components/Quotes/citasApi';
import { getSedes, type Sede } from '../../../components/Branch/sedesApi';
import { getEstilistas, type Estilista } from '../../../components/Professionales/estilistasApi';
import AppointmentDetailsModal from './AppointmentDetailsModal';
import { useAuth } from '../../../components/Auth/AuthContext';
import { getBloqueosMultiplesProfesionales, deleteBloqueo, type Bloqueo } from '../../../components/Quotes/bloqueosApi';
import { formatSedeNombre } from "../../../lib/sede";
import { extractAgendaAdditionalNotes } from "../../../lib/agenda";
import { AgendaDatePicker } from "../../PageSede/Appoinment/AgendaDatePicker";

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
  notas_adicionales?: string;
  rawData?: any;
}

interface EstilistaCompleto extends Estilista {
  servicios_no_presta: string[];
  especialidades: boolean;
  unique_key: string;
}

interface BloqueoCalendario extends Bloqueo {
  _id: string;
}

const SLOT_INTERVAL_MINUTES = 60;
const START_HOUR = 5;
const END_HOUR = 19;
const TIME_COLUMN_WIDTH = 56;
const APPOINTMENT_VERTICAL_OFFSET = 3;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => {
  const hour = START_HOUR + i;
  return `${hour.toString().padStart(2, '0')}:00`;
});

const COLORS = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-amber-500', 'bg-indigo-500', 'bg-teal-500', 'bg-pink-500', 'bg-cyan-500'];
const CELL_HEIGHT = 68;
const CELL_WIDTH = 150;
const MAX_STYLIST_COLUMN_WIDTH = 280;
const MIN_APPOINTMENT_HEIGHT = 44;
const APPOINTMENT_BORDER_WIDTH = 3;
const CITA_TOOLTIP_WIDTH = 300;
const TOOLTIP_MARGIN = 10;

// ── RF design status system ──────────────────────────────────────────────────
const RF_STATUSES = {
  'pre-cita':    { color: '#9CA3AF', bg: '#F3F4F6', label: 'Pre-cita' },
  'confirmed':   { color: '#3B82F6', bg: '#EFF6FF', label: 'Confirmada' },
  'in-progress': { color: '#8B5CF6', bg: '#F5F3FF', label: 'En curso' },
  'completed':   { color: '#10B981', bg: '#ECFDF5', label: 'Facturada' },
  'cancelled':   { color: '#EF4444', bg: '#FEF2F2', label: 'Cancelada' },
  'no-asistio':  { color: '#CA8A04', bg: '#FEFCE8', label: 'No asistió' },
} as const;
type RFStatusKey = keyof typeof RF_STATUSES;

const resolveRFStatus = (estado: string): RFStatusKey => {
  const v = (estado || '').toLowerCase().trim();
  if (v.includes('cancel')) return 'cancelled';
  if (v === 'no_asistio' || v === 'no asistio' || v.includes('no_asistio') || v.includes('no asistio')) return 'no-asistio';
  if (['pre-cita', 'pre_cita', 'precita', 'pre_reservada'].some(s => v.includes(s))) return 'pre-cita';
  if (['en proc', 'en_proc', 'proceso', 'en curso', 'en_curso', 'en-curso', 'progres', 'in-prog'].some(s => v.includes(s))) return 'in-progress';
  if (['complet', 'finaliz', 'terminad', 'realizad', 'factur'].some(s => v.includes(s))) return 'completed';
  return 'confirmed';
};

const fmtH = (hour: number): string => {
  const h = Math.floor(hour);
  const m = Math.round((hour % 1) * 60);
  const ap = h >= 12 ? 'p.m.' : 'a.m.';
  const d = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${d}:${m === 0 ? '00' : String(m).padStart(2, '0')} ${ap}`;
};

const shortName = (name: string): string =>
  name.trim().split(' ').filter(Boolean).slice(0, 2).join(' ');

const formatCOP = (amount: number): string =>
  '$' + Math.round(amount).toLocaleString('es-CO');

const hourLabelFromStr = (hourStr: string): string => {
  const h = parseInt(hourStr.split(':')[0], 10);
  const d = h > 12 ? h - 12 : h;
  return `${d}:00`;
};
const normalizeRole = (role: string | null | undefined) =>
  String(role ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const CalendarScheduler: React.FC = () => {
  const { user, activeSedeId, setActiveSedeId } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedSede, setSelectedSede] = useState<Sede | null>(null);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [estilistas, setEstilistas] = useState<EstilistaCompleto[]>([]);
  const [citas, setCitas] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [, setShowOptions] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showBloqueoModal, setShowBloqueoModal] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ estilista: EstilistaCompleto, hora: string } | null>(null);
  const [citaTooltip, setCitaTooltip] = useState({ visible: false, x: 0, y: 0, cita: null as Appointment | null });
  const [_refreshTrigger, setRefreshTrigger] = useState(0);
  const [showAppointmentDetails, setShowAppointmentDetails] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [bloqueos, setBloqueos] = useState<BloqueoCalendario[]>([]);
  const [loadingBloqueos, setLoadingBloqueos] = useState(false);
  const [bloqueoAEliminar, setBloqueoAEliminar] = useState<BloqueoCalendario | null>(null);
  const [eliminandoBloqueo, setEliminandoBloqueo] = useState(false);
  const [_isInitialLoad, setIsInitialLoad] = useState(true);
  const [calendarViewportWidth, setCalendarViewportWidth] = useState(0);

  const optionsRef = useRef<HTMLDivElement>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout>();
  const dataCacheRef = useRef<Map<string, any>>(new Map());
  const calendarViewportRef = useRef<HTMLDivElement | null>(null);

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const selectedDateString = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
    const day = selectedDate.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, [selectedDate]);

  const todayLabel = useMemo(() => {
    if (selectedDate.toDateString() === today.toDateString()) return 'Hoy';
    return selectedDate.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  }, [selectedDate, today]);

  const sedeIdActual = useMemo(() => {
    return selectedSede?.sede_id || '';
  }, [selectedSede]);

  const allowedSedes = useMemo(() => {
    const set = new Set<string>();
    const primary = String(user?.sede_id_principal ?? "").trim();
    if (primary) set.add(primary);

    const active = String(user?.sede_id ?? "").trim();
    if (active) set.add(active);

    if (Array.isArray(user?.sedes_permitidas)) {
      user.sedes_permitidas.forEach((sedeId) => {
        const normalized = String(sedeId ?? "").trim();
        if (normalized) set.add(normalized);
      });
    }

    return set;
  }, [user?.sede_id, user?.sede_id_principal, user?.sedes_permitidas]);

  const isSuperAdmin = useMemo(
    () => {
      const role = normalizeRole(user?.role);
      return role === "super_admin" || role === "superadmin";
    },
    [user?.role]
  );

  // Cargar sedes y respetar el contexto de sede activo.
  useEffect(() => {
    const cargarSedesInicial = async () => {
      if (!user?.access_token) return;
      
      try {
        const cacheKey = `sedes_${user.access_token.substring(0, 10)}`;
        let sedesData: Sede[];
        
        // Usar caché si está disponible
        if (dataCacheRef.current.has(cacheKey)) {
          sedesData = dataCacheRef.current.get(cacheKey);
        } else {
          sedesData = await getSedes(user.access_token);
          dataCacheRef.current.set(cacheKey, sedesData);
        }
        
        const filteredSedes = isSuperAdmin
          ? sedesData
          : sedesData.filter((sede) => {
              const sedeId = String(sede.sede_id ?? "").trim();
              return sedeId ? allowedSedes.has(sedeId) : false;
            });

        setSedes(filteredSedes);

        const preferredSedeId = String(
          activeSedeId || user?.sede_id || user?.sede_id_principal || ""
        ).trim();
        const preferredSede = filteredSedes.find((sede) => sede.sede_id === preferredSedeId);
        const nextSelectedSede = preferredSede || filteredSedes[0] || null;

        setSelectedSede(nextSelectedSede);

        if (nextSelectedSede?.sede_id && nextSelectedSede.sede_id !== activeSedeId) {
          setActiveSedeId(nextSelectedSede.sede_id);
        }
      } catch (error) {
        console.error('Error cargando sedes:', error);
      } finally {
        setIsInitialLoad(false);
      }
    };
    
    cargarSedesInicial();
  }, [
    user?.access_token,
    user?.sede_id,
    user?.sede_id_principal,
    user?.role,
    activeSedeId,
    allowedSedes,
    isSuperAdmin,
    setActiveSedeId,
  ]);

  const handleCitaClick = useCallback((apt: Appointment) => {
    console.log('Cita clickeada:', apt);
    setSelectedAppointment(apt);
    setShowAppointmentDetails(true);
  }, []);

  // OPTIMIZADO: Cargar bloqueos con caché
  const cargarBloqueos = useCallback(async () => {
    if (!user?.access_token || !selectedSede || estilistas.length === 0) return;

    const cacheKey = `bloqueos_${selectedSede.sede_id}_${selectedDateString}`;
    
    // Verificar caché
    if (dataCacheRef.current.has(cacheKey)) {
      setBloqueos(dataCacheRef.current.get(cacheKey));
      return;
    }

    setLoadingBloqueos(true);
    try {
      const profesionalIds = estilistas.map(e => e.profesional_id);
      const todosBloqueos = await getBloqueosMultiplesProfesionales(profesionalIds, user.access_token);

      const bloqueosFiltrados = todosBloqueos.filter(bloqueo => {
        if (!bloqueo || !bloqueo.fecha) return false;

        let fechaBloqueo: string;
        if (bloqueo.fecha.includes('T')) {
          fechaBloqueo = bloqueo.fecha.split('T')[0];
        } else if (bloqueo.fecha.includes(' ')) {
          fechaBloqueo = bloqueo.fecha.split(' ')[0];
        } else {
          fechaBloqueo = bloqueo.fecha;
        }

        return fechaBloqueo === selectedDateString;
      });

      const bloqueosConId: BloqueoCalendario[] = bloqueosFiltrados.filter(
        (bloqueo): bloqueo is BloqueoCalendario =>
          typeof bloqueo._id === 'string' && bloqueo._id.trim().length > 0
      );

      // Guardar en caché
      dataCacheRef.current.set(cacheKey, bloqueosConId);
      setBloqueos(bloqueosConId);
    } catch (error) {
      console.error('Error cargando bloqueos:', error);
      setBloqueos([]);
    } finally {
      setLoadingBloqueos(false);
    }
  }, [estilistas, user, selectedDateString, selectedSede]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(event.target as Node)) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // OPTIMIZADO: Cargar estilistas con caché
  const cargarEstilistas = useCallback(async () => {
    if (!sedeIdActual || !user?.access_token) {
      setEstilistas([]);
      return;
    }

    const cacheKey = `estilistas_${sedeIdActual}`;
    
    // Verificar caché
    if (dataCacheRef.current.has(cacheKey)) {
      setEstilistas(dataCacheRef.current.get(cacheKey));
      return;
    }

    setLoading(true);
    try {
      const estilistasData = await getEstilistas(user.access_token);

      if (!Array.isArray(estilistasData)) {
        setEstilistas([]);
        return;
      }

      const estilistasFiltrados = estilistasData
        .filter((est): est is Estilista => {
          return est?.sede_id === sedeIdActual;
        })
        .map(est => ({
          ...est,
          servicios_no_presta: est.servicios_no_presta || [],
          especialidades: est.especialidades || false,
          unique_key: `stylist-${est.profesional_id}`
        } as EstilistaCompleto));

      console.log(`👨‍💼 Estilistas cargados para sede ${selectedSede?.nombre}:`, estilistasFiltrados.length);
      
      // Guardar en caché
      dataCacheRef.current.set(cacheKey, estilistasFiltrados);
      setEstilistas(estilistasFiltrados);
    } catch (error) {
      console.error('Error cargando estilistas:', error);
      setEstilistas([]);
    } finally {
      setLoading(false);
    }
  }, [sedeIdActual, user, selectedSede]);

  // OPTIMIZADO: Cargar citas con caché y optimizaciones
  const cargarCitas = useCallback(async () => {
    if (!user?.access_token || !selectedSede) return;

    const cacheKey = `citas_${selectedSede.sede_id}_${selectedDateString}`;
    
    // Verificar caché
    if (dataCacheRef.current.has(cacheKey)) {
      setCitas(dataCacheRef.current.get(cacheKey));
      return;
    }

    setLoading(true);
    try {
      // OPTIMIZACIÓN: Solo pedir citas del día específico y sede específica
      const params: any = { 
        fecha: selectedDateString,
        sede_id: selectedSede.sede_id,
        limit: 100 // Limitar resultados para evitar carga pesada
      };

      const response = await getCitas(params, user.access_token);
      const citasData = response.citas || response || [];
      
      // Guardar en caché
      dataCacheRef.current.set(cacheKey, citasData);
      setCitas(citasData);
    } catch (error) {
      console.error('Error al cargar citas:', error);
      setCitas([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDateString, selectedSede, user]);

  // OPTIMIZADO: Cargar datos de forma eficiente
  useEffect(() => {
    if (!selectedSede) return;

    // Limpiar caché de datos de sede anterior
    dataCacheRef.current.forEach((_, key) => {
      if (key.startsWith('citas_') || key.startsWith('bloqueos_')) {
        dataCacheRef.current.delete(key);
      }
    });

    // Cargar datos en secuencia para mejor performance
    const cargarDatosSede = async () => {
      try {
        await cargarEstilistas();
        // Esperar un momento antes de cargar citas para no saturar
        setTimeout(() => cargarCitas(), 100);
      } catch (error) {
        console.error('Error cargando datos de sede:', error);
      }
    };

    cargarDatosSede();
  }, [selectedSede, cargarEstilistas, cargarCitas]);

  // Cargar bloqueos cuando hay estilistas (con retraso para no saturar)
  useEffect(() => {
    if (estilistas.length > 0 && selectedSede) {
      setTimeout(() => cargarBloqueos(), 200);
    }
  }, [estilistas, selectedSede, cargarBloqueos]);

  // Invalidar caché cuando cambia la fecha
  useEffect(() => {
    dataCacheRef.current.forEach((_, key) => {
      if (key.includes('citas_') && !key.includes(selectedDateString)) {
        dataCacheRef.current.delete(key);
      }
      if (key.includes('bloqueos_') && !key.includes(selectedDateString)) {
        dataCacheRef.current.delete(key);
      }
    });
  }, [selectedDateString]);

  const profesionales = useMemo(() => {
    return estilistas.map(est => ({
      name: est.nombre,
      initials: est.nombre.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2),
      estilista: est
    }));
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
    const availableWidth = Math.max(calendarViewportWidth - TIME_COLUMN_WIDTH, 0);
    if (availableWidth <= 0) return CELL_WIDTH;
    const expandedWidth = Math.max(CELL_WIDTH, availableWidth / profesionales.length);
    return Math.min(expandedWidth, MAX_STYLIST_COLUMN_WIDTH);
  }, [calendarViewportWidth, profesionales.length]);

  const getTooltipLeft = useCallback((cursorX: number, tooltipWidth: number) => {
    if (typeof window === "undefined") return cursorX + TOOLTIP_MARGIN;
    const preferredRight = cursorX + TOOLTIP_MARGIN;
    const maxLeft = window.innerWidth - tooltipWidth - TOOLTIP_MARGIN;

    if (preferredRight <= maxLeft) return preferredRight;
    return Math.max(cursorX - tooltipWidth - TOOLTIP_MARGIN, TOOLTIP_MARGIN);
  }, []);

  const professionalsTrackWidth = useMemo(
    () => effectiveCellWidth * profesionales.length,
    [effectiveCellWidth, profesionales.length]
  );

  const calendarMinWidth = useMemo(
    () => Math.max(TIME_COLUMN_WIDTH + professionalsTrackWidth, calendarViewportWidth || 0),
    [calendarViewportWidth, professionalsTrackWidth]
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

    const layoutByProfessional = new Map<string, Map<string, AppointmentLayoutInfo>>();

    groupedByProfessional.forEach((items, profesionalId) => {
      const sortedItems = [...items].sort((a, b) =>
        a.start - b.start || a.end - b.end || a.key.localeCompare(b.key)
      );

      const layoutMap = new Map<string, AppointmentLayoutInfo>();
      let group: AppointmentLayoutItem[] = [];
      let groupEnd = -Infinity;

      const commitGroup = () => {
        if (group.length === 0) return;

        const columnsEnd: number[] = [];
        const assignedColumns = new Map<string, number>();

        group.forEach((item) => {
          let columnIndex = columnsEnd.findIndex((columnEnd) => columnEnd <= item.start);
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

  const getAppointmentPosition = useCallback((apt: Appointment) => {
    const citaProfesionalId = apt.profesional_id || apt.rawData?.profesional_id;
    const profIndex = profesionales.findIndex(p => {
      const estilistaId = p.estilista.profesional_id;
      return citaProfesionalId === estilistaId;
    });

    if (profIndex === -1) {
      return null;
    }

    const [startHour, startMin] = apt.start.split(':').map(Number);
    const [endHour, endMin] = apt.end.split(':').map(Number);

    const startMinutesFrom5AM = (startHour - START_HOUR) * 60 + startMin;
    const endMinutesFrom5AM = (endHour - START_HOUR) * 60 + endMin;

    const startBlock = startMinutesFrom5AM / SLOT_INTERVAL_MINUTES;
    const endBlock = endMinutesFrom5AM / SLOT_INTERVAL_MINUTES;
    const totalBlocks = endBlock - startBlock;

    const tieneBloqueoSolapado = bloqueos.some((bloqueo) => {
      if (bloqueo.profesional_id !== citaProfesionalId) return false;

      const [bloqueoStartHour, bloqueoStartMin] = bloqueo.hora_inicio.split(':').map(Number);
      const [bloqueoEndHour, bloqueoEndMin] = bloqueo.hora_fin.split(':').map(Number);
      if ([bloqueoStartHour, bloqueoStartMin, bloqueoEndHour, bloqueoEndMin].some(Number.isNaN)) return false;

      const bloqueoInicio = (bloqueoStartHour - START_HOUR) * 60 + bloqueoStartMin;
      const bloqueoFin = (bloqueoEndHour - START_HOUR) * 60 + bloqueoEndMin;

      return startMinutesFrom5AM < bloqueoFin && endMinutesFrom5AM > bloqueoInicio;
    });

    const minHeight = Math.max(totalBlocks * CELL_HEIGHT - 4, MIN_APPOINTMENT_HEIGHT);

    const aptKey = `${apt.id}-${apt.start}-${apt.end}-${citaProfesionalId}`;
    const layoutInfo = appointmentLayoutByProfessional.get(citaProfesionalId)?.get(aptKey);
    const appointmentColumnIndex = layoutInfo?.column ?? 0;
    const appointmentColumns = Math.max(layoutInfo?.columns ?? 1, 1);

    const leftBase = profIndex * effectiveCellWidth;
    const topPosition = (startBlock * CELL_HEIGHT) + APPOINTMENT_VERTICAL_OFFSET;
    const anchoTotalCelda = effectiveCellWidth - APPOINTMENT_BORDER_WIDTH;
    const totalColumns = appointmentColumns + (tieneBloqueoSolapado ? 1 : 0);
    const anchoCita = Math.max(anchoTotalCelda / totalColumns, 24);
    const leftPosition = leftBase + (appointmentColumnIndex * anchoCita);

    return {
      left: leftPosition,
      top: topPosition,
      height: minHeight,
      width: anchoCita,
    };
  }, [profesionales, bloqueos, appointmentLayoutByProfessional, effectiveCellWidth]);

  const appointments = useMemo(() => {
    if (!citas.length) {
      return [];
    }

    const citasFiltradas = citas.filter(cita => {
      return cita.fecha === selectedDateString;
    });

    return citasFiltradas.map((cita, index) => {
      const estilistaIndex = estilistas.findIndex(e =>
        e.profesional_id === cita.profesional_id
      );

      const colorIndex = estilistaIndex >= 0 ? estilistaIndex % COLORS.length : index % COLORS.length;
      const colorClass = COLORS[colorIndex];

      const parseTime = (time: string) => {
        const [hours, minutes] = time.split(':').map(Number);
        return (hours - START_HOUR) * 60 + minutes;
      };

      const startMinutes = parseTime(cita.hora_inicio);
      const endMinutes = parseTime(cita.hora_fin);
      const duracion = Math.max(0, endMinutes - startMinutes);

      return {
        id: cita._id,
        title: cita.cliente_nombre || `Cliente ${cita.cliente_id}`,
        profesional: cita.profesional_nombre,
        start: cita.hora_inicio,
        end: cita.hora_fin,
        color: colorClass,
        tipo: cita.servicio_nombre,
        duracion: duracion,
        precio: 0,
        cliente_nombre: cita.cliente_nombre || `Cliente ${cita.cliente_id}`,
        servicio_nombre: cita.servicio_nombre,
        estilista_nombre: cita.profesional_nombre,
        estado: cita.estado || 'pendiente',
        profesional_id: cita.profesional_id,
        notas_adicionales: extractAgendaAdditionalNotes(cita),
        rawData: cita
      };
    });
  }, [citas, selectedDateString, estilistas]);

  const rfActiveApts = useMemo(
    () => appointments.filter(a => resolveRFStatus(a.estado) !== 'cancelled'),
    [appointments]
  );
  const rfSummary = useMemo(() => ({
    pre:        rfActiveApts.filter(a => resolveRFStatus(a.estado) === 'pre-cita').length,
    confirmed:  rfActiveApts.filter(a => resolveRFStatus(a.estado) === 'confirmed').length,
    inProgress: rfActiveApts.filter(a => resolveRFStatus(a.estado) === 'in-progress').length,
    total:      appointments.reduce((s, a) => s + (parseFloat(a.rawData?.valor_total || '0') || 0), 0),
  }), [rfActiveApts, appointments]);

  const getBloqueoPosition = useCallback((bloqueo: BloqueoCalendario) => {
    const profIndex = profesionales.findIndex(
      (profesional) => profesional.estilista.profesional_id === bloqueo.profesional_id
    );

    if (profIndex === -1) return null;

    const [startHour, startMin] = bloqueo.hora_inicio.split(':').map(Number);
    const [endHour, endMin] = bloqueo.hora_fin.split(':').map(Number);
    if ([startHour, startMin, endHour, endMin].some(Number.isNaN)) return null;

    const startMinutesFrom5AM = (startHour - START_HOUR) * 60 + startMin;
    const endMinutesFrom5AM = (endHour - START_HOUR) * 60 + endMin;
    const startBlock = startMinutesFrom5AM / SLOT_INTERVAL_MINUTES;
    const endBlock = endMinutesFrom5AM / SLOT_INTERVAL_MINUTES;
    const totalBlocks = Math.max(endBlock - startBlock, 1);

    const layoutMap = appointmentLayoutByProfessional.get(bloqueo.profesional_id);
    let maxAppointmentColumns = 0;
    if (layoutMap) {
      layoutMap.forEach((layoutInfo) => {
        const overlaps =
          startMinutesFrom5AM < layoutInfo.end &&
          endMinutesFrom5AM > layoutInfo.start;
        if (overlaps) {
          maxAppointmentColumns = Math.max(maxAppointmentColumns, layoutInfo.columns);
        }
      });
    }

    const anchoTotalCelda = effectiveCellWidth - APPOINTMENT_BORDER_WIDTH;
    const totalColumns = maxAppointmentColumns > 0 ? maxAppointmentColumns + 1 : 1;
    const anchoBloqueo = Math.max(anchoTotalCelda / totalColumns, 24);
    const leftBase = profIndex * effectiveCellWidth;
    const leftPosition = maxAppointmentColumns > 0
      ? leftBase + anchoTotalCelda - anchoBloqueo
      : leftBase;

    return {
      left: leftPosition,
      top: (startBlock * CELL_HEIGHT) + APPOINTMENT_VERTICAL_OFFSET,
      height: Math.max(totalBlocks * CELL_HEIGHT - 4, 32),
      width: anchoBloqueo,
    };
  }, [profesionales, appointmentLayoutByProfessional, effectiveCellWidth]);

  const handleClose = useCallback(() => {
    setShowAppointmentModal(false);
    setShowBloqueoModal(false);
    setSelectedCell(null);
    setShowOptions(false);
  }, []);

  const handleCitaCreada = useCallback(() => {
    // Invalidar caché de citas para esta sede y fecha
    if (selectedSede) {
      const cacheKey = `citas_${selectedSede.sede_id}_${selectedDateString}`;
      dataCacheRef.current.delete(cacheKey);
    }
    
    cargarCitas();
    cargarEstilistas();
    setRefreshTrigger(prev => prev + 1);
    handleClose();
  }, [cargarCitas, cargarEstilistas, handleClose, selectedSede, selectedDateString]);

  const handleBloqueoCreado = useCallback(() => {
    // Invalidar caché de bloqueos para esta sede y fecha
    if (selectedSede) {
      const cacheKey = `bloqueos_${selectedSede.sede_id}_${selectedDateString}`;
      dataCacheRef.current.delete(cacheKey);
    }
    
    cargarCitas();
    cargarEstilistas();
    cargarBloqueos();
    setRefreshTrigger(prev => prev + 1);
    handleClose();
  }, [cargarCitas, cargarEstilistas, cargarBloqueos, handleClose, selectedSede, selectedDateString]);

  const handleConfirmarEliminarBloqueo = useCallback(async () => {
    if (!bloqueoAEliminar || !user?.access_token) return;
    setEliminandoBloqueo(true);
    try {
      await deleteBloqueo(bloqueoAEliminar._id, user.access_token);
      if (selectedSede) {
        const cacheKey = `bloqueos_${selectedSede.sede_id}_${selectedDateString}`;
        dataCacheRef.current.delete(cacheKey);
      }
      setBloqueoAEliminar(null);
      cargarBloqueos();
    } catch (error) {
      console.error('Error eliminando bloqueo:', error);
    } finally {
      setEliminandoBloqueo(false);
    }
  }, [bloqueoAEliminar, user, cargarBloqueos, selectedSede, selectedDateString]);

  const overlapsSlot = useCallback((startMinutes: number, endMinutes: number, slotStartMinutes: number) => {
    const slotEndMinutes = slotStartMinutes + SLOT_INTERVAL_MINUTES;
    return startMinutes < slotEndMinutes && endMinutes > slotStartMinutes;
  }, []);

  const getCitaEnSlot = useCallback((profesionalId: string, hora: string): Appointment | null => {
    const [blockHour, blockMin] = hora.split(':').map(Number);
    if (Number.isNaN(blockHour) || Number.isNaN(blockMin)) return null;

    const blockMinutesFrom5AM = (blockHour - START_HOUR) * 60 + blockMin;

    return appointments.find((apt) => {
      const aptProfesionalId = apt.profesional_id || apt.rawData?.profesional_id;
      if (aptProfesionalId !== profesionalId) return false;

      const [startHour, startMin] = apt.start.split(':').map(Number);
      const [endHour, endMin] = apt.end.split(':').map(Number);
      if ([startHour, startMin, endHour, endMin].some(Number.isNaN)) return false;

      const startMinutesFrom5AM = (startHour - START_HOUR) * 60 + startMin;
      const endMinutesFrom5AM = (endHour - START_HOUR) * 60 + endMin;

      return overlapsSlot(startMinutesFrom5AM, endMinutesFrom5AM, blockMinutesFrom5AM);
    }) || null;
  }, [appointments, overlapsSlot]);

  const getBloqueosEnSlot = useCallback((profesionalId: string, hora: string): BloqueoCalendario[] => {
    const [blockHour, blockMin] = hora.split(':').map(Number);
    if (Number.isNaN(blockHour) || Number.isNaN(blockMin)) return [];

    const blockMinutesFrom5AM = (blockHour - START_HOUR) * 60 + blockMin;

    return bloqueos.filter((bloqueo) => {
      if (bloqueo.profesional_id !== profesionalId) return false;

      const [startHour, startMin] = bloqueo.hora_inicio.split(':').map(Number);
      const [endHour, endMin] = bloqueo.hora_fin.split(':').map(Number);

      if ([startHour, startMin, endHour, endMin].some(Number.isNaN)) return false;

      const startMinutesFrom5AM = (startHour - START_HOUR) * 60 + startMin;
      const endMinutesFrom5AM = (endHour - START_HOUR) * 60 + endMin;

      return overlapsSlot(startMinutesFrom5AM, endMinutesFrom5AM, blockMinutesFrom5AM);
    });
  }, [bloqueos, overlapsSlot]);

  const openAppointmentModal = useCallback((estilista: EstilistaCompleto, hora: string) => {
    setSelectedCell({ estilista, hora });
    setShowAppointmentModal(true);
    setShowOptions(false);
  }, []);

  const openBloqueoModal = useCallback((estilista: EstilistaCompleto, hora: string) => {
    setSelectedCell({ estilista, hora });
    setShowBloqueoModal(true);
    setShowOptions(false);
  }, []);

  // COMPONENTE CELDA DE CALENDARIO - EXACTAMENTE IGUAL
  const CalendarCell = React.memo(({ prof, hour }: { prof: any; hour: string }) => {
    const [showButtons, setShowButtons] = useState(false);
    const cellRef = useRef<HTMLDivElement>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const profesionalId = prof.estilista.profesional_id;

    const citaEnSlot = useMemo(
      () => getCitaEnSlot(profesionalId, hour),
      [getCitaEnSlot, profesionalId, hour]
    );
    const bloqueosEnSlot = useMemo(
      () => getBloqueosEnSlot(profesionalId, hour),
      [getBloqueosEnSlot, profesionalId, hour]
    );
    const tieneCitaEnEstaHora = Boolean(citaEnSlot);
    const tieneBloqueoEnEstaHora = bloqueosEnSlot.length > 0;

    useEffect(() => {
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }, []);

    const handleCellClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();

      if (tieneCitaEnEstaHora && citaEnSlot) {
        handleCitaClick(citaEnSlot);
        setShowButtons(false);
        return;
      }

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setShowButtons(true);
    }, [tieneCitaEnEstaHora, citaEnSlot, handleCitaClick]);

    const handleReservarClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      openAppointmentModal(prof.estilista, hour);
      setShowButtons(false);
    }, [prof.estilista, hour, openAppointmentModal]);

    const handleBloquearClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      openBloqueoModal(prof.estilista, hour);
      setShowButtons(false);
    }, [prof.estilista, hour, openBloqueoModal]);

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
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (!tieneCitaEnEstaHora && !tieneBloqueoEnEstaHora) {
        setShowButtons(true);
      }
    }, [tieneCitaEnEstaHora, tieneBloqueoEnEstaHora]);

    const handleMouseLeave = useCallback(() => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setShowButtons(false);
    }, []);

    const handleButtonContainerMouseEnter = useCallback(() => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }, []);

    const handleButtonContainerMouseLeave = useCallback(() => {
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
          borderBottom: '1px solid #F1F5F9',
          background: tieneBloqueoEnEstaHora && !tieneCitaEnEstaHora
            ? 'rgba(239,68,68,.03)'
            : 'transparent',
        }}
      >
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
            </div>
          </div>
        )}
      </div>
    );
  });

  const CitaComponent = React.memo(({ apt }: { apt: Appointment }) => {
    const position = getAppointmentPosition(apt);
    const isSelected = selectedAppointment?.id === apt.id;

    if (!position) return null;

    const rfStatus = resolveRFStatus(apt.estado);
    const statusInfo = RF_STATUSES[rfStatus];
    const isPrecita = rfStatus === 'pre-cita';

    const totalCita = parseFloat(apt.rawData?.valor_total || '0') || 0;
    const abonado   = parseFloat(apt.rawData?.abono       || '0') || 0;
    const rawSaldo  = parseFloat(apt.rawData?.saldo_pendiente);
    const saldoCalc = isNaN(rawSaldo) ? Math.max(0, totalCita - abonado) : Math.max(0, rawSaldo);
    const isPaid    = saldoCalc <= 0 && totalCita > 0;
    const hasAbono  = abonado > 0 && !isPaid;

    const clienteNombre = shortName(apt.cliente_nombre || '(Sin nombre)');
    const serviceText   = apt.servicio_nombre || '(Sin servicio)';

    const [sh, sm] = apt.start.split(':').map(Number);
    const [eh, em] = apt.end.split(':').map(Number);
    const startH = sh + sm / 60;
    const endH   = eh + em / 60;

    return (
      <div
        className="absolute cursor-pointer overflow-hidden transition-shadow hover:shadow-md pointer-events-auto"
        style={{
          ...position,
          background: statusInfo.bg,
          borderLeft: `3px solid ${statusInfo.color}`,
          borderRadius: 6,
          padding: '6px 8px',
          boxShadow: isSelected
            ? `0 0 0 2px ${statusInfo.color}, 0 1px 3px rgba(0,0,0,.08)`
            : '0 1px 3px rgba(0,0,0,.04)',
          opacity: isPrecita ? 0.75 : 1,
          minHeight: MIN_APPOINTMENT_HEIGHT,
          zIndex: 20,
        }}
        onClick={() => handleCitaClick(apt)}
        onMouseEnter={(e) => {
          if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
          setCitaTooltip({ visible: true, x: e.clientX, y: e.clientY, cita: apt });
        }}
        onMouseLeave={() => {
          if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
          tooltipTimeoutRef.current = setTimeout(() => {
            setCitaTooltip({ visible: false, x: 0, y: 0, cita: null });
          }, 300);
        }}
      >
        {isPrecita && (
          <div style={{ color: statusInfo.color, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 1 }}>
            Pre-cita
          </div>
        )}
        <div style={{ fontSize: 11, fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {clienteNombre}
        </div>
        <div style={{ fontSize: 10, fontWeight: 500, color: statusInfo.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {serviceText}
        </div>
        {position.height >= 58 && (
          <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 2 }}>
            {fmtH(startH)} – {fmtH(endH)}
          </div>
        )}
        {(isPaid || hasAbono) && (
          <div className="absolute flex gap-0.5" style={{ top: 6, right: 6 }}>
            {isPaid   && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />}
            {hasAbono && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />}
          </div>
        )}
      </div>
    );
  });

  const BloqueoComponent = React.memo(({ bloqueo }: { bloqueo: BloqueoCalendario }) => {
    const position = getBloqueoPosition(bloqueo);
    if (!position) return null;

    const motivo = bloqueo.motivo?.trim() || "Bloqueo de agenda";
    const profesional = profesionales.find(
      (item) => item.estilista.profesional_id === bloqueo.profesional_id
    );
    const initials = profesional?.initials || "--";

    return (
      <div
        className="absolute z-8 rounded-md border border-gray-300/70 bg-gradient-to-b from-gray-100 to-gray-50 shadow-sm overflow-hidden pointer-events-auto group"
        style={{ ...position, minHeight: 32 }}
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
        <div className="h-full w-full px-1.5 py-1 flex flex-col overflow-hidden">
          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-800 truncate">
            Bloq · {initials}
          </div>
          <div className="text-[9px] leading-3.5 font-medium text-gray-700 truncate" title={motivo}>
            {motivo}
          </div>
          <div className="mt-auto text-[8px] leading-3 text-gray-600 truncate">
            {`${bloqueo.hora_inicio}-${bloqueo.hora_fin}`}
          </div>
        </div>
      </div>
    );
  });

  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ── Top bar ───────────────────────────────────────────────────── */}
        <div
          className="shrink-0 flex flex-col md:flex-row md:justify-between md:items-center bg-white gap-2 px-4 py-3 md:px-[22px] md:py-[14px]"
          style={{ borderBottom: '1px solid #E2E8F0' }}
        >
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: '#1E293B', letterSpacing: '-.3px' }}>
              Agenda
            </h1>
            <div className="text-xs mt-0.5" style={{ color: '#64748B' }}>
              {selectedDate.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}
              {' · '}{selectedSede?.nombre || 'Selecciona una sede'}
              {(loading || loadingBloqueos) && ' · Actualizando...'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-0.5 rounded-lg"
              style={{ background: '#F8FAFC', padding: 3, position: 'relative' }}
            >
              <button
                onClick={() => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; })}
                className="flex items-center rounded-md transition-colors"
                style={{ padding: '5px 7px', color: '#64748B' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#E2E8F0')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowDatePicker(v => !v)}
                className="text-xs font-medium transition-colors rounded-md"
                style={{ padding: '5px 10px', color: '#334155', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#E2E8F0')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {todayLabel}
              </button>
              <button
                onClick={() => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; })}
                className="flex items-center rounded-md transition-colors"
                style={{ padding: '5px 7px', color: '#64748B' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#E2E8F0')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {showDatePicker && (
                <AgendaDatePicker
                  selectedDate={selectedDate}
                  today={today}
                  onSelect={(date) => {
                    setSelectedDate(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
                  }}
                  onClose={() => setShowDatePicker(false)}
                />
              )}
            </div>

            <select
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white shadow-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 transition-all"
              value={selectedSede?._id || ''}
              onChange={(e) => {
                const sede = sedes.find(s => s._id === e.target.value);
                setSelectedSede(sede || null);
                if (sede?.sede_id) setActiveSedeId(sede.sede_id);
              }}
            >
              <option value="">Sede...</option>
              {sedes.map(sede => (
                <option key={sede._id} value={sede._id}>
                  {formatSedeNombre(sede.nombre)}
                </option>
              ))}
            </select>

            <button
              onClick={() => { setSelectedCell(null); setShowAppointmentModal(true); }}
              className="flex items-center gap-1.5 text-white rounded-lg text-xs font-medium transition-colors"
              style={{ padding: '9px 16px', background: '#1E293B' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#334155')}
              onMouseLeave={e => (e.currentTarget.style.background = '#1E293B')}
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva cita
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* CALENDARIO PRINCIPAL */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* ── Summary bar ─────────────────────────────────────────────── */}
            <div
              className="shrink-0 flex flex-wrap gap-5 text-xs bg-white"
              style={{ padding: '8px 22px', borderBottom: '1px solid #F1F5F9', color: '#64748B' }}
            >
              <span><b className="font-semibold" style={{ color: '#1E293B' }}>{rfActiveApts.length}</b> citas</span>
              <span><b className="font-semibold" style={{ color: '#9CA3AF' }}>{rfSummary.pre}</b> pre-citas</span>
              <span><b className="font-semibold" style={{ color: '#3B82F6' }}>{rfSummary.confirmed}</b> confirmadas</span>
              <span><b className="font-semibold" style={{ color: '#8B5CF6' }}>{rfSummary.inProgress}</b> en curso</span>
              <span className="ml-auto"><b className="font-semibold" style={{ color: '#1E293B' }}>{formatCOP(rfSummary.total)}</b> estimado</span>
            </div>

            <div ref={calendarViewportRef} className="flex-1 overflow-auto bg-white">
              <div className="min-w-max" style={{ minWidth: `${calendarMinWidth}px` }}>
                {/* ENCABEZADO DE ESTILISTAS */}
                <div
                  className="flex sticky top-0 z-30 bg-white"
                  style={{ borderBottom: '1px solid #E2E8F0' }}
                >
                  <div style={{ width: TIME_COLUMN_WIDTH, flexShrink: 0, borderRight: '1px solid #F1F5F9' }} />
                  {profesionales.length > 0 ? (
                    <div className="flex" style={{ width: `${professionalsTrackWidth}px` }}>
                      {profesionales.map((prof) => (
                        <div
                          key={prof.estilista.unique_key}
                          className="flex items-center justify-center gap-1.5 shrink-0"
                          style={{
                            width: `${effectiveCellWidth}px`,
                            height: 52,
                            borderRight: '1px solid #F1F5F9',
                            padding: '0 6px',
                          }}
                        >
                          <div
                            className="flex items-center justify-center shrink-0 rounded-full text-white"
                            style={{ width: 30, height: 30, background: '#1E293B', fontSize: 10, fontWeight: 700 }}
                          >
                            {prof.initials}
                          </div>
                          <div className="overflow-hidden">
                            <div className="truncate" style={{ fontSize: 11, fontWeight: 600, color: '#1E293B' }}>
                              {prof.name}
                            </div>
                            <div style={{ fontSize: 9, color: '#94A3B8' }}>
                              {appointments.filter(apt => apt.profesional_id === prof.estilista.profesional_id).length} citas
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center py-4">
                      <span className="text-sm" style={{ color: '#64748B' }}>
                        {selectedSede ? 'No hay estilistas en esta sede' : 'Selecciona una sede'}
                      </span>
                    </div>
                  )}
                </div>

                {profesionales.length > 0 && (
                  <div className="relative">
                    {HOURS.map((hour) => (
                      <div
                        key={hour}
                        className="flex relative"
                        style={{ borderBottom: '1px solid #F1F5F9' }}
                      >
                        <div
                          className="shrink-0 sticky left-0 z-10 bg-white"
                          style={{
                            width: TIME_COLUMN_WIDTH,
                            height: CELL_HEIGHT,
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'flex-end',
                            paddingRight: 10,
                            paddingTop: 4,
                            borderRight: '1px solid #F1F5F9',
                          }}
                        >
                          <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 500 }}>
                            {hourLabelFromStr(hour)}
                          </span>
                        </div>
                        {profesionales.map((prof) => (
                          <CalendarCell key={`${hour}-${prof.estilista.unique_key}`} prof={prof} hour={hour} />
                        ))}
                      </div>
                    ))}

                    {/* BLOQUEOS */}
                    <div
                      className="absolute top-0 right-0 bottom-0 z-10 pointer-events-none"
                      style={{ left: `${TIME_COLUMN_WIDTH}px` }}
                    >
                      {bloqueos.map((bloqueo) => (
                        <BloqueoComponent key={`bloqueo-${bloqueo._id}`} bloqueo={bloqueo} />
                      ))}
                    </div>

                    {/* CITAS */}
                    <div
                      className="absolute top-0 right-0 bottom-0 z-0 pointer-events-none"
                      style={{ left: `${TIME_COLUMN_WIDTH}px` }}
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

            {/* ── Legend ────────────────────────────────────────────────── */}
            <div
              className="shrink-0 flex flex-wrap gap-4 bg-white"
              style={{ padding: '10px 22px', borderTop: '1px solid #F1F5F9', fontSize: 10, color: '#64748B' }}
            >
              <span className="flex items-center gap-1">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#9CA3AF', opacity: .6, display: 'inline-block' }} />
                Pre-cita
              </span>
              <span className="flex items-center gap-1">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#3B82F6', display: 'inline-block' }} />
                Confirmada
              </span>
              <span className="flex items-center gap-1">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#8B5CF6', display: 'inline-block' }} />
                En curso
              </span>
              <span className="flex items-center gap-1">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#10B981', display: 'inline-block' }} />
                Facturada
              </span>
              <span className="flex items-center gap-1">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#EF4444', display: 'inline-block' }} />
                Cancelada
              </span>
              <span className="flex items-center gap-1">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#CA8A04', display: 'inline-block' }} />
                No asistió
              </span>
              <span className="flex items-center gap-1">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
                Pagado
              </span>
              <span className="flex items-center gap-1">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
                Abono parcial
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel overlay ───────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{
          background: 'rgba(0,0,0,.15)',
          opacity: showAppointmentDetails ? 1 : 0,
          pointerEvents: showAppointmentDetails ? 'auto' : 'none',
        }}
        onClick={() => { setShowAppointmentDetails(false); setSelectedAppointment(null); }}
      />
      <div
        className="fixed top-0 right-0 bottom-0 bg-white flex flex-col z-50"
        style={{
          width: 460,
          boxShadow: '-8px 0 30px rgba(0,0,0,.08)',
          transform: showAppointmentDetails ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform .25s ease',
        }}
      >
        {showAppointmentDetails && selectedAppointment && (
          <AppointmentDetailsModal
            open={true}
            onClose={() => { setShowAppointmentDetails(false); setSelectedAppointment(null); }}
            appointment={selectedAppointment}
            onRefresh={() => {
              if (selectedSede) {
                const cacheKey = `citas_${selectedSede.sede_id}_${selectedDateString}`;
                dataCacheRef.current.delete(cacheKey);
              }
              cargarCitas();
              setRefreshTrigger(prev => prev + 1);
            }}
            panelMode={true}
          />
        )}
      </div>

      {/* TOOLTIP DE CITA */}
      {citaTooltip.visible && citaTooltip.cita && (
        <div
          className="pointer-events-none fixed z-50 bg-white rounded-xl shadow-lg p-2.5 max-w-[18rem] -translate-y-1/2"
          style={{
            left: `${getTooltipLeft(citaTooltip.x, CITA_TOOLTIP_WIDTH)}px`,
            top: `${citaTooltip.y}px`,
            border: '1px solid #E2E8F0',
          }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#1E293B' }}>
              <User className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-[13px] truncate" style={{ color: '#1E293B' }}>
                {citaTooltip.cita.cliente_nombre}
              </h3>
              <p className="text-xs truncate" style={{ color: '#64748B' }}>
                {citaTooltip.cita.start} – {citaTooltip.cita.end}
              </p>
            </div>
          </div>
          <div className="space-y-1" style={{ fontSize: 11, color: '#475569' }}>
            <div>{citaTooltip.cita.servicio_nombre}</div>
            <div style={{ color: '#64748B' }}>{citaTooltip.cita.estilista_nombre}</div>
          </div>
          {(() => {
            const rfSt = resolveRFStatus(citaTooltip.cita.estado);
            const si = RF_STATUSES[rfSt];
            return (
              <div
                className="inline-flex items-center gap-1 rounded-full text-[10px] font-medium mt-2"
                style={{ padding: '3px 8px', background: si.bg, color: si.color }}
              >
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: si.color }} />
                {si.label}
              </div>
            );
          })()}
        </div>
      )}

      {/* MODALES - EXACTAMENTE IGUAL */}
      {showBloqueoModal && (
        <Modal open={showBloqueoModal} onClose={handleClose} title="Bloqueo de horario">
          <Bloqueos
            onClose={handleBloqueoCreado}
            estilistaId={selectedCell?.estilista.profesional_id}
            fecha={selectedDateString}
            horaInicio={selectedCell?.hora}
          />
        </Modal>
      )}

      {showAppointmentModal && (
        <Modal open={showAppointmentModal} onClose={handleClose} title="Nueva Cita" className="w-full max-w-[70vw] max-h-[85vh]">
          <div className="">
            <AppointmentScheduler
              sedeId={sedeIdActual}
              estilistaId={selectedCell?.estilista.profesional_id}
              fecha={selectedDateString}
              horaSeleccionada={selectedCell?.hora}
              estilistas={estilistas}
              onClose={handleCitaCreada}
            />
          </div>
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
