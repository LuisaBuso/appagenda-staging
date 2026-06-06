"use client"

import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "../../../components/Layout/Sidebar";
import { DashboardSedeView } from "../../PageSede/Dashboard/DashboardSedeView";
import { useAuth } from "../../../components/Auth/AuthContext";
import { formatSedeNombre } from "../../../lib/sede";
import { formatDateDMY, toLocalYMD, formatLocalDate } from "../../../lib/dateFormat";
import { getSedes, getAvailablePeriods, type Sede } from "./Api/analyticsApi";
import { getStoredCurrency, normalizeCurrencyCode } from "../../../lib/currency";
import { RefreshCw, Building2, AlertCircle } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { PeriodoSelector, type PeriodoId } from "../../../components/ui/PeriodoSelector";
import { Alert, AlertTitle, AlertDescription } from "../../../components/ui/alert";

interface DateRange {
  start_date: string;
  end_date: string;
}

const MAX_CUSTOM_RANGE_DAYS = 365;


export default function DashboardPage() {
  const { user, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadingSedes, setLoadingSedes] = useState(false);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [periodoActivo, setPeriodoActivo] = useState<PeriodoId>("mes");
  const [selectedSede, setSelectedSede] = useState<string>("global");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [monedaUsuario, setMonedaUsuario] = useState<string>("COP");
  const [dateRange, setDateRange] = useState<DateRange>({ start_date: "", end_date: "" });
  const [rangoAplicado, setRangoAplicado] = useState<{ from: Date; to: Date } | undefined>(undefined);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const PERIODO_TO_API: Record<PeriodoId, string> = {
    hoy: "today",
    "7dias": "last_7_days",
    mes: "month",
    "30dias": "last_30_days",
    rango: "custom",
  };

  useEffect(() => {
    setMonedaUsuario(getStoredCurrency("COP"));
  }, []);

  useEffect(() => {
    const today = new Date();
    const last30Days = new Date();
    last30Days.setDate(today.getDate() - 30);
    setDateRange({
      start_date: toLocalYMD(last30Days),
      end_date: toLocalYMD(today),
    });
  }, []);

  useEffect(() => {
    if (isAuthenticated && user) {
      loadInitialData();
    }
  }, [isAuthenticated, user]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      await Promise.all([loadSedes(), loadPeriods()]);
    } catch (error) {
      console.error("Error cargando datos iniciales:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadSedes = async () => {
    try {
      setLoadingSedes(true);
      const sedesData = await getSedes(user!.access_token, true);
      setSedes(sedesData);
    } catch (error) {
      console.error("Error cargando sedes:", error);
    } finally {
      setLoadingSedes(false);
    }
  };

  const loadPeriods = async () => {
    try {
      await getAvailablePeriods();
    } catch {
      // periods not critical
    }
  };

  const handleRefresh = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  const handleSedeChange = (sedeId: string) => {
    setSelectedSede(sedeId);
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
      return `${formatDateDisplay(dateRange.start_date)} – ${formatDateDisplay(dateRange.end_date)}`;
    return PERIODO_LABELS[periodoActivo] || "Período";
  };

  const filteredSedes = sedes.filter(
    (sede) =>
      sede.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sede.direccion.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeCurrency = normalizeCurrencyCode(monedaUsuario || "COP");

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col h-screen items-center justify-center">
        <h2 className="text-2xl font-bold text-slate-800">Acceso no autorizado</h2>
        <p className="mt-2 text-slate-500">Por favor inicia sesión para ver el dashboard.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />

      <main className="flex-1 overflow-y-auto bg-[#F8FAFC]">
        <div className="max-w-[1300px] mx-auto px-7 py-5 pb-10">

          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-800">Dashboard</h1>
              <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                <span>Inteligencia de negocio · Super Admin · {activeCurrency}</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold">
                  {loading ? "–" : sedes.length} sedes
                </span>
                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold">
                  Moneda: {activeCurrency}
                </span>
              </div>
            </div>
            <div className="flex gap-1.5 items-center">
              <select
                value={selectedSede}
                onChange={(e) => handleSedeChange(e.target.value)}
                className="px-3 py-[7px] border border-slate-200 rounded-lg text-xs bg-white font-semibold text-slate-700 focus:outline-none"
              >
                <option value="global">Todas las sedes</option>
                {sedes.map((sede) => (
                  <option key={sede._id} value={sede.sede_id}>
                    {formatSedeNombre(sede.nombre, sede.sede_id)}
                  </option>
                ))}
              </select>
              <button
                onClick={handleRefresh}
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

          {/* Period + Tab filter row */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <PeriodoSelector
              periodoActivo={periodoActivo}
              onPeriodoChange={handlePeriodoChange}
              rangoAplicado={rangoAplicado}
            />
            <div className="ml-auto flex items-center gap-2">
              <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={`px-3.5 py-1.5 text-[11px] font-medium transition-colors ${
                    activeTab === "dashboard"
                      ? "bg-slate-800 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setActiveTab("sedes")}
                  className={`px-3.5 py-1.5 text-[11px] font-medium transition-colors border-l border-slate-200 ${
                    activeTab === "sedes"
                      ? "bg-slate-800 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  Sedes
                </button>
              </div>
            </div>
          </div>

          {/* ── DASHBOARD TAB ─────────────────────────────── */}
          {activeTab === "dashboard" && (
            <>
              {loading && sedes.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-500 text-sm">Cargando dashboard…</p>
                  </div>
                </div>
              ) : (
                <DashboardSedeView
                  key={`${selectedSede}-${reloadNonce}`}
                  token={user!.access_token}
                  sedeId={selectedSede}
                  selectedPeriod={PERIODO_TO_API[periodoActivo]}
                  dateRange={dateRange}
                  sedes={sedes}
                  monedaUsuario={activeCurrency}
                  getPeriodDisplay={getPeriodDisplay}
                  userPais={user?.pais}
                  stylistsPath="/superadmin/stylists"
                  productsPath="/superadmin/products"
                />
              )}
            </>
          )}

          {/* ── SEDES TAB ─────────────────────────────────── */}
          {activeTab === "sedes" && (
            <div className="bg-white border border-slate-200 rounded-[10px] p-[18px] mb-3.5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-bold text-slate-800">Sedes registradas</span>
                <span className="text-[10px] text-slate-400">{sedes.length} total</span>
              </div>
              <input
                type="text"
                placeholder="Buscar sede..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs mb-3 focus:outline-none"
              />
              {loadingSedes ? (
                <div className="text-center py-8">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-xs text-slate-400">Cargando sedes…</p>
                </div>
              ) : filteredSedes.length === 0 ? (
                <div className="text-center py-8">
                  <Building2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                  <p className="text-xs text-slate-400">No se encontraron sedes</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredSedes.map((sede) => (
                    <div
                      key={sede._id}
                      onClick={() => {
                        handleSedeChange(sede.sede_id);
                        setActiveTab("dashboard");
                      }}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors hover:border-slate-400 ${
                        selectedSede === sede.sede_id
                          ? "border-slate-800 bg-slate-50"
                          : "border-slate-200"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-xs font-semibold text-slate-800">
                            {formatSedeNombre(sede.nombre)}
                          </span>
                        </div>
                        <div className={`w-2 h-2 rounded-full mt-0.5 ${sede.activa ? "bg-green-500" : "bg-slate-300"}`} />
                      </div>
                      <p className="text-[10px] text-slate-500 truncate">{sede.direccion}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{sede.telefono}</p>
                      {selectedSede === sede.sede_id && (
                        <div className="mt-2">
                          <Badge className="text-[9px] bg-slate-800 text-white px-1.5 py-0.5 rounded font-medium">
                            Seleccionada
                          </Badge>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
