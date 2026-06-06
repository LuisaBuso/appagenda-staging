import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  Search,
  X,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import type { InventarioProducto } from "./inventario";
import {
  crearEntrada,
  crearSalida,
  getMovimientos,
  getTopProductos,
  getSinMovimiento,
  type FiltroTiempo,
  type Movimiento,
  type MovimientosResponse,
  type TopProducto,
  type ProductoSinMovimiento,
  RANGOS_RELATIVOS,
} from "./inventarioApi";
import { useAuth } from "../../../components/Auth/AuthContext";
import { cn } from "../../../lib/utils";

// ─── Shared helpers ────────────────────────────────────────────────────────

const stockColor = (actual: number, minimo: number) => {
  if (actual <= 0) return "text-gray-400";
  if (actual <= minimo) return "text-red-600";
  if (actual <= minimo * 1.5) return "text-amber-600";
  return "text-emerald-600";
};

const stockDot = (actual: number, minimo: number) => {
  if (actual <= 0) return "bg-gray-400";
  if (actual <= minimo) return "bg-red-500";
  if (actual <= minimo * 1.5) return "bg-amber-500";
  return "bg-emerald-500";
};

const formatDate = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(d);
};

const resolveToken = (user: any): string | null =>
  user?.access_token ||
  user?.token ||
  window.sessionStorage.getItem("access_token") ||
  window.localStorage.getItem("access_token") ||
  null;

const resolveSedeId = (user: any, activeSedeId?: string | null, overrideSedeId?: string): string =>
  (overrideSedeId && overrideSedeId !== "all" ? overrideSedeId : null) ||
  activeSedeId ||
  user?.sede_id ||
  window.sessionStorage.getItem("beaux-sede_id") ||
  window.localStorage.getItem("beaux-sede_id") ||
  "";

// ─── DASHBOARD TAB ──────────────────────────────────────────────────────────

interface DashboardTabProps {
  productos: InventarioProducto[];
  sedeLabel?: string;
  sedeId?: string;
}

