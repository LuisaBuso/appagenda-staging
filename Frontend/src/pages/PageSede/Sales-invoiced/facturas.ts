// src/api/facturas.ts
import { API_BASE_URL } from "../../../types/config";
import {
  extractPaymentMethodTotalsFromApiSummary,
  type PaymentMethodTotals,
} from "../../../lib/payment-methods-summary";
import { toBackendDate } from "../../../lib/dateFormat";
import { getSedes } from "../../../components/Branch/sedesApi";

export interface FacturaAPI {
  _id: string;
  identificador: string;
  fecha_pago: string;
  local: string;
  sede_id: string;
  moneda: string;
  tipo_comision?: string;
  cliente_id: string;
  nombre_cliente: string;
  cedula_cliente: string;
  email_cliente: string;
  telefono_cliente: string;
  items: ItemFactura[];
  historial_pagos?: HistorialPago[];
  desglose_pagos: DesglosePagos;
  profesional_id?: string;
  profesional_nombre?: string;
  numero_comprobante: string;
  facturado_por?: string;
  vendido_por?: string;
  estado?: string;
  estado_pago?: string;
  saldo_pendiente?: number | string | null;
  saldo_restante?: number | string | null;
  saldo?: number | string | null;
  total_pagado?: number | string | null;
  pagado?: number | string | null;
  valor_total?: number | string | null;
  factura_electronica_estado?: string;
  factura_electronica_id?: string;
  electronic_invoice_status?: string;
  electronic_invoice_id?: string;
  electronic_invoice_url?: string;
}

export interface ItemFactura {
  tipo: string;
  servicio_id?: string;
  producto_id?: string;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  moneda?: string;
  comision?: number;
  descuento?: string;
  profesional_nombre?: string;
  profesional_id?: string;
  duracion_minutos?: number;
  reserva_marca?: string;
}

export interface HistorialPago {
  fecha: string;
  monto: number;
  metodo: string;
  tipo: string;
  registrado_por: string;
  saldo_despues: number;
  notas: string;
}

export interface DesglosePagos {
  efectivo: number;
  total: number;
  tarjeta?: number;
  transferencia?: number;
  tarjeta_credito?: number;
  tarjeta_debito?: number;
  addi?: number;
}

export interface FacturaResponse {
  success: boolean;
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
    showing: number;
    from: number;
    to: number;
  };
  filters_applied: {
    sede_id: string;
    fecha_desde: string | null;
    fecha_hasta: string | null;
    profesional_id: string | null;
    search: string | null;
  };
  ventas: FacturaAPI[];
}

export interface FacturaConverted {
  identificador: string;
  fecha_pago: string;
  local: string;
  sede_id: string;
  venta_id?: string;
  moneda: string;
  tipo_comision: string;
  cliente_id: string;
  nombre_cliente: string;
  cedula_cliente: string;
  email_cliente: string;
  telefono_cliente: string;
  total: number;
  comprobante_de_pago: string;
  numero_comprobante: string;
  fecha_comprobante: string;
  monto: number;
  profesional_id: string;
  profesional_nombre: string;
  metodo_pago: string;
  facturado_por: string;
  vendido_por?: string;
  estado: string;
  items?: ItemFactura[];
  historial_pagos?: HistorialPago[];
  desglose_pagos?: DesglosePagos;
  electronic_invoice_status?: string;
  electronic_invoice_id?: string;
}

export class FacturaService {
  private static readonly DEFAULT_FULL_FROM = "1900-01-01";
  private static readonly DEFAULT_FULL_TO = "2999-12-31";
  private static readonly PAYMENT_EPSILON = 0.01;
  private static readonly DETAIL_REVALIDATION_LIMIT = 15;

  private getAuthToken(): string | null {
    return (
      sessionStorage.getItem("access_token") ||
      localStorage.getItem("access_token")
    );
  }

  private getStoredSedeId(): string | null {
    return (
      sessionStorage.getItem("beaux-active-sede_id") ||
      sessionStorage.getItem("beaux-sede_id") ||
      localStorage.getItem("beaux-active-sede_id") ||
      localStorage.getItem("beaux-sede_id")
    );
  }

