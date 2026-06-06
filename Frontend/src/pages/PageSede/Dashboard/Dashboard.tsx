"use client"

import { useState, useEffect, useMemo } from "react";
import { Sidebar } from "../../../components/Layout/Sidebar";
import { useAuth } from "../../../components/Auth/AuthContext";
import { formatSedeNombre } from "../../../lib/sede";
import { formatDateDMY, toLocalYMD, formatLocalDate } from "../../../lib/dateFormat";
import { getSedes, getVentasAvailablePeriods, type Sede } from "./analyticsApi";
import { normalizeCurrencyCode, getStoredCurrency } from "../../../lib/currency";
import { RefreshCw, AlertCircle } from "lucide-react";
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

  if (loadingSedes) {
    return (
      <div className="flex flex-col h-screen items-center justify-center">
        <div className="w-12 h-12 border-4 border-gray-200 border-t-gray-800 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600">Cargando información de la sede...</p>
      </div>
    );
  }

  if (!selectedSede) {
    return (
      <div className="flex flex-col h-screen items-center justify-center text-center">
        <h2 className="text-2xl font-bold">Sede no disponible</h2>
        <p className="mt-2 text-gray-600">No se pudo determinar tu sede asignada.</p>
        <button
          onClick={() => loadSedes()}
          className="mt-4 flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      </div>
    );
  }

  // ── Main Render ──────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />

      <main className="flex-1 overflow-y-auto bg-[#F8FAFC]">
        <div className="max-w-[1300px] mx-auto px-7 py-5 pb-10">

          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-800">Dashboard</h1>
              <div className="text-xs text-slate-500 mt-0.5">
                Inteligencia de negocio · {user?.pais || "Colombia"} · {monedaUsuario}
              </div>
            </div>
            <div className="flex gap-1.5 items-center">
              {sedes.length > 1 && (
                <select
                  value={selectedSede}
                  onChange={(e) => handleSedeChange(e.target.value)}
                  className="px-3 py-[7px] border border-slate-200 rounded-lg text-xs bg-white font-semibold text-slate-700 focus:outline-none"
                >
                  <option value="global">Todas las sedes</option>
                  {sedes.map((sede) => (
                    <option key={sede.sede_id} value={sede.sede_id}>
                      {formatSedeNombre(sede.nombre, sede.sede_id)}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={() => setReloadNonce((n) => n + 1)}
                className="px-3.5 py-[7px] bg-white border border-slate-200 rounded-lg text-[11px] text-slate-500 font-medium flex items-center gap-1 hover:bg-slate-50"
              >
                <RefreshCw className="w-3 h-3" /> Actualizar
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
            className="mb-[18px]"
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
        </div>
      </main>
    </div>
  );
}
