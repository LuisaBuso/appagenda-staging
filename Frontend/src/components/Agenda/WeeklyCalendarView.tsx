import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";

const START_HOUR = 5;
const END_HOUR = 19;
const CELL_HEIGHT = 68;
const SLOT_INTERVAL_MINUTES = 60;
const TIME_COLUMN_WIDTH = 56;
const MIN_APPOINTMENT_HEIGHT = 32;

const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => {
  const hour = START_HOUR + i;
  return `${hour.toString().padStart(2, "0")}:00`;
});

const DAY_NAMES_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const RF_STATUSES: Record<string, { color: string; bg: string; label: string }> = {
  "pre-cita": { color: "#9CA3AF", bg: "#F3F4F6", label: "Pre-cita" },
  confirmed: { color: "#3B82F6", bg: "#EFF6FF", label: "Confirmada" },
  "in-progress": { color: "#8B5CF6", bg: "#F5F3FF", label: "En curso" },
  finalizado: { color: "#F97316", bg: "#FFF7ED", label: "Finalizado" },
  completed: { color: "#10B981", bg: "#ECFDF5", label: "Facturada" },
  cancelled: { color: "#EF4444", bg: "#FEF2F2", label: "Cancelada" },
  "no-asistio": { color: "#CA8A04", bg: "#FEFCE8", label: "No asistió" },
};

const resolveRFStatus = (estado: string): string => {
  const v = (estado || "").toLowerCase().trim();
  if (v.includes("cancel")) return "cancelled";
  if (v === "no_asistio" || v === "no asistio" || v.includes("no_asistio") || v.includes("no asistio")) return "no-asistio";
  if (["pre-cita", "pre_cita", "precita", "pre_reservada"].some((s) => v.includes(s))) return "pre-cita";
  if (["en proc", "en_proc", "proceso", "en curso", "en_curso", "en-curso", "progres", "in-prog"].some((s) => v.includes(s))) return "in-progress";
  if (["finaliz"].some((s) => v.includes(s))) return "finalizado";
  if (["complet", "terminad", "realizad", "factur"].some((s) => v.includes(s))) return "completed";
  return "confirmed";
};