  private getStoredSedeCandidates(): string[] {
    const seen = new Set<string>();
    const candidates = [
      sessionStorage.getItem("beaux-active-sede_id"),
      sessionStorage.getItem("beaux-sede_id"),
      sessionStorage.getItem("beaux-sede_id_principal"),
      sessionStorage.getItem("beaux-selected-sede_id"),
      localStorage.getItem("beaux-active-sede_id"),
      localStorage.getItem("beaux-sede_id"),
      localStorage.getItem("beaux-sede_id_principal"),
      localStorage.getItem("beaux-selected-sede_id"),
    ];

    return candidates.reduce<string[]>((acc, value) => {
      const normalized = String(value ?? "").trim();
      if (!normalized || seen.has(normalized)) return acc;
      seen.add(normalized);
      acc.push(normalized);
      return acc;
    }, []);
  }

  private async getSedeQueryCandidates(
    preferredSedeId?: string,
  ): Promise<string[]> {
    const initialCandidates = [
      String(preferredSedeId ?? "").trim(),
      ...this.getStoredSedeCandidates(),
    ].filter(Boolean);

    const pushUnique = (target: string[], value: string | null | undefined) => {
      const normalized = String(value ?? "").trim();
      if (!normalized || target.includes(normalized)) return;
      target.push(normalized);
    };

    const resolvedCandidates: string[] = [];
    initialCandidates.forEach((candidate) =>
      pushUnique(resolvedCandidates, candidate),
    );

    const token = this.getAuthToken();
    if (!token || resolvedCandidates.length === 0) {
      return resolvedCandidates;
    }

    try {
      const sedes = await getSedes(token);
      const normalizedCandidates = new Set(
        resolvedCandidates.map((candidate) => candidate.toUpperCase()),
      );

      sedes.forEach((sede) => {
        const ids = [
          String(sede.sede_id ?? "").trim(),
          String(sede._id ?? "").trim(),
          String(sede.unique_id ?? "").trim(),
        ].filter(Boolean);

        const matchesCandidate = ids.some((id) =>
          normalizedCandidates.has(id.toUpperCase()),
        );
        if (!matchesCandidate) return;

        pushUnique(resolvedCandidates, sede.sede_id);
        pushUnique(resolvedCandidates, sede._id);
        pushUnique(resolvedCandidates, sede.unique_id);
      });
    } catch (error) {
      console.warn(
        "No se pudieron resolver IDs alternos de sede para facturación:",
        error,
      );
    }

    return resolvedCandidates;
  }

  private normalizeDateRange(
    fecha_desde?: string,
    fecha_hasta?: string,
  ): { fecha_desde: string; fecha_hasta: string } {
    const desde = toBackendDate(String(fecha_desde || "").trim());
    const hasta = toBackendDate(String(fecha_hasta || "").trim());
    const defaultFrom = toBackendDate(FacturaService.DEFAULT_FULL_FROM);
    const defaultTo = toBackendDate(FacturaService.DEFAULT_FULL_TO);

    if (desde && hasta) {
      return { fecha_desde: desde, fecha_hasta: hasta };
    }

    if (desde && !hasta) {
      return { fecha_desde: desde, fecha_hasta: defaultTo };
    }

    if (!desde && hasta) {
      return { fecha_desde: defaultFrom, fecha_hasta: hasta };
    }

    return {
      fecha_desde: defaultFrom,
      fecha_hasta: defaultTo,
    };
  }

