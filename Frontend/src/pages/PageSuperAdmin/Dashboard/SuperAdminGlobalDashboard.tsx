"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, DollarSign, Package, Receipt, Users } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { fetchInventoryProducts, type InventoryProduct } from "../../PageSede/Billing/directSalesApi";
import { facturaService } from "../Sales-invoiced/facturas";
import {
  getVentasDashboard,
  type Sede,
  type VentasDashboardResponse,
} from "./Api/analyticsApi";
import { formatMoney } from "./Api/formatMoney";
import { FranchiseSalesTable } from "./components/FranchiseSalesTable";
import { ProductsDashboardTable } from "./components/ProductsDashboardTable";
import { SlowMoversTable } from "./components/SlowMoversTable";
import { SummaryCards, type SummaryCardItem } from "./components/SummaryCards";
import {
  aggregateDashboardMetrics,
  buildDashboardRequestParams,
  buildInvoiceDateRange,
  buildLast30DaysRange,
  mapFranchiseRows,
  mapProductsRows,
  mapSlowMoversRows,
  rangeContainsRange,
  resolveActiveCurrency,
  type DateRange,
  type GlobalDashboardSedeData,
} from "./super-admin-dashboard.utils";
import { resolveCurrencyLocale } from "../../../lib/currency";
import type { Factura } from "../../../types/factura";

interface SuperAdminGlobalDashboardProps {
  token: string;
  sedes: Sede[];
  selectedPeriod: string;
  dateRange: DateRange;
  preferredCurrency: string;
}

interface RawDashboardState {
  sedesData: GlobalDashboardSedeData[];
  productCatalog: InventoryProduct[];
  notices: string[];
}

const rawDashboardCache = new Map<string, RawDashboardState>();
const DASHBOARD_REQUEST_CONCURRENCY = 4;

const formatCurrencyByCode = (value: number, currency: string) => {
  return formatMoney(value, currency, resolveCurrencyLocale(currency, "es-CO"));
};

