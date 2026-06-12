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
import { SedeDropdown } from "../../../components/ui/SedeDropdown";
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

      <main className="flex-1 overflow-y-auto bg-white">
        <div className="w-full px-4 md:px-8 py-6 pb-16">

          {/* Header */}
          <div className="flex justify-between items-end mb-7">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Dashboard</h1>
              <div className="text-sm text-gray-500 mt-0.5">
                Inteligencia operativa · Super Admin · {activeCurrency}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <SedeDropdown
                value={selectedSede}
                onChange={handleSedeChange}
                options={sedes.map((s) => ({ sede_id: s.sede_id, nombre: formatSedeNombre(s.nombre, s.sede_id) }))}
                showAll
                allValue="global"
                allLabel="Todas las sedes"
                size="sm"
                align="right"
              />
              <button
                onClick={handleRefresh}
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

          {/* Period + Tab filter row */}
          <div className="flex items-center gap-3 mb-8 flex-wrap">
            <PeriodoSelector
              periodoActivo={periodoActivo}
              onPeriodoChange={handlePeriodoChange}
              rangoAplicado={rangoAplicado}
            />
            <div className="ml-auto flex items-center gap-2">
              <div className="flex border border-[#e8e8e6] rounded-[5px] overflow-hidden">
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={`px-3.5 py-1.5 text-[13px] font-medium transition-all ${
                    activeTab === "dashboard"
                      ? "bg-[#0a0a0a] text-white"
                      : "bg-white text-[#6b6b68] hover:bg-[#f7f7f6] hover:text-[#0a0a0a]"
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setActiveTab("sedes")}
                  className={`px-3.5 py-1.5 text-[13px] font-medium transition-all border-l border-[#e8e8e6] ${
                    activeTab === "sedes"
                      ? "bg-[#0a0a0a] text-white"
                      : "bg-white text-[#6b6b68] hover:bg-[#f7f7f6] hover:text-[#0a0a0a]"
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
                    <div className="w-10 h-10 border-4 border-[#e8e8e6] border-t-[#0a0a0a] rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-[#6b6b68] text-sm">Cargando dashboard…</p>
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
            <div className="bg-white border border-[#e8e8e6] rounded-lg overflow-hidden mb-8">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e8e6]">
                <span className="text-[13.5px] font-semibold text-[#0a0a0a]">Sedes registradas</span>
                <span className="text-[11px] text-[#9b9b97]">{sedes.length} total</span>
              </div>
              <div className="px-5 py-4">
                <input
                  type="text"
                  placeholder="Buscar sede..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full max-w-[280px] px-3 py-1.5 border border-[#e8e8e6] rounded-[5px] text-[12.5px] bg-[#f7f7f6] text-[#0a0a0a] focus:outline-none focus:border-[#d1d1cf] focus:bg-white mb-4 transition-all"
                />
                {loadingSedes ? (
                  <div className="text-center py-8">
                    <div className="w-8 h-8 border-4 border-[#e8e8e6] border-t-[#0a0a0a] rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-[12.5px] text-[#9b9b97]">Cargando sedes…</p>
                  </div>
                ) : filteredSedes.length === 0 ? (
                  <div className="text-center py-8">
                    <Building2 className="w-10 h-10 mx-auto mb-3 text-[#d1d1cf]" />
                    <p className="text-[12.5px] text-[#9b9b97]">No se encontraron sedes</p>
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
                        className={`p-4 border rounded-lg cursor-pointer transition-all hover:shadow-[0_1px_3px_rgba(0,0,0,0.06)] ${
                          selectedSede === sede.sede_id
                            ? "border-[#0a0a0a] bg-[#f7f7f6]"
                            : "border-[#e8e8e6] hover:border-[#d1d1cf]"
                        }`}
                      >
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-[#6b6b68]" />
                            <span className="text-[13px] font-medium text-[#0a0a0a]">
                              {formatSedeNombre(sede.nombre)}
                            </span>
                          </div>
                          <div className={`w-[6px] h-[6px] rounded-full mt-1 ${sede.activa ? "bg-[#16a34a]" : "bg-[#d1d1cf]"}`} />
                        </div>
                        <p className="text-[11.5px] text-[#6b6b68] truncate">{sede.direccion}</p>
                        <p className="text-[11px] text-[#9b9b97] mt-0.5">{sede.telefono}</p>
                        {selectedSede === sede.sede_id && (
                          <div className="mt-2">
                            <Badge className="text-[9px] bg-[#0a0a0a] text-white px-1.5 py-0.5 rounded font-medium">
                              Seleccionada
                            </Badge>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