  private getHeaders() {
    const token = this.getAuthToken();
    const headers: HeadersInit = {
      accept: "application/json",
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return headers;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private normalizePaymentStatus(value: unknown): string | null {
    const normalized = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

    if (!normalized) return null;

    if (
      ["pagado", "paid", "pago_completo", "completo", "completed"].includes(
        normalized,
      )
    ) {
      return "pagado";
    }

    if (["pendiente", "pending", "por_pagar", "unpaid"].includes(normalized)) {
      return "pendiente";
    }

    if (
      [
        "abonado",
        "abono",
        "parcial",
        "partial",
        "partial_paid",
        "partially_paid",
      ].includes(normalized)
    ) {
      return "abonado";
    }

    return null;
  }

  private normalizePaymentMethod(value: unknown): string {
    const normalized = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

    switch (normalized) {
      case "cash":
        return "efectivo";
      case "credit_card":
        return "tarjeta_credito";
      case "debit_card":
        return "tarjeta_debito";
      case "bank_transfer":
      case "transfer":
        return "transferencia";
      default:
        return normalized || "efectivo";
    }
  }

  private getSafeHistorial(historial?: HistorialPago[]): HistorialPago[] {
    return Array.isArray(historial) ? historial.filter(Boolean) : [];
  }

  private getTimestamp(value: string | undefined): number {
    const timestamp = Date.parse(String(value || ""));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  private getLatestPago(historial: HistorialPago[]): HistorialPago | null {
    if (historial.length === 0) return null;

    return (
      historial
        .map((pago, index) => ({
          pago,
          index,
          timestamp: this.getTimestamp(pago?.fecha),
        }))
        .sort((a, b) => {
          if (a.timestamp !== b.timestamp) {
            return a.timestamp - b.timestamp;
          }
          return a.index - b.index;
        })
        .at(-1)?.pago ?? null
    );
  }

  private getTotalPagadoHistorial(historial: HistorialPago[]): number {
    return historial.reduce((sum, pago) => {
      const monto = this.toNumber(pago?.monto) ?? 0;
      return sum + Math.max(monto, 0);
    }, 0);
  }

  private getTotalPagadoDesglose(desglose?: DesglosePagos): number {
    if (!desglose) return 0;

    const amounts: number[] = [
      this.toNumber(desglose.efectivo) ?? 0,
      this.toNumber(desglose.tarjeta) ?? 0,
      this.toNumber(desglose.transferencia) ?? 0,
      this.toNumber(desglose.tarjeta_credito) ?? 0,
      this.toNumber(desglose.tarjeta_debito) ?? 0,
      this.toNumber(desglose.addi) ?? 0,
    ];

    return amounts.reduce((sum, value) => sum + Math.max(value, 0), 0);
  }

  private getFacturaTotal(factura: FacturaAPI): number {
    const totalFromDesglose = this.toNumber(factura.desglose_pagos?.total);
    if (totalFromDesglose !== null) {
      return totalFromDesglose;
    }

    const totalFromFactura = this.toNumber(factura.valor_total);
    if (totalFromFactura !== null) {
      return totalFromFactura;
    }

    if (Array.isArray(factura.items) && factura.items.length > 0) {
      return factura.items.reduce(
        (sum, item) => sum + (this.toNumber(item?.subtotal) ?? 0),
        0,
      );
    }

    return 0;
  }

  private getMetodoPagoPrincipal(
    desglose?: DesglosePagos,
    historial?: HistorialPago[],
  ): string {
    const historialSeguro = this.getSafeHistorial(historial);

    if (historialSeguro.length > 0) {
      const montosPorMetodo: Record<string, number> = {};

      historialSeguro.forEach((pago) => {
        const metodo = this.normalizePaymentMethod(pago?.metodo);
        const monto = Math.max(this.toNumber(pago?.monto) ?? 0, 0);
        montosPorMetodo[metodo] = (montosPorMetodo[metodo] || 0) + monto;
      });

      const metodoPrincipal = Object.entries(montosPorMetodo).sort(
        (a, b) => b[1] - a[1],
      )[0];
      if (metodoPrincipal && metodoPrincipal[1] > 0) {
        return metodoPrincipal[0];
      }
    }

    if (!desglose) return "efectivo";

    const metodos = [
      { metodo: "efectivo", monto: desglose.efectivo || 0 },
      { metodo: "tarjeta_credito", monto: desglose.tarjeta_credito || 0 },
      { metodo: "tarjeta_debito", monto: desglose.tarjeta_debito || 0 },
      { metodo: "addi", monto: desglose.addi || 0 },
      { metodo: "tarjeta", monto: desglose.tarjeta || 0 },
      { metodo: "transferencia", monto: desglose.transferencia || 0 },
    ];

    const metodoPrincipal = metodos.reduce((prev, current) =>
      prev.monto > current.monto ? prev : current,
    );

    return metodoPrincipal.monto > 0 ? metodoPrincipal.metodo : "efectivo";
  }

  private getEstadoFactura(
    factura: FacturaAPI,
    historial: HistorialPago[],
    total: number,
  ): string {
    const explicitStatus =
      this.normalizePaymentStatus(factura.estado_pago) ??
      this.normalizePaymentStatus(factura.estado);
    const latestPago = this.getLatestPago(historial);
    const saldoPendiente =
      [
        this.toNumber(factura.saldo_pendiente),
        this.toNumber(factura.saldo_restante),
        this.toNumber(factura.saldo),
        this.toNumber(latestPago?.saldo_despues),
      ].find((value) => value !== null) ?? null;
    const totalPagado = Math.max(
      this.getTotalPagadoHistorial(historial),
      this.getTotalPagadoDesglose(factura.desglose_pagos),
      this.toNumber(factura.total_pagado) ?? 0,
      this.toNumber(factura.pagado) ?? 0,
    );
    const reachedZeroBalance = historial.some((pago) => {
      const saldo = this.toNumber(pago?.saldo_despues);
      return (
        saldo !== null && Math.abs(saldo) <= FacturaService.PAYMENT_EPSILON
      );
    });

    if (saldoPendiente !== null) {
      if (Math.abs(saldoPendiente) <= FacturaService.PAYMENT_EPSILON) {
        return "pagado";
      }

      if (
        total > FacturaService.PAYMENT_EPSILON &&
        totalPagado + FacturaService.PAYMENT_EPSILON >= total
      ) {
        return "pagado";
      }

      if (explicitStatus) {
        return explicitStatus;
      }

      return totalPagado > FacturaService.PAYMENT_EPSILON
        ? "abonado"
        : "pendiente";
    }

    if (reachedZeroBalance) {
      return "pagado";
    }

    if (
      total > FacturaService.PAYMENT_EPSILON &&
      totalPagado + FacturaService.PAYMENT_EPSILON >= total
    ) {
      return "pagado";
    }

    if (explicitStatus) {
      return explicitStatus;
    }

    if (historial.length === 0) {
      if (totalPagado > FacturaService.PAYMENT_EPSILON || factura.fecha_pago) {
        return "pagado";
      }
      return "pendiente";
    }

    return totalPagado > FacturaService.PAYMENT_EPSILON
      ? "abonado"
      : "pendiente";
  }

  private async fetchDetalleVentaRaw(
    sede_id: string,
    venta_id: string,
  ): Promise<FacturaAPI> {
    const url = `${API_BASE_URL}api/billing/sales/${encodeURIComponent(sede_id)}/${encodeURIComponent(venta_id)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  private async fetchFacturasResult(
    sede_id: string,
    filtros: {
      searchTerm?: string;
      fecha_desde?: string;
      fecha_hasta?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{
    facturas: FacturaConverted[];
    pagination?: any;
    filters_applied?: any;
    paymentSummary?: PaymentMethodTotals | null;
  }> {
    let url = `${API_BASE_URL}api/billing/sales/${sede_id}`;
    const params = new URLSearchParams();
    const normalizedRange = this.normalizeDateRange(
      filtros.fecha_desde,
      filtros.fecha_hasta,
    );

    params.append("page", (filtros.page || 1).toString());
    params.append("limit", (filtros.limit || 50).toString());
    params.append("sort_order", "desc");

    if (filtros.searchTerm) {
      params.append("search", filtros.searchTerm);
    }

    params.append("fecha_desde", normalizedRange.fecha_desde);
    params.append("fecha_hasta", normalizedRange.fecha_hasta);

    url += `?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }

    const data: FacturaResponse = await response.json();
    const paymentSummary = extractPaymentMethodTotalsFromApiSummary(data);
    const ventas = Array.isArray(data.ventas)
      ? data.ventas.filter((factura) => factura != null)
      : [];
    const facturasIniciales = ventas.map((factura) =>
      this.convertToAppFormat(factura),
    );
    const facturas = await this.revalidateNonPaidFacturas(
      sede_id,
      ventas,
      facturasIniciales,
    );

    return {
      facturas,
      pagination: data.pagination,
      filters_applied: data.filters_applied,
      paymentSummary,
    };
  }

  async getDetalleVenta(
    sede_id: string,
    venta_id: string,
  ): Promise<FacturaConverted> {
    const factura = await this.fetchDetalleVentaRaw(sede_id, venta_id);
    return this.convertToAppFormat(factura);
  }

  private async revalidateNonPaidFacturas(
    sede_id: string,
    ventas: FacturaAPI[],
    facturas: FacturaConverted[],
  ): Promise<FacturaConverted[]> {
    const candidates = ventas
      .map((venta, index) => ({
        venta,
        index,
        factura: facturas[index],
      }))
      .filter(
        ({ venta, factura }) =>
          Boolean(venta?._id) && factura && factura.estado !== "pagado",
      )
      .slice(0, FacturaService.DETAIL_REVALIDATION_LIMIT);

    if (candidates.length === 0) {
      return facturas;
    }

    const refreshed = [...facturas];
    const results = await Promise.allSettled(
      candidates.map(({ venta }) =>
        this.fetchDetalleVentaRaw(sede_id, venta._id),
      ),
    );

    results.forEach((result, candidateIndex) => {
      if (result.status === "fulfilled") {
        const targetIndex = candidates[candidateIndex].index;
        refreshed[targetIndex] = this.convertToAppFormat(result.value);
      }
    });

    return refreshed;
  }

  // Obtener ventas/facturas de una sede específica con filtros
  async getVentasBySede(
    sede_id: string,
    page: number = 1,
    limit: number = 50,
    fecha_desde?: string,
    fecha_hasta?: string,
    search?: string,
  ): Promise<FacturaConverted[]> {
    try {
      const normalizedRange = this.normalizeDateRange(fecha_desde, fecha_hasta);

      // Construir URL con parámetros
      let url = `${API_BASE_URL}api/billing/sales/${sede_id}?page=${page}&limit=${limit}&sort_order=desc`;

      // Forzar rango explícito para evitar filtros implícitos del backend.
      url += `&fecha_desde=${normalizedRange.fecha_desde}`;
      url += `&fecha_hasta=${normalizedRange.fecha_hasta}`;

      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const data: FacturaResponse = await response.json();

      // Validar que data.ventas existe y es un array
      if (!data.ventas || !Array.isArray(data.ventas)) {
        console.warn("La respuesta no contiene un array válido de ventas");
        return [];
      }

      // Convertir los datos de la API al formato que usa nuestra aplicación
      const ventas = data.ventas.filter((factura) => factura != null);
      const facturas = ventas.map((factura) =>
        this.convertToAppFormat(factura),
      );
      return await this.revalidateNonPaidFacturas(sede_id, ventas, facturas);
    } catch (error) {
      console.error("Error obteniendo ventas de la sede:", error);
      throw error;
    }
  }

  /**
   * Obtener todas las ventas de una sede paginando automáticamente.
   * Útil para rangos amplios de fechas donde la API limita la cantidad por página.
   */
  async getVentasBySedeAllPages(
    sede_id: string,
    fecha_desde?: string,
    fecha_hasta?: string,
    search?: string,
    options?: { pageSize?: number; maxPages?: number },
  ): Promise<FacturaConverted[]> {
    const pageSize = Math.max(1, options?.pageSize || 200);
    const maxPages = Math.max(1, options?.maxPages || 500);
    const all: FacturaConverted[] = [];

    let page = 1;
    let keepGoing = true;

    while (keepGoing && page <= maxPages) {
      const pageData = await this.getVentasBySede(
        sede_id,
        page,
        pageSize,
        fecha_desde,
        fecha_hasta,
        search,
      );

      all.push(...pageData);

      // Si la página vino incompleta, asumimos que no hay más.
      if (pageData.length < pageSize) {
        keepGoing = false;
      } else {
        page += 1;
      }
    }

    return all;
  }

  // Obtener todas las facturas del usuario autenticado con filtros
  async getVentasUsuario(
    page: number = 1,
    limit: number = 50,
    fecha_desde?: string,
    fecha_hasta?: string,
    search?: string,
  ): Promise<FacturaConverted[]> {
    try {
      const sede_id = this.getStoredSedeId();

      if (!sede_id) {
        console.warn("No se encontró sede_id en la sesión");
        return [];
      }

      return await this.getVentasBySede(
        sede_id,
        page,
        limit,
        fecha_desde,
        fecha_hasta,
        search,
      );
    } catch (error) {
      console.error("Error obteniendo ventas del usuario:", error);
      return [];
    }
  }

  // Convertir datos de API al formato de la aplicación
  private convertToAppFormat(factura: FacturaAPI): FacturaConverted {
    const historial = this.getSafeHistorial(factura.historial_pagos);
    const metodoPago = this.getMetodoPagoPrincipal(
      factura.desglose_pagos,
      historial,
    );
    const total = this.getFacturaTotal(factura);
    const estado = this.getEstadoFactura(factura, historial, total);
    const fechaComprobante =
      this.getLatestPago(historial)?.fecha || factura.fecha_pago || "";

    // Obtener profesional_id y nombre de los items si no están en la factura
    let profesionalId = factura.profesional_id || "";
    let profesionalNombre = factura.profesional_nombre || "";

    // Si no hay profesional en la factura, buscarlo en los items
    if (!profesionalId && factura.items && factura.items.length > 0) {
      const primerItem = factura.items[0];
      profesionalId = primerItem.profesional_id || "";
      profesionalNombre = primerItem.profesional_nombre || "";
    }

    return {
      identificador: factura.identificador || "",
      fecha_pago: factura.fecha_pago || "",
      local: factura.local || "",
      sede_id: factura.sede_id || "",
      moneda: factura.moneda || "COP",
      tipo_comision: factura.tipo_comision || "porcentaje",
      cliente_id: factura.cliente_id || "",
      nombre_cliente: factura.nombre_cliente?.trim() || "",
      cedula_cliente: factura.cedula_cliente || "",
      email_cliente: factura.email_cliente || "",
      telefono_cliente: factura.telefono_cliente || "",
      total: total,
      comprobante_de_pago: "Factura",
      numero_comprobante: factura.numero_comprobante || "",
      fecha_comprobante: fechaComprobante,
      monto: total,
      profesional_id: profesionalId,
      profesional_nombre: profesionalNombre,
      metodo_pago: metodoPago,
      facturado_por: factura.facturado_por || factura.vendido_por || "Sistema",
      vendido_por: factura.vendido_por || factura.facturado_por || "Sistema",
      estado: estado,
      items: factura.items || [],
      historial_pagos: historial,
      desglose_pagos: factura.desglose_pagos,
      venta_id: factura._id || "",
      electronic_invoice_status:
        factura.electronic_invoice_status ||
        factura.factura_electronica_estado ||
        "",
      electronic_invoice_id:
        factura.electronic_invoice_id || factura.factura_electronica_id || "",
    };
  }

  // Buscar facturas con filtros (método mejorado)
  async buscarFacturas(filtros: {
    searchTerm?: string;
    fecha_desde?: string;
    fecha_hasta?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    facturas: FacturaConverted[];
    pagination?: any;
    filters_applied?: any;
    paymentSummary?: PaymentMethodTotals | null;
  }> {
    try {
      const sedeCandidates = await this.getSedeQueryCandidates(
        this.getStoredSedeId() ?? undefined,
      );

      if (sedeCandidates.length === 0) {
        console.warn("No se encontró sede_id");
        return { facturas: [], pagination: null, filters_applied: null };
      }

      let lastEmptyResult: {
        facturas: FacturaConverted[];
        pagination?: any;
        filters_applied?: any;
        paymentSummary?: PaymentMethodTotals | null;
      } = {
        facturas: [],
        pagination: null,
        filters_applied: null,
        paymentSummary: null,
      };
      let lastError: unknown = null;

      for (const sedeId of sedeCandidates) {
        try {
          const result = await this.fetchFacturasResult(sedeId, filtros);

          if (
            (result.facturas?.length || 0) > 0 ||
            (result.pagination?.total || 0) > 0
          ) {
            return result;
          }

          lastEmptyResult = result;
        } catch (error) {
          lastError = error;
          console.warn(
            `No se pudieron cargar facturas para sede ${sedeId}:`,
            error,
          );
        }
      }

      if (lastError && lastEmptyResult.facturas.length === 0) {
        throw lastError;
      }

      return lastEmptyResult;
    } catch (error) {
      console.error("Error buscando facturas:", error);
      throw error;
    }
  }
}

// Exportar una instancia única del servicio
export const facturaService = new FacturaService();