const fmtH = (hour: number): string => {
  const h = Math.floor(hour);
  const m = Math.round((hour % 1) * 60);
  const ap = h >= 12 ? "p.m." : "a.m.";
  const d = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${d}:${m === 0 ? "00" : String(m).padStart(2, "0")} ${ap}`;
};

const hourLabelFromStr = (hourStr: string): string => {
  const h = parseInt(hourStr.split(":")[0], 10);
  const d = h > 12 ? h - 12 : h;
  return `${d}:00`;
};

const shortName = (name: string): string =>
  name.trim().split(" ").filter(Boolean).slice(0, 2).join(" ");

const formatDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export interface WeeklyCita {
  id: string;
  cliente_nombre: string;
  servicio_nombre: string;
  estilista_nombre: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
  profesional_id?: string;
  rawData?: any;
}

interface WeeklyCalendarViewProps {
  weekDays: Date[];
  today: Date;
  citasByDay: Record<string, WeeklyCita[]>;
  loading: boolean;
  onCitaClick: (cita: WeeklyCita) => void;
}

interface LayoutInfo {
  column: number;
  columns: number;
}

const computeOverlapLayout = (citas: WeeklyCita[]): Map<string, LayoutInfo> => {
  const layoutMap = new Map<string, LayoutInfo>();
  if (!citas.length) return layoutMap;

  const items = citas
    .map((c) => {
      const [sh, sm] = c.hora_inicio.split(":").map(Number);
      const [eh, em] = c.hora_fin.split(":").map(Number);
      if ([sh, sm, eh, em].some(Number.isNaN)) return null;
      const start = (sh - START_HOUR) * 60 + sm;
      const end = (eh - START_HOUR) * 60 + em;
      if (end <= start) return null;
      return { id: c.id, start, end };
    })
    .filter(Boolean) as { id: string; start: number; end: number }[];

  items.sort((a, b) => a.start - b.start || a.end - b.end);

  let group: typeof items = [];
  let groupEnd = -Infinity;

  const commitGroup = () => {
    if (!group.length) return;
    const columnsEnd: number[] = [];
    const assigned = new Map<string, number>();
    group.forEach((item) => {
      let col = columnsEnd.findIndex((ce) => ce <= item.start);
      if (col === -1) {
        col = columnsEnd.length;
        columnsEnd.push(item.end);
      } else {
        columnsEnd[col] = item.end;
      }
      assigned.set(item.id, col);
    });
    const totalCols = Math.max(columnsEnd.length, 1);
    group.forEach((item) => {
      layoutMap.set(item.id, {
        column: assigned.get(item.id) ?? 0,
        columns: totalCols,
      });
    });
  };

  items.forEach((item) => {
    if (!group.length) {
      group = [item];
      groupEnd = item.end;
      return;
    }
    if (item.start < groupEnd) {
      group.push(item);
      groupEnd = Math.max(groupEnd, item.end);
    } else {
      commitGroup();
      group = [item];
      groupEnd = item.end;
    }
  });
  commitGroup();

  return layoutMap;
};

const WeeklyCalendarView: React.FC<WeeklyCalendarViewProps> = ({
  weekDays,
  today,
  citasByDay,
  loading,
  onCitaClick,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver !== "undefined") {
      const obs = new ResizeObserver(update);
      obs.observe(el);
      return () => obs.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const dayColumnWidth = useMemo(() => {
    const available = Math.max(viewportWidth - TIME_COLUMN_WIDTH, 0);
    if (available <= 0) return 120;
    return Math.max(available / 7, 80);
  }, [viewportWidth]);

  const totalGridWidth = useMemo(
    () => Math.max(TIME_COLUMN_WIDTH + dayColumnWidth * 7, viewportWidth),
    [dayColumnWidth, viewportWidth],
  );

  const todayKey = formatDateKey(today);

  const layoutsByDay = useMemo(() => {
    const result: Record<string, Map<string, LayoutInfo>> = {};
    weekDays.forEach((day) => {
      const key = formatDateKey(day);
      const dayCitas = citasByDay[key] || [];
      result[key] = computeOverlapLayout(dayCitas);
    });
    return result;
  }, [weekDays, citasByDay]);

  const handleCitaClickInternal = useCallback(
    (cita: WeeklyCita) => {
      onCitaClick(cita);
    },
    [onCitaClick],
  );

  return (
    <div ref={viewportRef} className="flex-1 overflow-auto bg-white">
      <div style={{ minWidth: `${totalGridWidth}px` }}>
        {/* Day headers */}
        <div
          className="flex sticky top-0 z-30 bg-white"
          style={{ borderBottom: "1px solid #E2E8F0" }}
        >
          <div
            style={{
              width: TIME_COLUMN_WIDTH,
              flexShrink: 0,
              borderRight: "1px solid #F1F5F9",
            }}
          />
          {weekDays.map((day) => {
            const key = formatDateKey(day);
            const isToday = key === todayKey;
            const dayName = DAY_NAMES_SHORT[day.getDay()];
            const dayNum = day.getDate();

            return (
              <div
                key={key}
                className="flex items-center justify-center shrink-0"
                style={{
                  width: `${dayColumnWidth}px`,
                  height: 52,
                  borderRight: "1px solid #F1F5F9",
                  background: isToday ? "#F8FAFC" : "transparent",
                }}
              >
                <div className="text-center">
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: isToday ? "#1E293B" : "#94A3B8",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {dayName}
                  </div>
                  <div
                    className="flex items-center justify-center mx-auto"
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: isToday ? "#fff" : "#1E293B",
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: isToday ? "#1E293B" : "transparent",
                    }}
                  >
                    {dayNum}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Loading indicator */}
        {loading && (
          <div
            className="flex items-center justify-center py-8 text-sm"
            style={{ color: "#64748B" }}
          >
            Cargando citas de la semana...
          </div>
        )}

        {/* Hour rows */}
        {!loading && (
          <div className="relative">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="flex relative"
                style={{ borderBottom: "1px solid #F1F5F9" }}
              >
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
                  <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 500 }}>
                    {hourLabelFromStr(hour)}
                  </span>
                </div>
                {weekDays.map((day) => {
                  const key = formatDateKey(day);
                  const isToday = key === todayKey;
                  return (
                    <div
                      key={key}
                      style={{
                        width: `${dayColumnWidth}px`,
                        height: CELL_HEIGHT,
                        borderRight: "1px solid #F1F5F9",
                        background: isToday ? "rgba(30,41,59,.02)" : "transparent",
                      }}
                    />
                  );
                })}
              </div>
            ))}

            {/* Appointments overlay per day */}
            {weekDays.map((day, dayIndex) => {
              const key = formatDateKey(day);
              const dayCitas = citasByDay[key] || [];
              const dayLayout = layoutsByDay[key];
              if (!dayCitas.length) return null;

              return (
                <div
                  key={`overlay-${key}`}
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{
                    left: TIME_COLUMN_WIDTH + dayIndex * dayColumnWidth,
                    width: dayColumnWidth,
                  }}
                >
                  {dayCitas.map((cita) => {
                    const [sh, sm] = cita.hora_inicio.split(":").map(Number);
                    const [eh, em] = cita.hora_fin.split(":").map(Number);
                    if ([sh, sm, eh, em].some(Number.isNaN)) return null;

                    const startMin = (sh - START_HOUR) * 60 + sm;
                    const endMin = (eh - START_HOUR) * 60 + em;
                    const startBlock = startMin / SLOT_INTERVAL_MINUTES;
                    const endBlock = endMin / SLOT_INTERVAL_MINUTES;
                    const totalBlocks = endBlock - startBlock;

                    const layout = dayLayout?.get(cita.id);
                    const col = layout?.column ?? 0;
                    const cols = layout?.columns ?? 1;

                    const rfStatus = resolveRFStatus(cita.estado);
                    const statusInfo = RF_STATUSES[rfStatus] || RF_STATUSES.confirmed;
                    const isPrecita = rfStatus === "pre-cita";

                    const colWidth = (dayColumnWidth - 4) / cols;
                    const top = startBlock * CELL_HEIGHT + 2;
                    const height = Math.max(totalBlocks * CELL_HEIGHT - 4, MIN_APPOINTMENT_HEIGHT);
                    const left = 2 + col * colWidth;
                    const width = colWidth - 1;

                    const clienteNombre = shortName(cita.cliente_nombre || "(Sin nombre)");
                    const startH = sh + sm / 60;
                    const endH = eh + em / 60;

                    const totalCita = parseFloat(cita.rawData?.valor_total || "0") || 0;
                    const abonado = parseFloat(cita.rawData?.abono || "0") || 0;
                    const rawSaldo = parseFloat(cita.rawData?.saldo_pendiente);
                    const saldoCalc = isNaN(rawSaldo) ? Math.max(0, totalCita - abonado) : Math.max(0, rawSaldo);
                    const isPaid = saldoCalc <= 0 && totalCita > 0;
                    const hasAbono = abonado > 0 && !isPaid;

                    return (
                      <div
                        key={cita.id}
                        className="absolute cursor-pointer overflow-hidden transition-shadow hover:shadow-md pointer-events-auto"
                        style={{
                          left,
                          top,
                          width,
                          height,
                          background: statusInfo.bg,
                          borderLeft: `3px solid ${statusInfo.color}`,
                          borderRadius: 5,
                          padding: "3px 5px",
                          boxShadow: "0 1px 3px rgba(0,0,0,.04)",
                          opacity: isPrecita ? 0.75 : 1,
                          zIndex: 20,
                        }}
                        onClick={() => handleCitaClickInternal(cita)}
                      >
                        {isPrecita && (
                          <div
                            style={{
                              color: statusInfo.color,
                              fontSize: 7,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: ".4px",
                            }}
                          >
                            Pre-cita
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: "#1E293B",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {clienteNombre}
                        </div>
                        {height >= 44 && (
                          <div
                            style={{
                              fontSize: 9,
                              color: "#94A3B8",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {fmtH(startH)} – {fmtH(endH)}
                          </div>
                        )}
                        {(isPaid || hasAbono) && (
                          <div className="absolute flex gap-0.5" style={{ top: 3, right: 3 }}>
                            {isPaid && (
                              <div
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: "50%",
                                  background: "#10B981",
                                }}
                              />
                            )}
                            {hasAbono && (
                              <div
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: "50%",
                                  background: "#F59E0B",
                                }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(WeeklyCalendarView);

export const getWeekRange = (date: Date): { monday: Date; sunday: Date } => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, sunday };
};

export const getWeekDays = (monday: Date): Date[] => {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
};

export const formatWeekLabel = (monday: Date, sunday: Date): string => {
  const mDay = monday.getDate();
  const sDay = sunday.getDate();
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  if (monday.getMonth() === sunday.getMonth()) {
    return `${mDay} – ${sDay} ${months[monday.getMonth()]} ${monday.getFullYear()}`;
  }
  if (monday.getFullYear() === sunday.getFullYear()) {
    return `${mDay} ${months[monday.getMonth()]} – ${sDay} ${months[sunday.getMonth()]} ${monday.getFullYear()}`;
  }
  return `${mDay} ${months[monday.getMonth()]} ${monday.getFullYear()} – ${sDay} ${months[sunday.getMonth()]} ${sunday.getFullYear()}`;
};
