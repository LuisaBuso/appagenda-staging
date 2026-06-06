import React, { useState, useEffect, useCallback } from "react";
import { Trash2, Plus, TrendingUp, TrendingDown, DollarSign, Loader2 } from "lucide-react";
import { toast } from 'sonner';
import { confirmAction } from '../../../components/ui/confirm-dialog';
import { DatePicker } from "../../../components/ui/DatePicker";
import { useAuth } from "../../../components/Auth/AuthContext";
import { toLocalYMD, formatDateDMY } from "../../../lib/dateFormat";
import {
  getCategorias,
  getGastos,
  crearGasto,
  eliminarGasto,
  getPL,
  type CategoriaGasto,
  type Gasto,
  type GastoCrear,
  type PLResponse,
} from "./gastosApi";

type Tab = "gastos" | "pl";

const fmtMoney = (n: number, moneda = "USD") =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(n);

const today = () => toLocalYMD(new Date());
const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

export default function Gastos() {
  const { user } = useAuth();
  const token = user?.access_token ?? "";

  const [tab, setTab] = useState<Tab>("gastos");
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [plData, setPLData] = useState<PLResponse | null>(null);
  const [plMoneda, setPLMoneda] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [desde, setDesde] = useState(firstOfMonth());
  const [hasta, setHasta] = useState(today());

  const [form, setForm] = useState<GastoCrear>({
    descripcion: "",
    monto: 0,
    categoria_id: "",
    fecha: today(),
    notas: "",
    moneda: user?.moneda ?? "USD",
  });
  const [creando, setCreando] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const cargarCategorias = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getCategorias(token);
      setCategorias(data);
      if (data.length > 0 && !form.categoria_id) {
        setForm((prev) => ({ ...prev, categoria_id: data[0].id }));
      }
    } catch {
      // silencioso
    }
  }, [token]);

  const cargarGastos = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getGastos(token, { desde, hasta });
      setGastos(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, desde, hasta]);

  const cargarPL = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPL(token, { desde, hasta });
      setPLData(data);
      const monedas = Object.keys(data);
      if (monedas.length > 0) setPLMoneda(monedas[0]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, desde, hasta]);

  useEffect(() => {
    cargarCategorias();
  }, [cargarCategorias]);

  useEffect(() => {
    if (tab === "gastos") cargarGastos();
    else cargarPL();
  }, [tab, cargarGastos, cargarPL]);

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.descripcion.trim()) { setFormError("La descripción es requerida"); return; }
    if (form.monto <= 0) { setFormError("El monto debe ser mayor a 0"); return; }
    if (!form.categoria_id) { setFormError("Selecciona una categoría"); return; }

    setCreando(true);
    setFormError(null);
    try {
      const nuevo = await crearGasto(token, form);
      setGastos((prev) => [nuevo, ...prev]);
      setForm((prev) => ({ ...prev, descripcion: "", monto: 0, notas: "", fecha: today() }));
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setCreando(false);
    }
  };

  const handleEliminar = async (id: string) => {
    const confirmed = await confirmAction({ title: "Confirmar", message: "¿Eliminar este gasto?", confirmLabel: "Sí, eliminar", variant: "danger" });
    if (!confirmed) return;
    try {
      await eliminarGasto(token, id);
      setGastos((prev) => prev.filter((g) => g._id !== id));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const plActual = plData && plMoneda ? plData[plMoneda] : null;

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Gastos & P&amp;L</h1>
        <div className="flex gap-2">
          <DatePicker value={desde} onChange={(v) => setDesde(v)} />
          <span className="text-gray-400 self-center text-xs">—</span>
          <DatePicker value={hasta} onChange={(v) => setHasta(v)} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(["gastos", "pl"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? "border-gray-900 text-gray-900" : "border-transparent text-gray-400"}`}>
            {t === "gastos" ? "Gastos" : "P&L"}
          </button>
        ))}
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}

      {/* ── TAB GASTOS ── */}
      {tab === "gastos" && (
        <div className="space-y-4">
          {/* Formulario nuevo gasto */}
          <form onSubmit={handleCrear} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Registrar gasto
            </h2>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Descripción *</label>
                <input type="text" value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  placeholder="Ej: Compra de materiales"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-gray-900 outline-none" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Categoría *</label>
                <select value={form.categoria_id}
                  onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-gray-900 outline-none">
                  <option value="">Seleccionar...</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Monto *</label>
                <input type="number" min="0" step="0.01" value={form.monto || ""}
                  onChange={(e) => setForm({ ...form, monto: parseFloat(e.target.value) || 0 })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-gray-900 outline-none" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Fecha</label>
                <DatePicker value={form.fecha} onChange={(v) => setForm({ ...form, fecha: v })} />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Moneda</label>
                <select value={form.moneda}
                  onChange={(e) => setForm({ ...form, moneda: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-gray-900 outline-none">
                  {["USD", "COP", "MXN"].map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Notas</label>
                <input type="text" value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                  placeholder="Opcional"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-gray-900 outline-none" />
              </div>
            </div>

            <button type="submit" disabled={creando}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
              {creando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {creando ? "Guardando..." : "Registrar gasto"}
            </button>
          </form>

          {/* Listado */}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : gastos.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No hay gastos en el período seleccionado.</p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Fecha</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Descripción</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Categoría</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Monto</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {gastos.map((g) => (
                    <tr key={g._id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-xs text-gray-500">{formatDateDMY(g.fecha)}</td>
                      <td className="px-4 py-2 font-medium text-gray-900">{g.descripcion}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{g.categoria_nombre ?? g.categoria_id}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">
                        {fmtMoney(g.monto, g.moneda)}
                      </td>
                      <td className="px-4 py-2">
                        <button onClick={() => handleEliminar(g._id)}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB P&L ── */}
      {tab === "pl" && (
        <div className="space-y-4">
          {Object.keys(plData ?? {}).length > 1 && (
            <div className="flex gap-2">
              {Object.keys(plData!).map((m) => (
                <button key={m} onClick={() => setPLMoneda(m)}
                  className={`px-3 py-1 rounded text-xs font-medium border ${plMoneda === m ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-600"}`}>
                  {m}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : plActual ? (
            <div className="space-y-4">
              {/* Cards resumen */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    <span className="text-xs font-medium text-gray-500">Ingresos</span>
                  </div>
                  <p className="text-xl font-bold text-green-600">{fmtMoney(plActual.ingresos, plMoneda)}</p>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingDown className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-medium text-gray-500">Egresos</span>
                  </div>
                  <p className="text-xl font-bold text-red-600">{fmtMoney(plActual.egresos.total, plMoneda)}</p>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-medium text-gray-500">Utilidad neta</span>
                  </div>
                  <p className={`text-xl font-bold ${plActual.utilidad_neta >= 0 ? "text-blue-600" : "text-red-600"}`}>
                    {fmtMoney(plActual.utilidad_neta, plMoneda)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Margen: {plActual.margen_neto_pct?.toFixed(1) ?? 0}%
                  </p>
                </div>
              </div>

              {/* Desglose de egresos por categoría */}
              {plActual.egresos.por_categoria?.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">Egresos por categoría</h3>
                  </div>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100">
                      {plActual.egresos.por_categoria.map((cat) => (
                        <tr key={cat.categoria}>
                          <td className="px-4 py-2 text-gray-700">{cat.categoria}</td>
                          <td className="px-4 py-2 text-right font-semibold text-red-600">
                            {fmtMoney(cat.monto, plMoneda)}
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-gray-400">
                            {plActual.egresos.total > 0
                              ? `${((cat.monto / plActual.egresos.total) * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">Sin datos para el período seleccionado.</p>
          )}
        </div>
      )}
    </div>
  );
}