async function runWithConcurrency<TItem, TResult>(
  items: TItem[],
  limit: number,
  task: (item: TItem, index: number) => Promise<TResult>
): Promise<Array<PromiseSettledResult<TResult>>> {
  const results: Array<PromiseSettledResult<TResult>> = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        const value = await task(items[currentIndex], currentIndex);
        results[currentIndex] = {
          status: "fulfilled",
          value,
        };
      } catch (reason) {
        results[currentIndex] = {
          status: "rejected",
          reason,
        };
      }
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function SuperAdminGlobalDashboard({
  token,
  sedes,
  selectedPeriod,
  dateRange,
  preferredCurrency,
}: SuperAdminGlobalDashboardProps) {
  const [coreLoading, setCoreLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [rawData, setRawData] = useState<RawDashboardState | null>(null);
  const requestedOnceRef = useRef(false);

  const dashboardParams = useMemo(
    () => buildDashboardRequestParams(selectedPeriod, dateRange),
    [dateRange, selectedPeriod]
  );
  const invoiceRange = useMemo(
    () => buildInvoiceDateRange(selectedPeriod, dateRange),
    [dateRange, selectedPeriod]
  );
  const slowMoversRange = useMemo(() => buildLast30DaysRange(), []);

  const cacheKey = useMemo(() => {
    return JSON.stringify({
      period: selectedPeriod,
      dateRange,
      sedes: sedes.map((sede) => sede.sede_id).sort(),
      reloadNonce,
    });
  }, [dateRange, reloadNonce, sedes, selectedPeriod]);

  useEffect(() => {
    let ignore = false;

    const loadDashboard = async () => {
      if (!token || sedes.length === 0) {
        setRawData({
          sedesData: [],
          productCatalog: [],
          notices: [],
        });
        setCoreLoading(false);
        setDetailLoading(false);
        return;
      }

      const cached = rawDashboardCache.get(cacheKey);
      if (cached) {
        setRawData(cached);
        setError(null);
        setCoreLoading(false);
        setDetailLoading(false);
        requestedOnceRef.current = true;
        return;
      }

      try {
        setCoreLoading(true);
        setDetailLoading(true);
        setError(null);

        const salesResults = await runWithConcurrency(
          sedes,
          DASHBOARD_REQUEST_CONCURRENCY,
          (sede) =>
            getVentasDashboard(token, {
              ...dashboardParams,
              sede_id: sede.sede_id,
            })
        );

        const baseSedesData: GlobalDashboardSedeData[] = sedes.map((sede, index) => ({
          sede,
          ventas:
            salesResults[index]?.status === "fulfilled"
              ? (salesResults[index].value as VentasDashboardResponse)
              : null,
          analytics: null,
          facturas: [],
          slowFacturas: [],
        }));

        const notices: string[] = [];
        const canReuseFacturasForSlowMovers = rangeContainsRange(invoiceRange, slowMoversRange);
        const salesFailures = salesResults.filter((result) => result.status === "rejected").length;

        if (salesFailures > 0) {
          notices.push(`${salesFailures} sede(s) no devolvieron métricas de ventas completas.`);
        }

        if (!ignore) {
          setRawData({
            sedesData: baseSedesData,
            productCatalog: [],
            notices,
          });
          setCoreLoading(false);
          requestedOnceRef.current = true;
        }

        const facturasResults = await runWithConcurrency(
          sedes,
          DASHBOARD_REQUEST_CONCURRENCY,
          (sede) =>
            facturaService.getTodasVentasBySede(sede.sede_id, {
              fecha_desde: invoiceRange.start_date,
              fecha_hasta: invoiceRange.end_date,
              pageSize: 200,
            })
        );

        let slowMoversFacturas: Factura[][] = [];

        if (canReuseFacturasForSlowMovers) {
          slowMoversFacturas = facturasResults.map((result) =>
            result.status === "fulfilled" ? (result.value as Factura[]) || [] : []
          );
        } else {
          const slowMoversResults = await runWithConcurrency(
            sedes,
            DASHBOARD_REQUEST_CONCURRENCY,
            (sede) =>
              facturaService.getTodasVentasBySede(sede.sede_id, {
                fecha_desde: slowMoversRange.start_date,
                fecha_hasta: slowMoversRange.end_date,
                pageSize: 200,
              })
          );

          slowMoversFacturas = slowMoversResults.map((result) =>
            result.status === "fulfilled" ? (result.value as Factura[]) || [] : []
          );
        }

        const sedesData = baseSedesData.map((item, index) => ({
          ...item,
          facturas:
            facturasResults[index]?.status === "fulfilled"
              ? ((facturasResults[index].value as Factura[]) || [])
              : [],
          slowFacturas: slowMoversFacturas[index] || [],
        }));

        const activeCurrency = resolveActiveCurrency(sedesData, preferredCurrency);
        let productCatalog: InventoryProduct[] = [];
        let catalogNotice: string | null = null;

        try {
          productCatalog = await fetchInventoryProducts(token, activeCurrency);
        } catch {
          catalogNotice =
            "El catálogo de productos no respondió; slow movers usa solo productos vendidos recientemente.";
        }

        const detailNotices = [...notices];
        const facturasFailures = facturasResults.filter((result) => result.status === "rejected").length;
        if (facturasFailures > 0) {
          detailNotices.push(`${facturasFailures} sede(s) no devolvieron ventas facturadas; productos puede verse parcial.`);
        }
        if (catalogNotice) {
          detailNotices.push(catalogNotice);
        }

        const nextRawData: RawDashboardState = {
          sedesData,
          productCatalog,
          notices: detailNotices,
        };

        rawDashboardCache.set(cacheKey, nextRawData);

        if (!ignore) {
          setRawData(nextRawData);
          setDetailLoading(false);
        }
      } catch (loadError: any) {
        if (!ignore) {
          setError(loadError?.message || "No se pudo cargar el dashboard global.");
          setRawData(null);
          setCoreLoading(false);
          setDetailLoading(false);
        }
      } finally {
        if (!ignore && coreLoading) {
          setCoreLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      ignore = true;
    };
  }, [
    cacheKey,
    dashboardParams,
    invoiceRange.end_date,
    invoiceRange.start_date,
    preferredCurrency,
    sedes,
    slowMoversRange.end_date,
    slowMoversRange.start_date,
    token,
  ]);

  const summaryMetrics = useMemo(() => {
    return aggregateDashboardMetrics(rawData?.sedesData || [], preferredCurrency);
  }, [preferredCurrency, rawData?.sedesData]);

  const activeCurrency = summaryMetrics.activeCurrency;

  const franchiseRows = useMemo(() => {
    return mapFranchiseRows(rawData?.sedesData || [], preferredCurrency);
  }, [preferredCurrency, rawData?.sedesData]);

  const productRows = useMemo(() => {
    const allFacturas = (rawData?.sedesData || []).flatMap((item) => item.facturas);
    return mapProductsRows(allFacturas, activeCurrency);
  }, [activeCurrency, rawData?.sedesData]);

  const slowMoverRows = useMemo(() => {
    const allSlowFacturas = (rawData?.sedesData || []).flatMap((item) => item.slowFacturas);
    return mapSlowMoversRows(rawData?.productCatalog || [], allSlowFacturas, activeCurrency);
  }, [activeCurrency, rawData?.productCatalog, rawData?.sedesData]);

  const summaryCards = useMemo<SummaryCardItem[]>(() => {
    return [
      {
        title: "Ventas Totales",
        value: formatCurrencyByCode(summaryMetrics.ventasTotales, activeCurrency),
        subtitle: `${summaryMetrics.transacciones} transacciones`,
        icon: DollarSign,
      },
      {
        title: "Transacciones",
        value: String(summaryMetrics.transacciones),
        subtitle: `Ticket promedio: ${formatCurrencyByCode(summaryMetrics.ticketPromedio, activeCurrency)}`,
        icon: Receipt,
      },
      {
        title: "Servicios",
        value: formatCurrencyByCode(summaryMetrics.ventasServicios, activeCurrency),
        subtitle: `${summaryMetrics.serviciosShare.toFixed(summaryMetrics.serviciosShare >= 10 ? 0 : 1)}% del total`,
        icon: Users,
      },
      {
        title: "Productos",
        value: formatCurrencyByCode(summaryMetrics.ventasProductos, activeCurrency),
        subtitle: `${summaryMetrics.productosShare.toFixed(summaryMetrics.productosShare >= 10 ? 0 : 1)}% del total`,
        icon: Package,
      },
    ];
  }, [activeCurrency, summaryMetrics]);

  const filteredNotices = useMemo(() => {
    return (rawData?.notices || []).filter(
      (notice) =>
        !/moneda/i.test(notice) &&
        !/monedas/i.test(notice) &&
        !/escala/i.test(notice) &&
        !/normaliz/i.test(notice)
    );
  }, [rawData?.notices]);

  if (coreLoading && !requestedOnceRef.current) {
    return (
      <div className="space-y-6">
        <SummaryCards items={[]} loading />
        <FranchiseSalesTable rows={[]} loading />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ProductsDashboardTable rows={[]} currency={preferredCurrency} loading />
          <SlowMoversTable rows={[]} loading />
        </div>
      </div>
    );
  }

  if (error && !rawData) {
    return (
      <Card className="border border-gray-200">
        <CardContent className="py-12 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-gray-400" />
          <h3 className="text-lg font-medium text-gray-900">No se pudo cargar la vista global</h3>
          <p className="mt-2 text-sm text-gray-500">{error}</p>
          <Button
            className="mt-4 bg-gray-900 text-white hover:bg-gray-800"
            onClick={() => {
              rawDashboardCache.delete(cacheKey);
              setReloadNonce((prev) => prev + 1);
            }}
          >
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-50">
          {sedes.length} sedes
        </Badge>
        <Badge className="border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-50">
          Moneda: {activeCurrency}
        </Badge>
      </div>

      {filteredNotices.length ? (
        <Card className="border border-amber-200 bg-amber-50/50">
          <CardContent className="space-y-2 py-4">
            {filteredNotices.map((notice) => (
              <p key={notice} className="text-sm text-amber-900">
                {notice}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <SummaryCards items={summaryCards} />
      <FranchiseSalesTable rows={franchiseRows} loading={coreLoading} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ProductsDashboardTable
          rows={productRows}
          currency={activeCurrency}
          loading={detailLoading}
          note={
            summaryMetrics.availableCurrencies.length > 1
              ? `Ranking visible en ${activeCurrency} para evitar mezclar monedas.`
              : null
          }
        />
        <SlowMoversTable
          rows={slowMoverRows}
          loading={detailLoading}
          note="Última venta muestra solo actividad detectada en la ventana cargada."
        />
      </div>
    </div>
  );
}
