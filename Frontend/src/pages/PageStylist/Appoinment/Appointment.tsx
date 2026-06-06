// src/components/EstilistaDashboard.tsx - Mobile First
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  // Clock,
  CreditCard,
} from "lucide-react";
import StylistBottomNav from "../../../components/Layout/StylistBottomNav";
import { useAuth } from "../../../components/Auth/AuthContext";
import { useEstilistaData } from "./useEstilistaData";
import { AppointmentsList } from "./appointments-list";
import { StylistStats } from "./stylist-stats";
import { AttentionProtocol } from "./attention-protocol";
import BloqueosModal from "../../../components/Quotes/Bloqueos";
import BottomSheet from "../../../components/ui/bottom-sheet";
import { getBloqueosProfesional, Bloqueo } from "../../../components/Quotes/bloqueosApi";
import { formatDateDMY } from "../../../lib/dateFormat";

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const DAY_NAMES = ["D", "L", "M", "M", "J", "V", "S"];

type DayCell = {
  iso: string | null;
  day: number | null;
  isCurrentMonth: boolean;
};

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeFecha = (fecha?: string) => {
  if (!fecha) return "";
  if (fecha.includes("T")) return fecha.split("T")[0];
  if (fecha.includes(" ")) return fecha.split(" ")[0];
  return fecha;
};

const buildMonthGrid = (cursor: Date): DayCell[] => {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDayWeek = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const cells: DayCell[] = [];

  for (let i = 0; i < firstDayWeek; i += 1) {
    cells.push({ iso: null, day: null, isCurrentMonth: false });
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(year, month, day);
    cells.push({
      iso: toIsoDate(date),
      day,
      isCurrentMonth: true,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ iso: null, day: null, isCurrentMonth: false });
  }

  return cells;
};

const getAuthToken = () => {
  return localStorage.getItem("access_token") || sessionStorage.getItem("access_token") || "";
};

const parseMinutes = (hora: string) => {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
};

const normalizeSedeId = (value: string | null | undefined): string => String(value ?? "").trim();

/*
const formatHoyTitulo = (isoDate: string) => {
  const [yearStr, monthStr, dayStr] = isoDate.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  return `Hoy - ${day} ${MONTH_NAMES[month - 1]} ${year}`;
};

const getEstadoUI = (estado?: string) => {
  const value = (estado || "pendiente").toLowerCase().trim();

  if (value.includes("finaliz") || value.includes("complet")) {
    return { label: "Finalizada", className: "bg-gray-100 text-gray-700" };
  }
  if (value.includes("proceso") || value.includes("curso")) {
    return { label: "En proceso", className: "bg-gray-100 text-gray-700" };
  }
  if (value.includes("cancel")) {
    return { label: "Cancelada", className: "bg-gray-100 text-gray-700" };
  }
  return { label: "Pendiente", className: "bg-gray-100 text-gray-700" };
};
*/

// Helper: calcular precio total de cita
const calcularPrecioTotalCita = (cita: any): number => {
  const valor =
    cita.valor_total ||
    cita.precio_total ||
    0;

  if (valor > 1) return valor;

  if (cita.servicios && Array.isArray(cita.servicios) && cita.servicios.length > 0) {
    const total = cita.servicios.reduce((total: number, servicio: any) => {
      const subtotal = servicio.subtotal ?? servicio.precio ?? servicio.precio_local ?? 0;
      return total + subtotal;
    }, 0);
    if (total > 0) return total;
  }
  if (cita.servicio?.precio) return cita.servicio.precio;
  return valor;
};

// Helper: obtener nombres de servicios
const obtenerNombresServicios = (cita: any): string => {
  if (cita.servicios && Array.isArray(cita.servicios) && cita.servicios.length > 0) {
    return cita.servicios.map((s: any) => s.nombre).join(", ");
  }
  if (cita.servicio?.nombre) return cita.servicio.nombre;
  return "Sin servicio";
};

