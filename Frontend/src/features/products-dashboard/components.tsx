import { PageHeader } from "../../components/Layout/PageHeader";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card";
import { DatePicker } from "../../components/ui/DatePicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Badge } from "../../components/ui/badge";
import { Button as UiButton } from "../../components/ui/button";
import { Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { formatCurrencyNoDecimals, resolveCurrencyLocale } from "../../lib/currency";
import { CalendarRange, Settings2 } from "lucide-react";
import type React from "react";

export interface DateRange {
  start_date: string;
  end_date: string;
}

export interface SedeOption {
  sede_id: string;
  nombre: string;
  pais?: string;
  moneda?: string;
}

interface PeriodOption {
  id: string;
  label: string;
}

interface ProductsHeaderFiltersProps {
  title?: string;
  subtitle?: string;
  sedes?: SedeOption[];
  selectedSedeId?: string;
  onSedeChange?: (value: string) => void;
  disableSedeSelect?: boolean;
  enableAllSedesOption?: boolean;
  loadingSedes?: boolean;
  period: string;
  onPeriodChange: (value: string) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  periodOptions?: PeriodOption[];
  onOpenConfig?: () => void;
  rightSlot?: React.ReactNode;
}

const DEFAULT_PERIOD_OPTIONS: PeriodOption[] = [
  { id: "today", label: "Hoy" },
  { id: "last_7_days", label: "7 días" },
  { id: "last_30_days", label: "30 días" },
  { id: "month", label: "Mes actual" },
  { id: "custom", label: "Personalizado" },
];

const formatDateDMY = (value: string) => {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day.padStart(2, "0")}-${month.padStart(2, "0")}-${year}`;
};

export function ProductsHeaderFilters({
  title = "Dashboard de Productos",
  subtitle = "Resumen de ventas e inventario de los productos",
  sedes = [],
  selectedSedeId,
  onSedeChange,
  disableSedeSelect,
  enableAllSedesOption = false,
  loadingSedes,
  period,
  onPeriodChange,
  dateRange,
  onDateRangeChange,
  periodOptions = DEFAULT_PERIOD_OPTIONS,
  onOpenConfig,
  rightSlot,
}: ProductsHeaderFiltersProps) {
  const showCustomDates = period === "custom";

  return (
    <div className="mb-6 space-y-4">
      <PageHeader title={title} subtitle={subtitle} className="mb-0" />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-3">
          {sedes.length > 0 && (
            <div className="w-full min-w-[240px] md:w-64">
              <Select
                value={selectedSedeId}
                onValueChange={(value) => onSedeChange && onSedeChange(value)}
                disabled={disableSedeSelect || loadingSedes}
              >
            <SelectTrigger className="w-full border-gray-300 bg-white text-gray-900">
              <SelectValue placeholder="Selecciona una sede" />
            </SelectTrigger>
            <SelectContent className="bg-white border border-gray-200 text-gray-900">
              {enableAllSedesOption && sedes.length > 1 && (
                <SelectItem value="all">Todas las sedes</SelectItem>
              )}
              {sedes.map((sede) => (
                <SelectItem key={sede.sede_id} value={sede.sede_id}>
                  {sede.nombre}
                </SelectItem>
              ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="w-full min-w-[200px] md:w-48">
            <Select value={period} onValueChange={onPeriodChange}>
            <SelectTrigger className="w-full border-gray-300 bg-white text-gray-900">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent className="bg-white border border-gray-200 text-gray-900">
              {periodOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
              </SelectContent>
            </Select>
          </div>

          {showCustomDates && (
            <div className="flex flex-wrap gap-2">
              <DatePicker
                value={dateRange.start_date}
                onChange={(v) => onDateRangeChange({ ...dateRange, start_date: v })}
              />
              <DatePicker
                value={dateRange.end_date}
                onChange={(v) => onDateRangeChange({ ...dateRange, end_date: v })}
              />
            </div>
          )}

          {!showCustomDates && dateRange.start_date && dateRange.end_date && (
            <div className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
              <CalendarRange className="h-4 w-4 text-gray-500" />
              <span>
                {formatDateDMY(dateRange.start_date)} — {formatDateDMY(dateRange.end_date)}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {rightSlot}
          {onOpenConfig && (
            <Button
              variant="default"
              className="bg-black text-white hover:bg-gray-900"
              onClick={onOpenConfig}
            >
              <Settings2 className="mr-2 h-4 w-4 text-white" />
              Configuración de productos
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export interface ProductSalesRow {
  productId: string;
  nombre: string;
  unidades: number;
  monto: number;
  currency: string;
  participacion?: number;
}

export interface ProductCardItem {
  id: string;
  nombre: string;
  categoria?: string;
  codigo?: string;
  stock?: number;
  stockMinimo?: number;
  updatedAt?: string;
  price?: number;
  priceCurrency?: string;
}

interface ProductsSalesCardProps {
  title: string;
  rows: ProductSalesRow[];
  currency: string;
  loading?: boolean;
  error?: string | null;
  compact?: boolean;
  onViewDetail?: () => void;
}

const formatCurrency = (value: number, currency: string) =>
  formatCurrencyNoDecimals(value, currency, resolveCurrencyLocale(currency, "es-CO"));

const formatNumber = (value: number) =>
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value);

export function ProductsSalesCard({
  title,
  rows,
  currency,
  loading = false,
  error,
  compact = false,
  onViewDetail,
}: ProductsSalesCardProps) {
  const maxRows = compact ? 4 : 8;

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg font-semibold text-gray-900">{title}</CardTitle>
            <CardDescription className="text-gray-600">Unidades vendidas y monto vendido</CardDescription>
          </div>
          {onViewDetail && (
            <Button variant="ghost" size="sm" className="text-gray-700" onClick={onViewDetail}>
              Ver detalle
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="w-32">Unidades</TableHead>
                <TableHead className="w-40">Monto Vendido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: maxRows }).map((_, index) => (
                    <TableRow key={`sales-skeleton-${index}`}>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    </TableRow>
                  ))
                : error
                  ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-sm text-red-600">
                        {error}
                      </TableCell>
                    </TableRow>
                  )
                  : rows.length > 0
                    ? rows.slice(0, maxRows).map((row) => (
                        <TableRow key={row.productId} className="hover:bg-gray-50">
                          <TableCell className="font-medium text-gray-900">{row.nombre}</TableCell>
                          <TableCell>{formatNumber(row.unidades)}</TableCell>
                          <TableCell>{formatCurrency(row.monto, currency)}</TableCell>
                        </TableRow>
                      ))
                    : (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-sm text-gray-500">
                          No hay ventas de productos para el período seleccionado.
                        </TableCell>
                      </TableRow>
                    )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

interface ProductCardsGridProps {
  title?: string;
  products: ProductCardItem[];
  loading?: boolean;
  onEditProduct?: (productId: string) => void;
}

export const ProductCardsGrid: React.FC<ProductCardsGridProps> = ({
  title = "Productos",
  products,
  loading = false,
  onEditProduct,
}) => {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, idx) => (
          <Card key={idx} className="border-gray-200 p-4">
            <Skeleton className="h-5 w-2/3 mb-2" />
            <Skeleton className="h-4 w-1/2 mb-2" />
            <Skeleton className="h-4 w-full mb-3" />
            <Skeleton className="h-4 w-3/4" />
          </Card>
        ))}
      </div>
    );
  }

  if (!products || products.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-gray-600">
        No hay productos registrados.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 uppercase tracking-wide">{title}</p>
          <p className="text-lg font-semibold text-gray-900">{products.length} productos</p>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {products.map((prod) => {
          const bajoStock =
            prod.stock !== undefined &&
            prod.stockMinimo !== undefined &&
            prod.stock <= prod.stockMinimo
          const statusLabel = bajoStock ? "Bajo stock" : "Activo"

          return (
            <Card
              key={prod.id}
              className="border-gray-200 bg-white hover:shadow-sm transition-shadow rounded-2xl p-3 flex flex-col gap-2 min-h-[120px]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 break-words leading-tight max-h-[3.6em] line-clamp-2">
                    {prod.nombre}
                  </p>
                  {prod.categoria && (
                    <p className="text-[11px] text-gray-600 truncate">{prod.categoria}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1 text-[12px] text-gray-700">
                <div className="flex flex-col">
                  <span className="text-gray-500">Mínimo:</span>
                  <span className="font-medium text-gray-800">{prod.stockMinimo ?? "-"}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-gray-500">Estado:</span>
                  <span className={`font-semibold ${bajoStock ? "text-amber-600" : "text-emerald-700"}`}>
                    {statusLabel}
                  </span>
                </div>
              </div>

              {prod.price !== undefined && (
                <div className="text-[12px] font-medium text-gray-900">
                  {formatCurrencyNoDecimals(
                    prod.price,
                    resolveCurrencyLocale(prod.priceCurrency || "COP", "es-CO")
                  )}{" "}
                  {prod.priceCurrency || ""}
                </div>
              )}

              <div className="flex items-center justify-start gap-2 pt-1">
                {prod.stock !== undefined && (
                  <Badge variant="outline" className="text-[11px] bg-gray-50 text-gray-800 border-gray-200 whitespace-nowrap">
                    Stock: {prod.stock}
                  </Badge>
                )}
                {onEditProduct && (
                  <UiButton
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-gray-700 hover:text-gray-900"
                    onClick={() => onEditProduct(prod.id)}
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="sr-only">Editar</span>
                  </UiButton>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  );
};

interface InventorySummaryCardProps {
  totalProductos: number;
  stockTotal: number;
  bajoStock: number;
  sinStock: number;
  diasRestantes?: number | null;
  loading?: boolean;
  onViewInventory?: () => void;
}

export function InventorySummaryCard({
  totalProductos,
  stockTotal,
  bajoStock,
  sinStock,
  diasRestantes,
  loading = false,
  onViewInventory,
}: InventorySummaryCardProps) {
  return (
    <Card className="border border-gray-200 h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg font-semibold text-gray-900">Estado de inventario</CardTitle>
          {onViewInventory && (
            <Button variant="ghost" size="sm" onClick={onViewInventory}>
              Ver inventario
            </Button>
          )}
        </div>
        <CardDescription className="text-gray-600">Resumen rápido del inventario en la sede</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <>
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-32" />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm text-gray-700">
              <span className="font-medium text-gray-900">Inventario</span>
              <span>{formatNumber(stockTotal)} unidades</span>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-700">
              <span>Productos críticos</span>
              <span className={bajoStock > 0 ? "text-amber-700 font-medium" : "text-gray-700"}>
                {bajoStock}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-700">
              <span>Sin stock</span>
              <span className={sinStock > 0 ? "text-red-700 font-medium" : "text-gray-700"}>
                {sinStock}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-700">
              <span>Días restantes de inventario</span>
              <span className="font-medium">
                {typeof diasRestantes === "number" ? `${diasRestantes} días` : "Dato no disponible"}
              </span>
            </div>
            <div className="pt-1 text-xs text-gray-500">
              Total de productos: {formatNumber(totalProductos)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
