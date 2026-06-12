"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Sidebar } from "../../../components/Layout/Sidebar";
import { PageHeader } from "../../../components/Layout/PageHeader";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { useAuth } from "../../../components/Auth/AuthContext";
import { inventarioService, type InventarioProducto } from "./inventario";
import { API_BASE_URL } from "../../../types/config";
import { cn } from "../../../lib/utils";
import { APP_MODULES, canAccess } from "../../../lib/access-control";
import {
  InventoryDashboardTab,
  InventoryMovimientosTab,
  InventoryKardexTab,
} from "./ProductsInventoryViews";

type CatalogoProducto = {
  id: string;
  nombre: string;
  codigo: string;
};

type Movimiento = {
  producto: string;
  sede: string;
  sede_id?: string;
  tipo: "Salida" | "Entrada";
  usuario: string;
  fecha: string;
  cantidad?: number;
};

const PAGE_SIZE = 8;
const HIST_PAGE_SIZE = 6;

const normalizeText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const formatDate = (iso?: string): string => {
  if (!iso) return "Sin datos";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Sin datos";
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
};

const formatMoney = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
};

export function ProductsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeProductsTab = searchParams.get("tab") || "lista";

  const {
    user,
    isAuthenticated,
    isLoading: authLoading,
    activeSedeId,
  } = useAuth();

  const [productos, setProductos] = useState<InventarioProducto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [activeLineaTab, setActiveLineaTab] = useState<string>("all");
  const [showLowStock, setShowLowStock] = useState(false);

  const [productoEditando, setProductoEditando] = useState<string | null>(null);
  const [stockTemporal, setStockTemporal] = useState<string>("");
  const [guardandoStock, setGuardandoStock] = useState<string | null>(null);

  const [catalogoProductos, setCatalogoProductos] = useState<
    CatalogoProducto[]
  >([]);
  const [isLoadingCatalogo, setIsLoadingCatalogo] = useState(false);
  const [catalogoError, setCatalogoError] = useState<string | null>(null);
  const [nuevoProductoId, setNuevoProductoId] = useState("");
  const [creacionModo, setCreacionModo] = useState<"catalogo" | "manual">("catalogo");
  const [nuevoNombreManual, setNuevoNombreManual] = useState("");
  const [nuevoSkuManual, setNuevoSkuManual] = useState("");
  const [nuevoStockInicial, setNuevoStockInicial] = useState("0");
  const [nuevoStockMinimo, setNuevoStockMinimo] = useState("5");
  const [lineaFormulario, setLineaFormulario] = useState<string>("");
  const [tipoProducto, setTipoProducto] = useState<string>("ACCESORIO");
  const [precioReferencia, setPrecioReferencia] = useState<string>("");
  const [costoReferencia, setCostoReferencia] = useState<string>("");
  const [isCreatingInventario, setIsCreatingInventario] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [historialPeriodo, setHistorialPeriodo] = useState<"7" | "30" | "90">("7");
  const [historialPage, setHistorialPage] = useState(1);

  // New product modal state
  const [isNuevoProductoModalOpen, setIsNuevoProductoModalOpen] = useState(false);
  const [nuevaVariante, setNuevaVariante] = useState("");
  const [nuevaUnidad, setNuevaUnidad] = useState("Unidad");
  const [nuevoStockIdeal, setNuevoStockIdeal] = useState("20");
  const [paraVentaCheck, setParaVentaCheck] = useState(true);
  const [usoInternoCheck, setUsoInternoCheck] = useState(false);

  const canAdjustStock = canAccess(APP_MODULES.SEDE_PRODUCTS, user?.role);
  const canCreateInventory = canAdjustStock;

  const sedeId =
    activeSedeId ||
    user?.sede_id ||
    (typeof window !== "undefined"
      ? window.sessionStorage.getItem("beaux-sede_id")
      : "") ||
    (typeof window !== "undefined"
      ? window.localStorage.getItem("beaux-sede_id")
      : "") ||
    "";
  const sedeLabel =
    user?.nombre_local ||
    sedeId ||
    "Sede actual";

  const resolveToken = () =>
    user?.access_token ||
    user?.token ||
    (typeof window !== "undefined"
      ? window.sessionStorage.getItem("access_token")
      : null) ||
    (typeof window !== "undefined"
      ? window.localStorage.getItem("access_token")
      : null) ||
    null;

  const resetEdicionStock = () => {
    setProductoEditando(null);
    setStockTemporal("");
    setGuardandoStock(null);
    setError(null);
  };

  const parseApiError = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "No fue posible completar la operación";
  };

  const cargarInventario = async () => {
    if (!sedeId) {
      setError("No se encontró la sede activa");
      setIsLoading(false);
      return;
    }

    const token = resolveToken();
    if (!token) {
      setError("No se encontró token de autenticación");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const data = await inventarioService.getInventarioUsuario(
        showLowStock,
        token,
        sedeId,
      );
      setProductos(data);
      setCurrentPage(1);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const cargarCatalogoProductos = async () => {
    if (!canCreateInventory || !sedeId) return;
    const token = resolveToken();
    if (!token) return;

    try {
      setIsLoadingCatalogo(true);
      setCatalogoError(null);

      const response = await fetch(
        `${API_BASE_URL}inventary/product/productos/?moneda=COP&sede_id=${sedeId}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data?.detail || "No se pudo cargar el catálogo de productos",
        );
      }

      const items = Array.isArray(data)
        ? data
        : Array.isArray((data as { results?: unknown }).results)
          ? (data as { results: unknown[] }).results
          : [];

      const formatted = (items as any[])
        .filter((item) => item?._id && item?.nombre)
        .map((item) => ({
          id: String(item._id),
          nombre: String(item.nombre),
          codigo: item.codigo || item.producto_codigo || "—",
        }))
        .filter((item) => !productos.some((p) => p.producto_id === item.id));

      setCatalogoProductos(formatted);
    } catch (err) {
      setCatalogoError(parseApiError(err));
    } finally {
      setIsLoadingCatalogo(false);
    }
  };

  const iniciarEdicionStock = (producto: InventarioProducto) => {
    setProductoEditando(producto._id);
    setStockTemporal(String(producto.stock_actual ?? 0));
  };

  const guardarStock = async (producto: InventarioProducto) => {
    const token = resolveToken();
    if (!token) {
      setError("No se encontró token de autenticación");
      return;
    }

    const nuevoValor = Number(stockTemporal);
    if (Number.isNaN(nuevoValor) || stockTemporal.trim() === "") {
      setError("Ingresa un valor numérico de stock");
      return;
    }

    const delta = nuevoValor - Number(producto.stock_actual ?? 0);
    if (delta === 0) {
      resetEdicionStock();
      return;
    }

    setError(null);
    setGuardandoStock(producto._id);
    try {
      const result = await inventarioService.ajustarInventario(
        producto._id,
        delta,
        token,
      );
      if (!result.success) {
        setError(result.error || "No se pudo ajustar el stock");
        return;
      }
      setSuccessMessage(result.message || "Stock actualizado");
      resetEdicionStock();
      await cargarInventario();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setGuardandoStock(null);
    }
  };

  const ajustarStockRapido = async (
    producto: InventarioProducto,
    delta: number,
  ) => {
    const token = resolveToken();
    if (!token) {
      setError("No se encontró token de autenticación");
      return;
    }
    try {
      setGuardandoStock(producto._id);
      const result = await inventarioService.ajustarInventario(
        producto._id,
        delta,
        token,
      );
      if (!result.success) {
        setError(result.error || "No se pudo ajustar el stock");
        return;
      }
      setSuccessMessage(result.message || "Stock actualizado");
      await cargarInventario();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setGuardandoStock(null);
      setProductoEditando(null);
    }
  };

  const lineasDisponibles = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; label: string }[] = [];

    productos.forEach((producto) => {
      const label = (producto.categoria || "").trim();
      if (!label) return;
      const id = normalizeText(label) || label.toLowerCase();
      if (seen.has(id)) return;
      seen.add(id);
      result.push({ id, label });
    });

    if (result.length === 0) {
      return [{ id: "general", label: "General" }];
    }

    return result;
  }, [productos]);

  useEffect(() => {
    if (activeLineaTab === "all") return;
    const exists = lineasDisponibles.some((l) => l.id === activeLineaTab);
    if (!exists) {
      setActiveLineaTab("all");
    }
  }, [lineasDisponibles, activeLineaTab]);

  const crearInventario = async () => {
    if (creacionModo === "manual") {
      setCatalogoError(
        "Crear producto desde cero está listo en UI. Conecta el endpoint de creación y reemplaza este aviso."
      );
      return;
    }

    const token = resolveToken();
    if (!token) {
      setCatalogoError("No se encontró token de autenticación");
      return;
    }
    if (!sedeId) {
      setCatalogoError("No se encontró la sede activa");
      return;
    }
    if (!nuevoProductoId) {
      setCatalogoError("Selecciona un producto del catálogo");
      return;
    }

    const payload = {
      producto_id: nuevoProductoId,
      sede_id: sedeId,
      stock_actual: Number(nuevoStockInicial) || 0,
      stock_minimo: Number(nuevoStockMinimo) || 0,
    };

    try {
      setIsCreatingInventario(true);
      setCatalogoError(null);
      const result = await inventarioService.crearInventario(payload, token);
      if (!result.success) {
        setCatalogoError(result.error || "No se pudo crear el inventario");
        return;
      }
      setSuccessMessage(result.message || "Producto agregado al inventario");
      setNuevoProductoId("");
      setNuevoStockInicial("0");
      setNuevoStockMinimo("5");
      setPrecioReferencia("");
      setCostoReferencia("");
      setTipoProducto("ACCESORIO");
      setLineaFormulario(lineasDisponibles[0]?.id ?? "");
      await Promise.all([cargarInventario(), cargarCatalogoProductos()]);
    } catch (err) {
      setCatalogoError(parseApiError(err));
    } finally {
      setIsCreatingInventario(false);
    }
  };

  const handleLineaChange = (lineaId: string) => {
    setActiveLineaTab(lineaId);
    setCurrentPage(1);
  };

  const handleFiltrarStockBajo = () => {
    setShowLowStock((prev) => !prev);
  };

  useEffect(() => {
    if (!authLoading && sedeId) {
      void cargarInventario();
    }
  }, [authLoading, sedeId, showLowStock]);

  useEffect(() => {
    if (!authLoading && canCreateInventory) {
      void cargarCatalogoProductos();
    }
  }, [authLoading, canCreateInventory, sedeId]);

  useEffect(() => {
    if (!lineaFormulario && lineasDisponibles.length > 0) {
      setLineaFormulario(lineasDisponibles[0].id);
    }
  }, [lineasDisponibles, lineaFormulario]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setError("Debes iniciar sesión para acceder al inventario");
      setIsLoading(false);
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!successMessage) return;
    const timeoutId = window.setTimeout(() => setSuccessMessage(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [successMessage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, activeLineaTab]);

  useEffect(() => {
    setHistorialPage(1);
  }, [historialPeriodo, sedeId, sedeLabel]);

  const filteredProductos = useMemo(() => {
    let data = [...productos];

    if (activeLineaTab !== "all") {
      data = data.filter((producto) =>
        normalizeText(producto.categoria) === normalizeText(activeLineaTab),
      );
    }

    if (showLowStock) {
      data = data.filter(
        (item) => Number(item.stock_actual ?? 0) <= Number(item.stock_minimo ?? 0),
      );
    }

    if (searchTerm.trim()) {
      const term = normalizeText(searchTerm);
      data = data.filter(
        (producto) =>
          normalizeText(producto.producto_nombre).includes(term) ||
          normalizeText(producto.nombre).includes(term) ||
          normalizeText(producto.producto_codigo).includes(term),
      );
    }

    return data;
  }, [productos, activeLineaTab, searchTerm, showLowStock]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredProductos.length / PAGE_SIZE),
  );
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedProductos = filteredProductos.slice(
    (currentPageSafe - 1) * PAGE_SIZE,
    currentPageSafe * PAGE_SIZE,
  );

  const kpis = useMemo(
    () => ({
      totalProductos: productos.length,
      totalUnidades: productos.reduce(
        (acc, item) => acc + Number(item.stock_actual ?? 0),
        0,
      ),
      criticos: productos.filter(
        (item) =>
          Number(item.stock_actual ?? 0) <= Number(item.stock_minimo ?? 0),
      ).length,
      sinStock: productos.filter((item) => Number(item.stock_actual ?? 0) <= 0)
        .length,
    }),
    [productos],
  );


  const renderEstadoBadge = (producto: InventarioProducto) => {
    const actual = Number(producto.stock_actual ?? 0);
    if (actual <= 0) {
      return (
        <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-50 text-red-600">
          Sin stock
        </span>
      );
    }
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
        Activo
      </span>
    );
  };

  const pageStart = filteredProductos.length === 0 ? 0 : (currentPageSafe - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(filteredProductos.length, currentPageSafe * PAGE_SIZE);

  const filteredHistorial = useMemo(() => {
    const days = Number(historialPeriodo);
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (Number.isFinite(days) ? days - 1 : 0));

    const usuarioNombre = (() => {
      const candidate =
        (user as any)?.nombre_local ||
        (user as any)?.email ||
        (user as any)?.name;
      return typeof candidate === "string" && candidate.trim()
        ? candidate
        : "Usuario";
    })();

    const movimientos: Movimiento[] = productos.slice(0, 50).map((p, idx) => {
      const fecha = new Date();
      fecha.setHours(0, 0, 0, 0);
      fecha.setDate(fecha.getDate() - idx);

      return {
        producto: p.producto_nombre || p.nombre || "Producto",
        sede: sedeLabel,
        sede_id: sedeId || undefined,
        tipo: "Salida",
        usuario: usuarioNombre,
        fecha: fecha.toISOString().split("T")[0],
        cantidad: Number(p.stock_minimo ?? 1) || 1,
      };
    });

    return movimientos.filter((m) => {
      const d = new Date(m.fecha);
      if (Number.isNaN(d.getTime())) return false;
      d.setHours(0, 0, 0, 0);
      return d >= cutoff;
    });
  }, [historialPeriodo, productos, sedeId, sedeLabel, user]);

  const totalHistPages = Math.max(1, Math.ceil(filteredHistorial.length / HIST_PAGE_SIZE));
  const historialPageSafe = Math.min(historialPage, totalHistPages);
  const paginatedHistorial = filteredHistorial.slice(
    (historialPageSafe - 1) * HIST_PAGE_SIZE,
    historialPageSafe * HIST_PAGE_SIZE,
  );

  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {/* Products sub-navigation */}
        <div className="border-b border-gray-200 bg-white px-4 md:px-8 pt-1 overflow-x-auto scrollbar-hide">
          <nav className="flex gap-0">
            {(
              [
                { id: "lista", label: "Productos" },
                { id: "dashboard", label: "Dashboard" },
                { id: "movimientos", label: "Movimientos" },
                { id: "kardex", label: "Kardex" },
              ] as { id: string; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSearchParams({ tab: tab.id })}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                  activeProductsTab === tab.id
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {activeProductsTab !== "lista" ? (
          <div className="p-4 md:p-8">
            {activeProductsTab === "dashboard" && (
              <InventoryDashboardTab productos={productos} sedeLabel={sedeLabel} sedeId={sedeId} />
            )}
            {activeProductsTab === "movimientos" && (
              <InventoryMovimientosTab productos={productos} sedeLabel={sedeLabel} sedeId={sedeId} />
            )}
            {activeProductsTab === "kardex" && (
              <InventoryKardexTab productos={productos} sedeId={sedeId} />
            )}
          </div>
        ) : (
        <div className="p-4 md:p-8 space-y-6">
          {error ? (
            <Alert variant="destructive" className="border-gray-300 bg-gray-50 text-gray-800">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {successMessage ? (
            <Alert className="border-gray-300 bg-gray-50 text-gray-800">
              <Check className="h-4 w-4" />
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          ) : null}

          <PageHeader
            title="Productos"
            actions={
              canCreateInventory ? (
                <Button
                  onClick={() => setIsNuevoProductoModalOpen(true)}
                  className="bg-black text-white hover:bg-gray-800"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Nuevo producto
                </Button>
              ) : null
            }
          />

          {/* KPI cards eliminados según pedido */}

            <Card className="border-gray-200 bg-white shadow-sm">
            <CardHeader className="space-y-4 pb-2">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  {[{ id: "all", label: "Todos" }, ...lineasDisponibles].map((linea) => (
                    <Button
                      key={linea.id}
                      size="sm"
                      variant="outline"
                      onClick={() => handleLineaChange(linea.id)}
                      className={cn(
                        "rounded-md border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100",
                        activeLineaTab === linea.id &&
                          "border-black bg-black text-white hover:bg-gray-800"
                      )}
                    >
                      {linea.label}
                    </Button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                  <span className="rounded-md border border-gray-300 bg-gray-50 px-3 py-1">
                    {kpis.totalProductos} productos
                  </span>
                  <span className="rounded-md border border-gray-300 bg-gray-50 px-3 py-1">
                    {kpis.totalUnidades} unidades
                  </span>
                  <span className="rounded-md border border-gray-300 bg-gray-50 px-3 py-1">
                    {kpis.criticos} críticos
                  </span>
                  <span className="rounded-md border border-gray-300 bg-gray-50 px-3 py-1">
                    {kpis.sinStock} sin stock
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar productos..."
                    className="h-11 rounded-md border-gray-300 bg-white pl-10 text-sm focus-visible:border-gray-500 focus-visible:ring-gray-500"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                    <Building2 className="h-4 w-4 text-gray-500" />
                    <div className="leading-tight">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-gray-400">
                        Sede
                      </div>
                      <div className="font-medium text-gray-800">{sedeLabel}</div>
                    </div>
                  </div>

                  <Button
                    variant={showLowStock ? "default" : "outline"}
                    onClick={handleFiltrarStockBajo}
                    className={cn(
                      "text-sm",
                      showLowStock
                        ? "bg-black text-white hover:bg-gray-800"
                        : "border-gray-300 text-gray-700 hover:bg-gray-100",
                    )}
                  >
                    <SlidersHorizontal className="mr-2 h-4 w-4" />
                    Ver stock bajo
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Producto
                    </TableHead>
                    <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Línea
                    </TableHead>
                    <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      SKU
                    </TableHead>
                    <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-center">
                      Stock
                    </TableHead>
                    <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-center">
                      Mín
                    </TableHead>
                    <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-center">
                      Ventas
                    </TableHead>
                    <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-center">
                      Precio
                    </TableHead>
                    <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-center">
                      Costo
                    </TableHead>
                    <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Estado
                    </TableHead>
                    <TableHead className="w-10 px-4 py-3" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="px-4 py-8 text-center text-sm text-gray-500"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Cargando productos...
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : paginatedProductos.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="px-4 py-10 text-center text-sm text-gray-500"
                      >
                        No hay productos para mostrar con los filtros actuales
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedProductos.map((producto) => {
                      const actual = Number(producto.stock_actual ?? 0);
                      const minimo = Number(producto.stock_minimo ?? 0);
                      const dotCls =
                        actual <= 0
                          ? "bg-gray-400"
                          : actual <= minimo
                          ? "bg-red-500"
                          : actual <= minimo * 1.5
                          ? "bg-amber-500"
                          : "bg-emerald-500";
                      const numCls =
                        actual <= 0
                          ? "text-gray-400"
                          : actual <= minimo
                          ? "text-red-600"
                          : actual <= minimo * 1.5
                          ? "text-amber-600"
                          : "text-emerald-600";
                      return (
                        <TableRow key={producto._id} className="hover:bg-gray-50">
                          <TableCell className="px-4 py-3">
                            <div>
                              <div className="font-semibold text-sm text-gray-900">
                                {producto.producto_nombre || producto.nombre || "Producto"}
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                {producto.sku || producto.producto_tipo || "—"}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-3">
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                              {producto.categoria || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-3 font-mono text-xs text-gray-400">
                            {producto.producto_codigo || "—"}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-center">
                            <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", numCls)}>
                              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotCls)} />
                              {actual}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-3 text-center text-sm text-gray-400">
                            {minimo}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-center text-sm text-gray-700">
                            {typeof producto.ventas === "number" ? producto.ventas : "—"}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-center text-sm text-gray-800">
                            {producto.precio ? formatMoney(producto.precio) : "—"}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-center text-sm text-gray-400">
                            {producto.costo ? formatMoney(producto.costo) : "—"}
                          </TableCell>
                          <TableCell className="px-4 py-3">
                            {renderEstadoBadge(producto)}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-center">
                            {canAdjustStock && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button className="text-gray-400 hover:text-gray-700 transition-colors p-1 rounded">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="bg-white">
                                  <DropdownMenuItem
                                    onSelect={(e) => { e.preventDefault(); void ajustarStockRapido(producto, 1); }}
                                  >
                                    <ArrowUpRight className="mr-2 h-4 w-4" /> Entrada rápida
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={(e) => { e.preventDefault(); void ajustarStockRapido(producto, -1); }}
                                  >
                                    <ArrowDownRight className="mr-2 h-4 w-4" /> Salida rápida
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={(e) => { e.preventDefault(); iniciarEdicionStock(producto); }}
                                  >
                                    Editar stock
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              </div>

              <div className="flex flex-wrap items-center justify-between border-t border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                <div>
                  Mostrando {pageStart}-{pageEnd} de {filteredProductos.length}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPageSafe === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <div className="text-xs text-gray-500">
                    Página {currentPageSafe} de {totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPageSafe === totalPages}
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ─── Nuevo producto Dialog ─────────────────────────────── */}
          <Dialog open={isNuevoProductoModalOpen} onOpenChange={setIsNuevoProductoModalOpen}>
            <DialogContent className="w-full max-w-[500px] bg-white border-gray-200 text-gray-900">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-gray-900">Crear producto</DialogTitle>
                <p className="text-xs text-gray-400 -mt-1">Registra un nuevo producto en el inventario.</p>
              </DialogHeader>
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nombre del producto</label>
                  <Input
                    value={nuevoNombreManual}
                    onChange={(e) => setNuevoNombreManual(e.target.value)}
                    placeholder="Ej: Acondicionador Línea Men"
                    className="border-gray-200 bg-white text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Marca</label>
                    <Select value={lineaFormulario} onValueChange={setLineaFormulario}>
                      <SelectTrigger className="border-gray-200 bg-white text-sm">
                        <SelectValue placeholder="Seleccionar marca" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200">
                        <SelectItem value="rizos_felices">Rizos Felices</SelectItem>
                        <SelectItem value="loreal">L'Oréal</SelectItem>
                        <SelectItem value="wella">Wella</SelectItem>
                        {lineasDisponibles.map((l) => (
                          <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Categoría</label>
                    <Select value={tipoProducto} onValueChange={setTipoProducto}>
                      <SelectTrigger className="border-gray-200 bg-white text-sm">
                        <SelectValue placeholder="Seleccionar" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200">
                        <SelectItem value="MEN">MEN</SelectItem>
                        <SelectItem value="SPECIAL">SPECIAL</SelectItem>
                        <SelectItem value="ACCESORIO">ACCESORIO</SelectItem>
                        <SelectItem value="USO SALON">USO SALON</SelectItem>
                        <SelectItem value="USO 2 SALON">USO 2 SALON</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Descripción (opcional)</label>
                  <Input placeholder="Descripción del producto" className="border-gray-200 bg-white text-sm" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">SKU</label>
                    <Input
                      value={nuevoSkuManual}
                      onChange={(e) => setNuevoSkuManual(e.target.value)}
                      placeholder="Auto"
                      className="border-gray-200 bg-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Unidad</label>
                    <Select value={nuevaUnidad} onValueChange={setNuevaUnidad}>
                      <SelectTrigger className="border-gray-200 bg-white text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200">
                        <SelectItem value="Unidad">Unidad</SelectItem>
                        <SelectItem value="ML">ML</SelectItem>
                        <SelectItem value="GR">GR</SelectItem>
                        <SelectItem value="Litro">Litro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Variante</label>
                    <Input
                      value={nuevaVariante}
                      onChange={(e) => setNuevaVariante(e.target.value)}
                      placeholder="Ej: 250 ML"
                      className="border-gray-200 bg-white text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Precio de compra</label>
                    <Input
                      value={costoReferencia}
                      onChange={(e) => setCostoReferencia(e.target.value)}
                      placeholder="$0"
                      className="border-gray-200 bg-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Precio de venta</label>
                    <Input
                      value={precioReferencia}
                      onChange={(e) => setPrecioReferencia(e.target.value)}
                      placeholder="$0"
                      className="border-gray-200 bg-white text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Stock inicial</label>
                    <Input
                      type="number"
                      min={0}
                      value={nuevoStockInicial}
                      onChange={(e) => setNuevoStockInicial(e.target.value)}
                      placeholder="0"
                      className="border-gray-200 bg-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Stock mínimo</label>
                    <Input
                      type="number"
                      min={0}
                      value={nuevoStockMinimo}
                      onChange={(e) => setNuevoStockMinimo(e.target.value)}
                      placeholder="5"
                      className="border-gray-200 bg-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Stock ideal</label>
                    <Input
                      type="number"
                      min={0}
                      value={nuevoStockIdeal}
                      onChange={(e) => setNuevoStockIdeal(e.target.value)}
                      placeholder="20"
                      className="border-gray-200 bg-white text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-5 pt-1">
                  <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={paraVentaCheck}
                      onChange={(e) => setParaVentaCheck(e.target.checked)}
                      className="accent-gray-900"
                    />
                    Para venta
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={usoInternoCheck}
                      onChange={(e) => setUsoInternoCheck(e.target.checked)}
                      className="accent-gray-900"
                    />
                    Uso interno
                  </label>
                </div>
                {catalogoError && (
                  <p className="text-xs text-red-600">{catalogoError}</p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 mt-2">
                <Button
                  variant="outline"
                  className="border-gray-200 text-gray-600 text-sm"
                  onClick={() => setIsNuevoProductoModalOpen(false)}
                  disabled={isCreatingInventario}
                >
                  Cancelar
                </Button>
                <Button
                  className="bg-gray-900 text-white hover:bg-gray-800 text-sm"
                  onClick={() => { setCreacionModo("manual"); void crearInventario(); }}
                  disabled={isCreatingInventario}
                >
                  {isCreatingInventario && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Registrar producto
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* ── legacy inline form (kept for fallback, hidden) ── */}
          <div className="hidden">
            <Card
              id="crear-producto-panel"
              className="border-gray-200 bg-white shadow-sm"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold">Crear producto</CardTitle>
                    <p className="text-sm text-gray-500">
                      Reutiliza el catálogo existente y registra el stock inicial.
                    </p>
                  </div>
                  <Sparkles className="h-5 w-5 text-gray-500" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {catalogoError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{catalogoError}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={creacionModo === "catalogo" ? "default" : "outline"}
                    className={creacionModo === "catalogo" ? "bg-black text-white hover:bg-gray-800" : "border-gray-300 text-gray-700"}
                    onClick={() => setCreacionModo("catalogo")}
                  >
                    Usar catálogo
                  </Button>
                  <Button
                    size="sm"
                    variant={creacionModo === "manual" ? "default" : "outline"}
                    className={creacionModo === "manual" ? "bg-black text-white hover:bg-gray-800" : "border-gray-300 text-gray-700"}
                    onClick={() => setCreacionModo("manual")}
                  >
                    Crear
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Select
                    value={lineaFormulario}
                    onValueChange={(value) => setLineaFormulario(value)}
                  >
                    <SelectTrigger className="border-gray-300 bg-white">
                      <SelectValue placeholder="Línea de producto" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {lineasDisponibles.map((linea) => (
                        <SelectItem key={linea.id} value={linea.id}>
                          {linea.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={tipoProducto}
                    onValueChange={(value) => setTipoProducto(value)}
                  >
                    <SelectTrigger className="border-gray-300 bg-white">
                      <SelectValue placeholder="Tipo de producto" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      <SelectItem value="ACCESORIO">ACCESORIO</SelectItem>
                      <SelectItem value="TRATAMIENTO">TRATAMIENTO</SelectItem>
                      <SelectItem value="HERRAMIENTA">HERRAMIENTA</SelectItem>
                    </SelectContent>
                  </Select>

                  {creacionModo === "catalogo" ? (
                    <>
                      <Select
                        value={nuevoProductoId}
                        onValueChange={(value) => setNuevoProductoId(value)}
                        disabled={isLoadingCatalogo}
                      >
                        <SelectTrigger className="col-span-1 sm:col-span-2 border-gray-300 bg-white">
                          <SelectValue
                            placeholder={
                              isLoadingCatalogo
                                ? "Cargando catálogo..."
                                : "Nombre (selecciona del catálogo)"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {catalogoProductos.length === 0 ? (
                            <SelectItem value="none" disabled>
                              {isLoadingCatalogo
                                ? "Cargando..."
                                : "No hay productos disponibles"}
                            </SelectItem>
                          ) : (
                            catalogoProductos.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.nombre} — {item.codigo}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>

                      <Input
                        value={
                          catalogoProductos.find((item) => item.id === nuevoProductoId)?.codigo ||
                          "SKU"
                        }
                        readOnly
                        className="border-gray-300 bg-gray-100 text-gray-600"
                      />
                    </>
                  ) : (
                    <>
                      <Input
                        value={nuevoNombreManual}
                        onChange={(e) => setNuevoNombreManual(e.target.value)}
                        placeholder="Nombre del producto"
                        className="col-span-1 sm:col-span-2 border-gray-300"
                      />
                      <Input
                        value={nuevoSkuManual}
                        onChange={(e) => setNuevoSkuManual(e.target.value)}
                        placeholder="SKU / Código"
                        className="border-gray-300"
                      />
                    </>
                  )}

                  <Input
                    type="number"
                    min={0}
                    value={nuevoStockInicial}
                    onChange={(e) => setNuevoStockInicial(e.target.value)}
                    placeholder="Stock inicial"
                    className="border-gray-300"
                  />

                  <Input
                    type="number"
                    min={0}
                    value={nuevoStockMinimo}
                    onChange={(e) => setNuevoStockMinimo(e.target.value)}
                    placeholder="Stock mínimo"
                    className="border-gray-300"
                  />

                  <Input
                    type="number"
                    min={0}
                    value={precioReferencia}
                    onChange={(e) => setPrecioReferencia(e.target.value)}
                    placeholder="Precio de venta"
                    className="border-gray-300"
                  />

                  <Input
                    type="number"
                    min={0}
                    value={costoReferencia}
                    onChange={(e) => setCostoReferencia(e.target.value)}
                    placeholder="Costo"
                    className="border-gray-300"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
                  <span>Precios y costos son de referencia (el backend aún no los almacena).</span>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setNuevoProductoId("");
                      setLineaFormulario(lineasDisponibles[0]?.id ?? "");
                      setNuevoNombreManual("");
                      setNuevoSkuManual("");
                      setNuevoStockInicial("0");
                      setNuevoStockMinimo("5");
                      setPrecioReferencia("");
                      setCostoReferencia("");
                      setCreacionModo("catalogo");
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={crearInventario}
                    disabled={isCreatingInventario}
                    className="bg-black text-white hover:bg-gray-800"
                  >
                    {isCreatingInventario ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Registrar producto
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200 bg-white shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <div>
                  <CardTitle className="text-lg font-semibold">
                    Historial de salidas
                  </CardTitle>
                  <p className="text-sm text-gray-500">Últimos {historialPeriodo} días</p>
                </div>
                <Select value={historialPeriodo} onValueChange={(v: "7" | "30" | "90") => setHistorialPeriodo(v)}>
                  <SelectTrigger className="w-[150px] border-gray-300 bg-white text-sm">
                    <SelectValue placeholder="Últimos 30 días" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="7">Últimos 7 días</SelectItem>
                    <SelectItem value="30">Últimos 30 días</SelectItem>
                    <SelectItem value="90">Últimos 90 días</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {["Todos", ...lineasDisponibles.map((l) => l.label)].map((label) => (
                    <Button
                      key={label}
                      size="sm"
                      variant="outline"
                      className="rounded-md border-gray-300"
                      disabled
                    >
                      {label}
                    </Button>
                  ))}
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    disabled
                    placeholder="Buscar por producto, usuario o nota..."
                    className="h-10 rounded-md border-gray-300 bg-white pl-9"
                  />
                </div>

                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <Table>
                    <TableHeader className="bg-gray-50">
                      <TableRow>
                        <TableHead className="px-4 py-3 text-xs font-semibold text-gray-700">Producto</TableHead>
                        <TableHead className="px-4 py-3 text-xs font-semibold text-gray-700">Sede</TableHead>
                        <TableHead className="px-4 py-3 text-xs font-semibold text-gray-700">Salida</TableHead>
                        <TableHead className="px-4 py-3 text-xs font-semibold text-gray-700">Usuario</TableHead>
                        <TableHead className="px-4 py-3 text-right text-xs font-semibold text-gray-700">Fecha</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedHistorial.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-sm text-gray-500">
                            No hay movimientos en este período
                          </TableCell>
                        </TableRow>
                      ) : (
                        paginatedHistorial.map((row, idx) => (
                        <TableRow key={`${row.producto}-${idx}`} className="hover:bg-gray-50">
                          <TableCell className="px-4 py-3">
                            <div className="font-medium text-gray-900">{row.producto}</div>
                            <div className="text-xs text-gray-500">{row.cantidad ?? 0} unidades</div>
                          </TableCell>
                          <TableCell className="px-4 py-3 text-sm text-gray-700">{row.sede}</TableCell>
                          <TableCell className="px-4 py-3">
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-md border-gray-300",
                                row.tipo === "Salida"
                                  ? "bg-gray-200 text-gray-900"
                                  : "bg-gray-100 text-gray-700",
                              )}
                            >
                              {row.tipo}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-4 py-3 text-sm text-gray-700">{row.usuario}</TableCell>
                          <TableCell className="px-4 py-3 text-right text-sm text-gray-700">
                            {formatDate(row.fecha)}
                          </TableCell>
                        </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
                  <div>
                    Mostrando{" "}
                    {paginatedHistorial.length === 0
                      ? 0
                      : (historialPageSafe - 1) * HIST_PAGE_SIZE + 1}
                    -
                    {Math.min(filteredHistorial.length, historialPageSafe * HIST_PAGE_SIZE)} de{" "}
                    {filteredHistorial.length}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistorialPage((p) => Math.max(1, p - 1))}
                      disabled={historialPageSafe === 1 || paginatedHistorial.length === 0}
                    >
                      Anterior
                    </Button>
                    <div className="text-xs text-gray-500">
                      Página {historialPageSafe} de {totalHistPages}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistorialPage((p) => Math.min(totalHistPages, p + 1))}
                      disabled={historialPageSafe === totalHistPages || paginatedHistorial.length === 0}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        )}
      </main>

      {/* ─── Modal Editar Stock ─────────────────────────────── */}
      {productoEditando && (() => {
        const producto = productos.find((p) => p._id === productoEditando);
        if (!producto) return null;
        const actual = Number(producto.stock_actual ?? 0);
        const minimo = Number(producto.stock_minimo ?? 0);
        const nuevo = Number(stockTemporal) || 0;
        const delta = Number(stockTemporal.trim() !== "" ? nuevo - actual : 0);
        const dotCls =
          nuevo <= 0 ? "bg-gray-400" : nuevo <= minimo ? "bg-red-500" : nuevo <= minimo * 1.5 ? "bg-amber-500" : "bg-emerald-500";
        const numCls =
          nuevo <= 0 ? "text-gray-400" : nuevo <= minimo ? "text-red-600" : nuevo <= minimo * 1.5 ? "text-amber-600" : "text-emerald-600";
        const isSaving = guardandoStock === producto._id;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/35"
            onClick={resetEdicionStock}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Editar stock</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Ajusta el stock actual del producto.</p>
                </div>
                <button onClick={resetEdicionStock} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-800">
                    {producto.producto_nombre || producto.nombre}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    SKU: {producto.producto_codigo || "—"} · {producto.categoria || "—"}
                  </p>
                  <div className="mt-3 flex items-center gap-4">
                    <div>
                      <p className="text-[10px] text-gray-400">Stock actual</p>
                      <p className="text-sm font-bold text-gray-700 mt-0.5">{actual}</p>
                    </div>
                    {stockTemporal.trim() !== "" && delta !== 0 && (
                      <>
                        <span className="text-gray-300 text-lg">→</span>
                        <div>
                          <p className="text-[10px] text-gray-400">Nuevo stock</p>
                          <span className={cn("flex items-center gap-1 text-sm font-bold mt-0.5", numCls)}>
                            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotCls)} />
                            {nuevo}
                          </span>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400">Ajuste</p>
                          <p className={cn("text-sm font-bold mt-0.5", delta > 0 ? "text-emerald-600" : "text-red-600")}>
                            {delta > 0 ? `+${delta}` : delta}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Nuevo stock</label>
                  <Input
                    type="number"
                    min={0}
                    value={stockTemporal}
                    onChange={(e) => setStockTemporal(e.target.value)}
                    placeholder={String(actual)}
                    className="border-gray-200 bg-white text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void guardarStock(producto);
                      if (e.key === "Escape") resetEdicionStock();
                    }}
                  />
                </div>

                {error && <p className="text-xs text-red-600">{error}</p>}

                <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-200 text-gray-600 text-xs"
                    onClick={resetEdicionStock}
                    disabled={isSaving}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="bg-gray-900 text-white hover:bg-gray-800 text-xs"
                    onClick={() => void guardarStock(producto)}
                    disabled={isSaving}
                  >
                    {isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Guardar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