export default function VistaEstilistaPage() {
  const { user, activeSedeId, setActiveSedeId } = useAuth();
  // const { citas, loading, error, refetchCitas } = useEstilistaData();
  const {
    citas,
    refetchCitas,
    comisionServiciosPct,
    comisionProductosPct,
    comisionesTotalesHoy,
  } = useEstilistaData();

  const [citaSeleccionada, setCitaSeleccionada] = useState<any>(null);
  const [bloqueos, setBloqueos] = useState<Bloqueo[]>([]);
  const [profesionalId, setProfesionalId] = useState<string>("");
  const [refrescarBloqueos, setRefrescarBloqueos] = useState(0);
  const [loadingBloqueos, setLoadingBloqueos] = useState(false);
  const [showCrearBloqueo, setShowCrearBloqueo] = useState(false);

  const todayIso = useMemo(() => toIsoDate(new Date()), []);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [monthCursor, setMonthCursor] = useState<Date>(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });

  const allowedSedeIds = useMemo(() => {
    const ids = new Set<string>();

    const addSedeId = (value: string | null | undefined) => {
      const normalized = normalizeSedeId(value);
      if (normalized) ids.add(normalized);
    };

    addSedeId(user?.sede_id_principal);
    addSedeId(user?.sede_id);
    addSedeId(activeSedeId);

    if (Array.isArray(user?.sedes_permitidas)) {
      user.sedes_permitidas.forEach((sedeId) => addSedeId(sedeId));
    }

    return Array.from(ids);
  }, [activeSedeId, user?.sede_id, user?.sede_id_principal, user?.sedes_permitidas]);

  const selectedSedeId = useMemo(() => {
    const active = normalizeSedeId(activeSedeId);
    if (active) return active;
    const current = normalizeSedeId(user?.sede_id);
    if (current) return current;
    return allowedSedeIds[0] || "";
  }, [activeSedeId, user?.sede_id, allowedSedeIds]);

  useEffect(() => {
    if (!selectedSedeId) return;
    if (selectedSedeId === normalizeSedeId(activeSedeId)) return;
    setActiveSedeId(selectedSedeId);
  }, [activeSedeId, selectedSedeId, setActiveSedeId]);

  useEffect(() => {
    const obtenerProfesionalId = () => {
      if (citas.length > 0) {
        const citaConProfesional = citas.find((cita) => cita.profesional_id);
        if (citaConProfesional?.profesional_id) {
          return citaConProfesional.profesional_id;
        }
      }

      try {
        const userData = localStorage.getItem("user") || sessionStorage.getItem("user");
        if (userData) {
          const user = JSON.parse(userData);
          if (user.profesional_id) return user.profesional_id;
        }

        const profesionalIdStorage =
          localStorage.getItem("beaux-profesional_id") || sessionStorage.getItem("beaux-profesional_id");
        return profesionalIdStorage || "";
      } catch (parseError) {
        console.error("Error obteniendo profesional_id:", parseError);
        return "";
      }
    };

    setProfesionalId(obtenerProfesionalId());
  }, [citas]);

  useEffect(() => {
    const cargarBloqueos = async () => {
      if (!profesionalId) return;

      try {
        const token = getAuthToken();
        if (!token) {
          setBloqueos([]);
          return;
        }

        setLoadingBloqueos(true);
        const bloqueosData = await getBloqueosProfesional(profesionalId, token);
        setBloqueos(Array.isArray(bloqueosData) ? bloqueosData : []);
      } catch (loadError) {
        console.error("Error cargando bloqueos:", loadError);
        setBloqueos([]);
      } finally {
        setLoadingBloqueos(false);
      }
    };

    cargarBloqueos();
  }, [profesionalId, refrescarBloqueos]);

  const monthCells = useMemo(() => buildMonthGrid(monthCursor), [monthCursor]);

  const citasHoy = useMemo(() => {
    return citas
      .filter((cita) => normalizeFecha(cita.fecha) === todayIso)
      .sort((a, b) => parseMinutes(a.hora_inicio) - parseMinutes(b.hora_inicio));
  }, [citas, todayIso]);

  const citasDiaSeleccionado = useMemo(() => {
    return citas
      .filter((cita) => normalizeFecha(cita.fecha) === selectedDate)
      .sort((a, b) => parseMinutes(a.hora_inicio) - parseMinutes(b.hora_inicio));
  }, [citas, selectedDate]);

  const bloqueosDiaSeleccionado = useMemo(() => {
    return bloqueos.filter((bloqueo) => normalizeFecha(bloqueo.fecha) === selectedDate);
  }, [bloqueos, selectedDate]);

  const fechasConCitas = useMemo(() => {
    const fechas = new Set<string>();
    citas.forEach((cita) => {
      const fecha = normalizeFecha(cita.fecha);
      if (fecha) fechas.add(fecha);
    });
    return fechas;
  }, [citas]);

  const fechasConBloqueos = useMemo(() => {
    const fechas = new Set<string>();
    bloqueos.forEach((bloqueo) => {
      const fecha = normalizeFecha(bloqueo.fecha);
      if (fecha) fechas.add(fecha);
    });
    return fechas;
  }, [bloqueos]);

  const estaCompletada = (cita: any): boolean => {
    if (!cita.estado) return false;
    const estado = cita.estado.toLowerCase().trim();
    return [
      "completado",
      "completada",
      "finalizado",
      "finalizada",
      "terminado",
      "terminada",
      "realizado",
      "realizada",
      "concluido",
      "concluida",
    ].some((estadoCompleto) => estado.includes(estadoCompleto));
  };

  const ingresosHoy = useMemo(() => {
    return citasHoy.filter((cita) => estaCompletada(cita)).reduce((total, cita) => total + calcularPrecioTotalCita(cita), 0);
  }, [citasHoy]);

  const handleBloqueoActualizado = (bloqueoActualizado: Bloqueo) => {
    if (!bloqueoActualizado._id) return;
    setBloqueos((prev) =>
      prev.map((bloqueo) =>
        bloqueo._id === bloqueoActualizado._id ? { ...bloqueo, ...bloqueoActualizado } : bloqueo
      )
    );
  };

  const handleBloqueoCreado = (bloqueoCreado: Bloqueo) => {
    setBloqueos((prev) => {
      if (!bloqueoCreado._id) return [...prev, bloqueoCreado];
      const existe = prev.some((item) => item._id === bloqueoCreado._id);
      if (existe) {
        return prev.map((item) => (item._id === bloqueoCreado._id ? { ...item, ...bloqueoCreado } : item));
      }
      return [...prev, bloqueoCreado];
    });
  };

  const refrescarListaBloqueos = (bloqueoId?: string) => {
    if (bloqueoId) {
      setBloqueos((prev) => prev.filter((bloqueo) => bloqueo._id !== bloqueoId));
      return;
    }
    setRefrescarBloqueos((prev) => prev + 1);
  };

  /*
  const handleRetryData = () => {
    refetchCitas();
    setRefrescarBloqueos((prev) => prev + 1);
  };
  */

  const irMesAnterior = () => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const irMesSiguiente = () => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const abrirBloqueoDelDia = () => {
    if (!selectedDate) return;
    setShowCrearBloqueo(true);
  };

  return (
    <>
      <div className="min-h-screen w-full max-w-[480px] mx-auto overflow-x-hidden bg-gray-50 pb-24">
        <header className="sticky top-0 z-40 border-b border-gray-200 bg-white px-4">
          <div className="flex h-16 items-center">
            <h1 className="truncate text-2xl font-bold text-gray-900">RF Salon Agent</h1>
          </div>
        </header>

        <main className="space-y-4 px-4 pt-4 pb-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Resumen rápido del día</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">Citas hoy</p>
                <p className="text-base font-semibold text-gray-900">{citasHoy.length}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">Ingresos hoy</p>
                <p className="text-base font-semibold text-gray-900">${ingresosHoy.toLocaleString()}</p>
              </div>
            </div>
          </section>

          {/*
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-600" />
              <h2 className="text-sm font-semibold text-gray-900">{formatHoyTitulo(todayIso)}</h2>
            </div>

            {loading && (
              <div className="space-y-2">
                <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
                <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
              </div>
            )}

            {!loading && error && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-sm font-medium text-gray-800">No se pudieron cargar las citas</p>
                <p className="mt-1 text-xs text-gray-600">{error}</p>
                <button
                  type="button"
                  onClick={handleRetryData}
                  className="mt-3 h-11 w-full rounded-xl bg-gray-900 text-sm font-medium text-white"
                >
                  Reintentar
                </button>
              </div>
            )}

            {!loading && !error && citasHoy.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
                <p className="text-sm font-medium text-gray-700">No tienes citas hoy</p>
              </div>
            )}

            {!loading && !error && citasHoy.length > 0 && (
              <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                {citasHoy.map((cita) => {
                  const cliente = `${cita.cliente?.nombre || "Cliente"} ${cita.cliente?.apellido || ""}`.trim();
                  const servicio = obtenerNombresServicios(cita);
                  const estadoUi = getEstadoUI(cita.estado);
                  return (
                    <div key={cita.cita_id} className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">
                          {cita.hora_inicio} - {cita.hora_fin}
                        </p>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${estadoUi.className}`}>
                          {estadoUi.label}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-gray-800">{cliente}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-600">{servicio}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          */}

          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Calendario de citas</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={irMesAnterior}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={irMesSiguiente}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700"
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <p className="mb-3 text-sm font-medium text-gray-700">
              {MONTH_NAMES[monthCursor.getMonth()]} {monthCursor.getFullYear()}
            </p>

            <div className="grid grid-cols-7 gap-2 text-sm">
              {DAY_NAMES.map((day, idx) => (
                <div key={`${day}-${idx}`} className="text-center text-[11px] font-medium text-gray-500">
                  {day}
                </div>
              ))}

              {monthCells.map((cell, index) => {
                if (!cell.iso || !cell.day) {
                  return <div key={`empty-${index}`} className="aspect-square rounded-lg bg-gray-50" />;
                }

                const isSelected = cell.iso === selectedDate;
                const isToday = cell.iso === todayIso;
                const hasCita = fechasConCitas.has(cell.iso);
                const hasBloqueo = fechasConBloqueos.has(cell.iso);

                return (
                  <button
                    key={cell.iso}
                    type="button"
                    onClick={() => {
                      setSelectedDate(cell.iso || todayIso);
                      setCitaSeleccionada(null);
                    }}
                    className={`relative aspect-square rounded-lg border text-sm font-medium ${
                      isSelected
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-800"
                    } ${isToday && !isSelected ? "ring-1 ring-gray-300" : ""}`}
                  >
                    <span>{cell.day}</span>

                    {(hasCita || hasBloqueo) && (
                      <span className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-1">
                        {hasBloqueo && (
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isSelected ? "bg-gray-300 ring-1 ring-white/70" : "bg-gray-400"
                            }`}
                          />
                        )}
                        {hasCita && (
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isSelected ? "bg-black ring-1 ring-white/80" : "bg-gray-900"
                            }`}
                          />
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 border-t border-gray-200 pt-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-gray-900">
                    Agenda del {formatDateDMY(selectedDate)}
                  </h3>
                  <p className="text-xs text-gray-500">Gestiona citas y bloqueos del día seleccionado</p>
                </div>
                {selectedDate && (
                  <button
                    type="button"
                    onClick={abrirBloqueoDelDia}
                    className="h-11 shrink-0 rounded-xl bg-gray-900 px-3 text-xs font-medium text-white"
                  >
                    Bloqueo
                  </button>
                )}
              </div>

              {loadingBloqueos && (
                <div className="mb-2 rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-600">
                  Sincronizando bloqueos...
                </div>
              )}

              <AppointmentsList
                appointments={citasDiaSeleccionado}
                bloqueos={bloqueosDiaSeleccionado}
                onCitaSelect={setCitaSeleccionada}
                citaSeleccionada={citaSeleccionada}
                fechaFiltro={selectedDate}
                citasValidacion={citas}
                onBloqueoEliminado={refrescarListaBloqueos}
                onBloqueoActualizado={handleBloqueoActualizado}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-gray-600" />
              <h2 className="text-sm font-semibold text-gray-900">Comisiones</h2>
            </div>
            <StylistStats
              citasHoy={citasHoy.length}
              serviciosCompletadosHoy={citasHoy.filter((cita) => estaCompletada(cita)).length}
              totalVentasHoy={ingresosHoy}
              comisionServiciosPct={comisionServiciosPct}
              comisionProductosPct={comisionProductosPct}
              comisionesTotalesHoy={comisionesTotalesHoy}
              bloqueosHoy={bloqueos.filter((bloqueo) => normalizeFecha(bloqueo.fecha) === todayIso).length}
            />
          </section>
        </main>

        <BottomSheet
          open={showCrearBloqueo}
          onClose={() => setShowCrearBloqueo(false)}
          title="Bloquear horario"
        >
          <BloqueosModal
            onClose={() => setShowCrearBloqueo(false)}
            compact
            estilistaId={profesionalId}
            fecha={selectedDate}
            editingBloqueo={null}
            citasExistentes={citas}
            onBloqueoGuardado={(bloqueo, action) => {
              if (action === "create") {
                handleBloqueoCreado(bloqueo);
              }
            }}
          />
        </BottomSheet>

        <BottomSheet
          open={Boolean(citaSeleccionada)}
          onClose={() => setCitaSeleccionada(null)}
          title="Protocolo de atención"
        >
          {citaSeleccionada && (
            <AttentionProtocol
              citaSeleccionada={citaSeleccionada}
              onVolver={() => setCitaSeleccionada(null)}
              onFinalizarServicio={() => {
                refetchCitas();
                setCitaSeleccionada(null);
              }}
              onFechaSeleccionada={(fecha) => {
                if (!fecha) return;
                setSelectedDate(fecha);
              }}
              usuarioRol="estilista"
            />
          )}
        </BottomSheet>
      </div>

      {/* Navegación inferior persistente para estilista */}
      <StylistBottomNav active="agenda" />
    </>
  );
}

export { calcularPrecioTotalCita, obtenerNombresServicios };