export function InventoryDashboardTab({ productos, sedeLabel = "Sede", sedeId: sedeIdProp }: DashboardTabProps) {
  const { user, activeSedeId } = useAuth();
  const [topProductos, setTopProductos] = useState<TopProducto[]>([]);
  const [sinMovimiento, setSinMovimiento] = useState<ProductoSinMovimiento[]>([]);
  const [loadingTop, setLoadingTop] = useState(false);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [filtro] = useState<FiltroTiempo>({ modo: "relativo", dias: 30 });

  useEffect(() => {
    const token = resolveToken(user);
    const sedeId = resolveSedeId(user, activeSedeId, sedeIdProp);
    if (!token || !sedeId) return;

    setLoadingTop(true);
    getTopProductos(token, filtro, 5, sedeId)
      .then(setTopProductos)
      .catch(() => setTopProductos([]))
      .finally(() => setLoadingTop(false));

    setLoadingSlow(true);
    getSinMovimiento(token, filtro, sedeId)
      .then((data) => setSinMovimiento(data.slice(0, 4)))
      .catch(() => setSinMovimiento([]))
      .finally(() => setLoadingSlow(false));
  }, [user, activeSedeId, sedeIdProp]);

  const totalProductos = productos.length;
  const totalUnidades = productos.reduce((a, p) => a + Number(p.stock_actual ?? 0), 0);
  const criticos = productos.filter(
    (p) => Number(p.stock_actual) > 0 && Number(p.stock_actual) <= Number(p.stock_minimo)
  ).length;
  const sinStock = productos.filter((p) => Number(p.stock_actual ?? 0) <= 0).length;

  const críticosProductos = [...productos]
    .filter((p) => Number(p.stock_actual) <= Number(p.stock_minimo))
    .sort((a, b) => Number(a.stock_actual) - Number(b.stock_actual))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total productos" value={totalProductos} />
        <KpiCard label="Unidades en stock" value={totalUnidades} />
        <KpiCard label="Stock crítico" value={criticos} alert={criticos > 0} />
        <KpiCard label="Sin stock" value={sinStock} alert={sinStock > 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Productos bajo stock */}
        <Card className="border-gray-200">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-700">Productos bajo stock</CardTitle>
            <Badge variant="outline" className="text-xs border-gray-200 text-gray-500">
              {críticosProductos.length} alertas
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            {críticosProductos.length === 0 ? (
              <p className="px-4 py-6 text-sm text-center text-gray-400">Sin alertas activas</p>
            ) : (
              críticosProductos.map((p) => {
                const actual = Number(p.stock_actual ?? 0);
                const min = Number(p.stock_minimo ?? 0);
                const deficit = min - actual;
                return (
                  <div
                    key={p._id}
                    className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {p.producto_nombre || p.nombre}
                      </p>
                      <p className="text-xs text-gray-400">
                        Mín: {min} · Déficit: {deficit > 0 ? deficit : 0}
                      </p>
                    </div>
                    <span className={cn("flex items-center gap-1.5 text-sm font-semibold", stockColor(actual, min))}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", stockDot(actual, min))} />
                      {actual}
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Top más vendidos */}
        <Card className="border-gray-200">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-700">Top más vendidos</CardTitle>
            <Badge variant="outline" className="text-xs border-gray-200 text-gray-500">
              {sedeLabel} · últimos 30 días
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            {loadingTop ? (
              <div className="flex items-center justify-center py-6 gap-2 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando...
              </div>
            ) : topProductos.length === 0 ? (
              <p className="px-4 py-6 text-sm text-center text-gray-400">Sin datos de ventas</p>
            ) : (
              topProductos.map((p, i) => (
                <div
                  key={p.producto_id}
                  className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50"
                >
                  <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold bg-gray-100 text-gray-500 shrink-0">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm text-gray-800 truncate">{p.nombre_producto}</span>
                  <span className="text-sm font-semibold text-gray-700">{p.total_vendido}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Productos sin movimiento */}
      {(loadingSlow || sinMovimiento.length > 0) && (
        <Card className="border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">
              Productos sin ventas (últimos 30 días)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingSlow ? (
              <div className="flex items-center justify-center py-6 gap-2 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando...
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold text-gray-500">Producto</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500">Línea</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 text-right">Stock actual</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 text-right">Stock mínimo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sinMovimiento.map((p) => (
                    <TableRow key={p.producto_id} className="hover:bg-gray-50">
                      <TableCell className="font-medium text-gray-800">{p.nombre_producto}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs border-gray-200 text-gray-600">
                          {p.categoria || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-gray-700">{p.stock_actual}</TableCell>
                      <TableCell className="text-right text-gray-500">{p.stock_minimo}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={cn("text-2xl font-bold mt-1.5", alert ? "text-red-600" : "text-gray-900")}>
        {value}
      </p>
    </div>
  );
}

// ─── MOVIMIENTOS TAB ─────────────────────────────────────────────────────────

interface MovimientosTabProps {
  productos: InventarioProducto[];
  sedeLabel?: string;
  sedeId?: string;
}

type MovFiltroTipo = "todos" | "Entrada" | "Salida";

export function InventoryMovimientosTab({ productos, sedeLabel: _sedeLabel = "Sede", sedeId: sedeIdProp }: MovimientosTabProps) {
  const { user, activeSedeId } = useAuth();
  const [filtroTipo, setFiltroTipo] = useState<MovFiltroTipo>("todos");
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<FiltroTiempo>({ modo: "relativo", dias: 7 });
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<MovimientosResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEntradaModal, setShowEntradaModal] = useState(false);
  const [showSalidaModal, setShowSalidaModal] = useState(false);

  const fetchMovimientos = () => {
    const token = resolveToken(user);
    const sedeId = resolveSedeId(user, activeSedeId, sedeIdProp);
    if (!token || !sedeId) return;

    setLoading(true);
    setError(null);

    getMovimientos(token, {
      filtro,
      tipo: filtroTipo !== "todos" ? filtroTipo : undefined,
      page,
      page_size: 20,
      sede_id: sedeId,
    })
      .then(setResponse)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Error cargando movimientos")
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchMovimientos();
  }, [filtroTipo, filtro, page, user, activeSedeId, sedeIdProp]);

  const handleFiltroTipo = (tipo: MovFiltroTipo) => {
    setFiltroTipo(tipo);
    setPage(1);
  };

  const handleDias = (dias: string) => {
    setFiltro({ modo: "relativo", dias: Number(dias) });
    setPage(1);
  };

  const movimientos = response?.data ?? [];

  const filtered = search.trim()
    ? movimientos.filter((m) => {
        const s = search.toLowerCase();
        return (
          m.producto.toLowerCase().includes(s) ||
          m.motivo.toLowerCase().includes(s) ||
          m.usuario.toLowerCase().includes(s)
        );
      })
    : movimientos;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5 flex-wrap items-center">
          {(
            [
              { id: "todos", label: "Todos" },
              { id: "Entrada", label: "Entradas" },
              { id: "Salida", label: "Salidas" },
            ] as { id: MovFiltroTipo; label: string }[]
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => handleFiltroTipo(f.id)}
              className={cn(
                "px-3 py-1.5 rounded-md border text-xs font-medium transition-colors",
                filtroTipo === f.id
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              )}
            >
              {f.label}
            </button>
          ))}

          <Select
            value={String(filtro.dias ?? 7)}
            onValueChange={handleDias}
          >
            <SelectTrigger className="h-8 w-36 border-gray-200 bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-gray-200">
              {RANGOS_RELATIVOS.map((r) => (
                <SelectItem key={r.dias} value={String(r.dias)} className="text-xs">
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            className="bg-gray-900 text-white hover:bg-gray-800 text-xs"
            onClick={() => setShowEntradaModal(true)}
          >
            <ArrowDown className="h-3.5 w-3.5 mr-1.5" />
            Registrar entrada
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-gray-300 text-gray-700 text-xs hover:bg-gray-50"
            onClick={() => setShowSalidaModal(true)}
          >
            <ArrowUp className="h-3.5 w-3.5 mr-1.5" />
            Registrar salida
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por producto, usuario o motivo..."
          className="pl-9 border-gray-200 bg-white text-sm"
        />
      </div>

      {error && (
        <Alert variant="destructive" className="border-gray-300 bg-gray-50 text-gray-800">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <Card className="border-gray-200">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="w-8 px-3" />
                <TableHead className="text-xs font-semibold text-gray-500">Producto</TableHead>
                <TableHead className="text-xs font-semibold text-gray-500">Tipo</TableHead>
                <TableHead className="text-xs font-semibold text-gray-500">Motivo</TableHead>
                <TableHead className="text-xs font-semibold text-gray-500 text-center">Cantidad</TableHead>
                <TableHead className="text-xs font-semibold text-gray-500 text-center">Saldo</TableHead>
                <TableHead className="text-xs font-semibold text-gray-500">Usuario</TableHead>
                <TableHead className="text-xs font-semibold text-gray-500">Fecha</TableHead>
                <TableHead className="text-xs font-semibold text-gray-500">Sede</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-gray-400">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Cargando movimientos...
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-gray-400">
                    No hay movimientos para mostrar
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((m) => (
                  <TableRow key={m.id} className="hover:bg-gray-50">
                    <TableCell className="px-3 py-2.5">
                      <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center">
                        {m.tipo === "Entrada" ? (
                          <ArrowDown className="h-3 w-3 text-gray-500" />
                        ) : (
                          <ArrowUp className="h-3 w-3 text-gray-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-gray-800 py-2.5">{m.producto}</TableCell>
                    <TableCell className="py-2.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[11px] font-medium",
                          m.tipo === "Entrada"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-red-200 bg-red-50 text-red-700"
                        )}
                      >
                        {m.tipo}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600 py-2.5">{m.motivo}</TableCell>
                    <TableCell className="text-center font-semibold text-sm py-2.5">
                      <span className={m.tipo === "Entrada" ? "text-emerald-600" : "text-red-600"}>
                        {m.tipo === "Entrada" ? "+" : "-"}
                        {m.cantidad}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-sm py-2.5">
                      <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                        {m.saldo}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-gray-400 py-2.5">{m.usuario}</TableCell>
                    <TableCell className="text-xs text-gray-400 py-2.5">{formatDate(m.fecha)}</TableCell>
                    <TableCell className="text-xs text-gray-400 py-2.5">{m.sede}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {response && response.total_pages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
              <span>
                Página {response.page} de {response.total_pages} · {response.total} movimientos
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!response.tiene_anterior}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!response.tiene_siguiente}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {showEntradaModal && (
        <MovimientoModal
          titulo="Registrar entrada"
          descripcion="Ingresa productos al inventario de la sede."
          productos={productos}
          tipo="Entrada"
          onClose={() => setShowEntradaModal(false)}
          onSuccess={() => {
            setShowEntradaModal(false);
            fetchMovimientos();
          }}
        />
      )}

      {showSalidaModal && (
        <MovimientoModal
          titulo="Registrar salida"
          descripcion="Retira productos del inventario de la sede."
          productos={productos}
          tipo="Salida"
          onClose={() => setShowSalidaModal(false)}
          onSuccess={() => {
            setShowSalidaModal(false);
            fetchMovimientos();
          }}
        />
      )}
    </div>
  );
}

function MovimientoModal({
  titulo,
  descripcion,
  productos,
  tipo,
  onClose,
  onSuccess,
}: {
  titulo: string;
  descripcion: string;
  productos: InventarioProducto[];
  tipo: "Entrada" | "Salida";
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user, activeSedeId } = useAuth();
  const [selectedProductId, setSelectedProductId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProduct = productos.find(
    (p) => p._id === selectedProductId || p.producto_id === selectedProductId
  );
  const stockActual = Number(selectedProduct?.stock_actual ?? 0);
  const stockMinimo = Number(selectedProduct?.stock_minimo ?? 0);
  const cantidadNum = Number(cantidad) || 0;
  const stockResultante = tipo === "Salida" ? stockActual - cantidadNum : stockActual + cantidadNum;
  const bajoMinimo = tipo === "Salida" && stockResultante < stockMinimo && cantidadNum > 0;

  const motivosSalida = ["Venta", "Uso interno", "Obsequio", "Muestra", "Pérdida", "Ajuste manual"];
  const motivosEntrada = ["Compra a proveedor", "Ajuste manual", "Devolución cliente", "Transferencia", "Stock inicial"];

  const handleConfirm = async () => {
    const token = resolveToken(user);
    if (!token) { setError("No se encontró token de autenticación"); return; }
    if (!selectedProduct) { setError("Selecciona un producto"); return; }
    if (cantidadNum <= 0) { setError("La cantidad debe ser mayor a 0"); return; }
    if (!motivo) { setError("Selecciona un motivo"); return; }

    const sedeId = resolveSedeId(user, activeSedeId);
    const body = {
      motivo,
      ...(sedeId ? { sede_id: sedeId } : {}),
      ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
      items: [{ producto_id: selectedProduct.producto_id, cantidad: cantidadNum }],
    };

    setSaving(true);
    setError(null);
    try {
      if (tipo === "Entrada") {
        await crearEntrada(token, body);
      } else {
        await crearSalida(token, body);
      }
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al registrar movimiento");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{titulo}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{descripcion}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Producto</label>
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger className="border-gray-200 bg-white text-sm">
                <SelectValue placeholder="Buscar por nombre o SKU..." />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200">
                {productos.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.producto_nombre || p.nombre} — {p.producto_codigo || p.categoria}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedProduct && (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {selectedProduct.producto_nombre || selectedProduct.nombre}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  SKU: {selectedProduct.producto_codigo || "—"} · {selectedProduct.categoria || "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-400">Stock actual</p>
                <span className={cn("flex items-center gap-1 text-sm font-semibold", stockColor(stockActual, stockMinimo))}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", stockDot(stockActual, stockMinimo))} />
                  {stockActual}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Cantidad</label>
              <Input
                type="number"
                min={1}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                placeholder="0"
                className="border-gray-200 bg-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Motivo</label>
              <Select value={motivo} onValueChange={setMotivo}>
                <SelectTrigger className="border-gray-200 bg-white text-sm">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  {(tipo === "Salida" ? motivosSalida : motivosEntrada).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Observaciones</label>
            <Input
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Notas opcionales..."
              className="border-gray-200 bg-white text-sm"
            />
          </div>

          {bajoMinimo && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Esta salida dejará el stock en{" "}
                <strong className="font-semibold">{stockResultante}</strong> unidad(es) (mínimo:{" "}
                {stockMinimo})
              </span>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
            <Button
              variant="outline"
              size="sm"
              className="border-gray-200 text-gray-600 text-xs"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-gray-900 text-white hover:bg-gray-800 text-xs"
              onClick={handleConfirm}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Confirmar {tipo === "Entrada" ? "entrada" : "salida"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── KARDEX TAB ──────────────────────────────────────────────────────────────

interface KardexTabProps {
  productos: InventarioProducto[];
  sedeId?: string;
}

const kardexTypeBadge = (tipo: string) => {
  if (tipo === "Salida") return "border-red-200 bg-red-50 text-red-700";
  if (tipo === "Entrada") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-gray-200 bg-gray-50 text-gray-600";
};

export function InventoryKardexTab({ productos, sedeId: sedeIdProp }: KardexTabProps) {
  const { user, activeSedeId } = useAuth();
  const [selectedId, setSelectedId] = useState(productos[0]?._id ?? "");
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<FiltroTiempo>({ modo: "relativo", dias: 30 });
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<MovimientosResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProduct = productos.find((p) => p._id === selectedId);

  useEffect(() => {
    if (!selectedProduct) return;
    const token = resolveToken(user);
    const sedeId = resolveSedeId(user, activeSedeId, sedeIdProp);
    if (!token || !sedeId) return;

    setLoading(true);
    setError(null);

    getMovimientos(token, {
      filtro,
      producto_id: selectedProduct.producto_id,
      page,
      page_size: 20,
      sede_id: sedeId,
    })
      .then(setResponse)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Error cargando kardex")
      )
      .finally(() => setLoading(false));
  }, [selectedId, filtro, page, user, activeSedeId, sedeIdProp]);

  const handleSelectProduct = (id: string) => {
    setSelectedId(id);
    setPage(1);
  };

  const handleDias = (dias: string) => {
    setFiltro({ modo: "relativo", dias: Number(dias) });
    setPage(1);
  };

  const movimientos: Movimiento[] = response?.data ?? [];
  const stockActual = Number(selectedProduct?.stock_actual ?? 0);
  const stockMinimo = Number(selectedProduct?.stock_minimo ?? 0);

  const filteredProductos = productos.filter((p) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      (p.producto_nombre || p.nombre || "").toLowerCase().includes(s) ||
      (p.producto_codigo || "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-4">
      {/* Product + period selectors */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto..."
            className="pl-9 border-gray-200 bg-white text-sm"
          />
        </div>
        <Select value={selectedId} onValueChange={handleSelectProduct}>
          <SelectTrigger className="border-gray-200 bg-white text-sm w-full sm:w-72">
            <SelectValue placeholder="Seleccionar producto" />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-200">
            {filteredProductos.map((p) => (
              <SelectItem key={p._id} value={p._id}>
                {p.producto_nombre || p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(filtro.dias ?? 30)} onValueChange={handleDias}>
          <SelectTrigger className="border-gray-200 bg-white text-sm w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-200">
            {RANGOS_RELATIVOS.map((r) => (
              <SelectItem key={r.dias} value={String(r.dias)} className="text-xs">
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedProduct ? (
        <>
          {/* Product summary */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl bg-gray-50 border border-gray-100 px-5 py-4">
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {selectedProduct.producto_nombre || selectedProduct.nombre}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                SKU: {selectedProduct.producto_codigo || "—"} · {selectedProduct.categoria || "—"}
              </p>
            </div>
            <div className="flex gap-6">
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Stock actual</p>
                <span className={cn("flex items-center gap-1.5 mt-1 text-sm font-bold justify-center", stockColor(stockActual, stockMinimo))}>
                  <span className={cn("w-2 h-2 rounded-full", stockDot(stockActual, stockMinimo))} />
                  {stockActual}
                </span>
              </div>
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Mínimo</p>
                <p className="text-sm font-bold text-gray-500 mt-1">{stockMinimo}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Última actualización</p>
                <p className="text-sm font-bold text-gray-700 mt-1">
                  {formatDate(selectedProduct.fecha_ultima_actualizacion)}
                </p>
              </div>
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="border-gray-300 bg-gray-50 text-gray-800">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Kardex table */}
          <Card className="border-gray-200">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold text-gray-500">Fecha</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500">Cliente</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500">Tipo</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500">Motivo</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 text-center">Entrada</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 text-center">Salida</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 text-center">Saldo</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500">Usuario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-gray-400">
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Cargando kardex...
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : movimientos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-gray-400">
                        Sin movimientos en el período seleccionado
                      </TableCell>
                    </TableRow>
                  ) : (
                    movimientos.map((m) => (
                      <TableRow key={m.id} className="hover:bg-gray-50">
                        <TableCell className="text-xs text-gray-500 py-3">{formatDate(m.fecha)}</TableCell>
                        <TableCell className="text-xs py-3">
                          {m.cliente_nombre
                            ? <span className="font-medium text-gray-700">{m.cliente_nombre}</span>
                            : <span className="text-gray-300">—</span>}
                        </TableCell>
                        <TableCell className="py-3">
                          <Badge
                            variant="outline"
                            className={cn("text-[11px] font-medium", kardexTypeBadge(m.tipo))}
                          >
                            {m.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-gray-600 py-3">{m.motivo}</TableCell>
                        <TableCell className="text-center text-sm font-semibold text-emerald-600 py-3">
                          {m.tipo === "Entrada" ? `+${m.cantidad}` : <span className="text-gray-300">—</span>}
                        </TableCell>
                        <TableCell className="text-center text-sm font-semibold text-red-600 py-3">
                          {m.tipo === "Salida" ? `-${m.cantidad}` : <span className="text-gray-300">—</span>}
                        </TableCell>
                        <TableCell className="text-center py-3">
                          <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-700">
                            {m.saldo}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-gray-400 py-3">{m.usuario}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
              {response && response.total_pages > 1 && (
                <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
                  <span>
                    Página {response.page} de {response.total_pages} · {response.total} movimientos
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!response.tiene_anterior}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!response.tiene_siguiente}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <Package className="h-10 w-10 text-gray-300 mb-3" />
          <p className="text-sm text-gray-400">Selecciona un producto para ver su kardex</p>
        </div>
      )}
    </div>
  );
}
