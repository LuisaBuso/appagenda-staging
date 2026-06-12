"use client"

import { useState, useEffect, useMemo } from "react";
import { Sidebar } from "../../../components/Layout/Sidebar";
import { useAuth } from "../../../components/Auth/AuthContext";
import { formatSedeNombre } from "../../../lib/sede";
import { formatDateDMY, toLocalYMD, formatLocalDate } from "../../../lib/dateFormat";
import { getSedes, getVentasAvailablePeriods, type Sede } from "./analyticsApi";
import { normalizeCurrencyCode, getStoredCurrency } from "../../../lib/currency";
import { RefreshCw, AlertCircle } from "lucide-react";
import { SedeDropdown } from "../../../components/ui/SedeDropdown";
import { Alert, AlertTitle, AlertDescription } from "../../../components/ui/alert";

import { DashboardSedeView } from "./DashboardSedeView";
import { PeriodoSelector, type PeriodoId } from "../../../components/ui/PeriodoSelector";

interface DateRange {
  start_date: string;
  end_date: string;
}

const MAX_CUSTOM_RANGE_DAYS = 365;

const normalizeSedeId = (value: string | null | undefined) =>
  String(value ?? "").trim();

export default function DashboardPage() {
  const { user, isAuthenticated, activeSedeId, setActiveSedeId } = useAuth();
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [loadingSedes, setLoadingSedes] = useState(true);
  const [selectedSede, setSelectedSede] = useState<string>("");
  const [periodoActivo, setPeriodoActivo] = useState<PeriodoId>("hoy");
  const [dateRange, setDateRange] = useState<DateRange>({ start_date: "", end_date: "" });
  const [rangoAplicado, setRangoAplicado] = useState<{ from: Date; to: Date } | undefined>(undefined);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const monedaUsuario = normalizeCurrencyCode(
    user?.moneda || getStoredCurrency("COP")
  );

  const allowedSedeIds = useMemo(() => {
    const values = new Set<string>();
    const add = (candidate: string | null | undefined) => {
      const normalized = normalizeSedeId(candidate);
      if (normalized) values.add(normalized);
    };
    add(user?.sede_id_principal);
    add(user?.sede_id);
    add(activeSedeId);
    if (Array.isArray(user?.sedes_permitidas)) {
      user.sedes_permitidas.forEach((sedeId) => add(sedeId));
    }
    return Array.from(values);
  }, [activeSedeId, user?.sede_id, user?.sede_id_principal, user?.sedes_permitidas]);

  const isAdminSede = useMemo(() => {
    const normalizedRole = String(user?.role ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    return (
      normalizedRole === "admin_sede" ||
      normalizedRole === "adminsede" ||
      normalizedRole === "admin"
    );
  }, [user?.role]);

  const PERIODO_TO_API: Record<PeriodoId, string> = {
    hoy: "today",
    "7dias": "last_7_days",
    mes: "month",
    "30dias": "last_30_days",
    rango: "custom",
  };

  useEffect(() => {
    const today = new Date();
    const last7Days = new Date();
    last7Days.setDate(today.getDate() - 7);
    setDateRange({
      start_date: toLocalYMD(last7Days),
      end_date: toLocalYMD(today),
    });
  }, []);

  useEffect(() => {
    if (isAuthenticated && user) {
      loadSedes();
      loadPeriods();
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    const normalizedActiveSedeId = normalizeSedeId(activeSedeId);
    if (!normalizedActiveSedeId) return;
    setSelectedSede((current) => {
      if (!current || current === "global") return current;
      if (normalizeSedeId(current) === normalizedActiveSedeId) return current;
      return normalizedActiveSedeId;
    });
  }, [activeSedeId]);

  const loadSedes = async () => {
    try {
      setLoadingSedes(true);
      const sedesData = await getSedes(user!.access_token, true);
      const allowedSet =
        allowedSedeIds.length > 0
          ? new Set(allowedSedeIds.map((s) => s.toUpperCase()))
          : null;

      const filteredSedes = sedesData.filter((sede) => {
        const sedeId = normalizeSedeId(sede.sede_id);
        if (!sedeId) return false;
        if (!isAdminSede) return true;
        if (!allowedSet) return false;
        return allowedSet.has(sedeId.toUpperCase());
      });

      setSedes(filteredSedes);
      if (filteredSedes.length === 0) {
        setSelectedSede("");
        return;
      }

      const preferredSedeId =
        normalizeSedeId(activeSedeId) ||
        normalizeSedeId(user?.sede_id) ||
        normalizeSedeId(user?.sede_id_principal) ||
        "";

      const preferredExists = filteredSedes.some(
        (sede) => sede.sede_id === preferredSedeId
      );

      if (filteredSedes.length > 1) {
        setSelectedSede((current) => {
          if (current === "global") return "global";
          if (current && filteredSedes.some((s) => s.sede_id === current))
            return current;
          return "global";
        });
      } else {
        const onlySedeId = filteredSedes[0].sede_id;
        setSelectedSede(preferredExists ? preferredSedeId : onlySedeId);
      }
    } catch (error) {
      console.error("Error cargando sedes:", error);
    } finally {
      setLoadingSedes(false);
    }
  };

  const loadPeriods = async () => {
    try {
      await getVentasAvailablePeriods();
    } catch {
      // periods are not critical
    }
  };

  const handleSedeChange = (sedeId: string) => {
    setSelectedSede(sedeId);
    if (sedeId !== "global") setActiveSedeId(sedeId);
  };

  const handlePeriodoChange = (periodo: PeriodoId, fechas?: { from: Date; to: Date }) => {
    setRangeError(null);
    setPeriodoActivo(periodo);
    if (periodo === "rango" && fechas) {
      const diffMs = fechas.to.getTime() - fechas.from.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays > MAX_CUSTOM_RANGE_DAYS) {
        setRangeError(`El rango máximo permitido es ${MAX_CUSTOM_RANGE_DAYS} días. Ha seleccionado ${diffDays} días.`);
        return;
      }

      setRangoAplicado(fechas);
      setDateRange({
        start_date: formatLocalDate(fechas.from),
        end_date: formatLocalDate(fechas.to),
      });
    }
  };

  const PERIODO_LABELS: Record<PeriodoId, string> = {
    hoy: "Hoy",
    "7dias": "7 días",
    mes: "Mes actual",
    "30dias": "30 días",
    rango: "Rango personalizado",
  };

  const formatDateDisplay = (dateString: string) => formatDateDMY(dateString, "");

  const getPeriodDisplay = () => {
    if (periodoActivo === "rango")
      return `${formatDateDisplay(dateRange.start_date)} - ${formatDateDisplay(dateRange.end_date)}`;
    return PERIODO_LABELS[periodoActivo] || "Período";
  };

  // ── Auth & loading guards ────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col h-screen items-center justify-center">
        <h2 className="text-2xl font-bold">Acceso no autorizado</h2>
        <p className="mt-2 text-gray-600">Por favor inicia sesión para ver el dashboard.</p>
      </div>
    );
  }

  // ── Main Render ──────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />

      <main className="flex-1 overflow-y-auto bg-white">
        <div className="w-full px-4 md:px-8 py-6 pb-16">

          {loadingSedes ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-10 h-10 border-4 border-gray-200 border-t-gray-800 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-gray-500 text-sm">Cargando datos…</p>
              </div>
            </div>
          ) : !selectedSede ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <h2 className="text-2xl font-bold">Sede no disponible</h2>
              <p className="mt-2 text-gray-600">No se pudo determinar tu sede asignada.</p>
              <button
                onClick={() => loadSedes()}
                className="mt-4 flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                <RefreshCw className="w-4 h-4" /> Reintentar
              </button>
            </div>
          ) : (
          <>

          {/* Header */}
          <div className="flex justify-between items-end mb-7">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Dashboard</h1>
              <div className="text-sm text-gray-500 mt-0.5">
                Inteligencia operativa · {user?.pais || "Colombia"} · {monedaUsuario}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {sedes.length > 1 && (
                <SedeDropdown
                  value={selectedSede}
                  onChange={handleSedeChange}
                  options={sedes.map((s) => ({ value: s.sede_id, label: formatSedeNombre(s.nombre, s.sede_id) }))}
                  showAll
                  allValue="global"
                  allLabel="Todas las sedes"
                  size="sm"
                  align="right"
                />
              )}
              <button
                onClick={() => setReloadNonce((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-3.5 py-[7px] border border-[#e8e8e6] rounded-[5px] text-[12.5px] font-medium text-[#6b6b68] bg-white hover:bg-[#f7f7f6] hover:text-[#0a0a0a] transition-all"
              >
                <RefreshCw className="w-[13px] h-[13px]" /> Actualizar
              </button>
            </div>
          </div>

          {/* Range error alert */}
          {rangeError && (
            <div className="mb-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Rango de fechas no permitido</AlertTitle>
                <AlertDescription>{rangeError}</AlertDescription>
              </Alert>
            </div>
          )}

          {/* Period filter */}
          <PeriodoSelector
            periodoActivo={periodoActivo}
            onPeriodoChange={handlePeriodoChange}
            rangoAplicado={rangoAplicado}
            className="mb-8"
          />

          {/* Content */}
          <DashboardSedeView
            key={`${selectedSede}-${reloadNonce}`}
            token={user!.access_token}
            sedeId={selectedSede}
            selectedPeriod={PERIODO_TO_API[periodoActivo]}
            dateRange={dateRange}
            sedes={sedes}
            monedaUsuario={monedaUsuario}
            getPeriodDisplay={getPeriodDisplay}
            userPais={user?.pais}
          />
          </>
          )}
        </div>
      </main>
    </div>
  );
}
