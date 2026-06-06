"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { AlertTriangle, Loader2, AlertCircle, Globe, Check, ChevronDown, Building2, ChevronLeft, ChevronRight, Pencil, Plus, Search, SlidersHorizontal } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog"
import { inventarioService } from "../../PageSede/Products/inventario"
import type { InventarioProducto } from "../../PageSede/Products/inventario"
import { Sidebar } from "../../../components/Layout/Sidebar"
import { PageHeader } from "../../../components/Layout/PageHeader"
import { useAuth } from "../../../components/Auth/AuthContext"
import { API_BASE_URL } from "../../../types/config"
import { sedeService } from "../Sedes/sedeService"
import type { Sede } from "../../../types/sede"
import { facturaService } from "../../PageSede/Sales-invoiced/facturas"
import { mapProductsRows, buildInvoiceDateRange, type DateRange as DashboardDateRange } from "../Dashboard/super-admin-dashboard.utils"
import type { Factura } from "../../../types/factura"
import { normalizeCurrencyCode } from "../../../lib/currency"
import {
  type ProductSalesRow,
  ProductCardsGrid,
} from "../../../features/products-dashboard/components"
import { Alert, AlertDescription } from "../../../components/ui/alert"
import { Card, CardContent, CardHeader } from "../../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu"
import { cn } from "../../../lib/utils"
import {
  InventoryDashboardTab,
  InventoryMovimientosTab,
  InventoryKardexTab,
} from "../../PageSede/Products/ProductsInventoryViews"

const normalizeText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()

const PAGE_SIZE = 8

const formatMoney = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value)
}

type CatalogoProducto = {
  id: string
  nombre: string
  codigo: string
}

export function ProductsList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeProductsTab = searchParams.get("tab") || "lista"

  const [productos, setProductos] = useState<InventarioProducto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, _setPeriod] = useState<string>("today")
  const [dateRange, setDateRange] = useState<DashboardDateRange>(() =>
    buildInvoiceDateRange("today", { start_date: "", end_date: "" })
  )
  const [_ventasLoading, setVentasLoading] = useState(false)
  const [_ventasError, setVentasError] = useState<string | null>(null)
  const [_productSalesRows, setProductSalesRows] = useState<ProductSalesRow[]>([])
  const [ventasCurrency, setVentasCurrency] = useState<string>("COP")
  // Default a "all" para que el filtro inicial muestre todas las sedes
  const [selectedDashboardSede, setSelectedDashboardSede] = useState<string>("all")
  const [_multiSedeSales, setMultiSedeSales] = useState<Record<string, ProductSalesRow[]>>({})
  const [_multiSedeCurrency, setMultiSedeCurrency] = useState<Record<string, string>>({})
  const [_countrySales, setCountrySales] = useState<Record<string, ProductSalesRow[]>>({})
  const [_countryCurrency, setCountryCurrency] = useState<Record<string, string>>({})
  const [_missingCountrySedes, setMissingCountrySedes] = useState<string[]>([])
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<string>("")
  const [editingPrice, setEditingPrice] = useState<string>("")
  const [editingStock, setEditingStock] = useState<string>("")
  const [editingLoading, setEditingLoading] = useState<boolean>(false)
  const [productPrices, setProductPrices] = useState<Record<string, { price: number; currency: string }>>({})
  const [isCreateProductModalOpen, setIsCreateProductModalOpen] = useState(false)
  const [newProductName, setNewProductName] = useState("")
  const [newProductCategory, setNewProductCategory] = useState("")
  const [newProductCode, setNewProductCode] = useState("")
  const [newProductDescription, setNewProductDescription] = useState("")
  const [newProductPriceCOP, setNewProductPriceCOP] = useState("")
  const [newProductPriceUSD, setNewProductPriceUSD] = useState("")
  const [newProductPriceMXN, setNewProductPriceMXN] = useState("")
  const [newProductCommission, setNewProductCommission] = useState("")
  const [newProductStock, setNewProductStock] = useState("0")
  const [newProductStockMin, setNewProductStockMin] = useState("5")
  const [isCreatingProduct, setIsCreatingProduct] = useState(false)
  const [createProductError, setCreateProductError] = useState<string | null>(null)
  const [createProductSuccess, setCreateProductSuccess] = useState<string | null>(null)

  const [isSedeDropdownOpen, setIsSedeDropdownOpen] = useState(false)
  const sedeDropdownRef = useRef<HTMLDivElement>(null)

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isCreatingInventario, setIsCreatingInventario] = useState(false)
  const [modalDataError, setModalDataError] = useState<string | null>(null)
  const [isLoadingCreateData, setIsLoadingCreateData] = useState(false)
  const [sedesDisponibles, setSedesDisponibles] = useState<Sede[]>([])
  const [productosCatalogo, setProductosCatalogo] = useState<CatalogoProducto[]>([])
  const [nuevoProductoId, setNuevoProductoId] = useState("")
  const [nuevoSedeId, setNuevoSedeId] = useState("")
  const [nuevoStockInicial, setNuevoStockInicial] = useState("0")
  const [nuevoStockMinimo, setNuevoStockMinimo] = useState("5")
  const [creacionModo, setCreacionModo] = useState<"catalogo" | "manual">("catalogo")
  const [lineaFormulario, setLineaFormulario] = useState("")
  const [tipoProducto, setTipoProducto] = useState("ACCESORIO")
  const [catalogoProductosForm, setCatalogoProductosForm] = useState<CatalogoProducto[]>([])
  const [isLoadingCatalogo, setIsLoadingCatalogo] = useState(false)
  const [catalogoError, setCatalogoError] = useState<string | null>(null)
  const [nuevoNombreManual, setNuevoNombreManual] = useState("")
  const [nuevoSkuManual, setNuevoSkuManual] = useState("")
  const [precioReferencia, setPrecioReferencia] = useState("")
  const [costoReferencia, setCostoReferencia] = useState("")

  // Lista tab state (matching sede)
  const [searchTerm, setSearchTerm] = useState("")
  const [activeLineaTab, setActiveLineaTab] = useState<string>("all")
  const [showLowStock, setShowLowStock] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isNuevoProductoModalOpen, setIsNuevoProductoModalOpen] = useState(false)
  const [nuevaVariante, setNuevaVariante] = useState("")
  const [nuevaUnidad, setNuevaUnidad] = useState("Unidad")
  const [nuevoStockIdeal, setNuevoStockIdeal] = useState("20")
  const [paraVentaCheck, setParaVentaCheck] = useState(true)
  const [usoInternoCheck, setUsoInternoCheck] = useState(false)

  // Usar el AuthContext en lugar de sessionStorage
  const { user, isAuthenticated, isLoading: authLoading, activeSedeId } = useAuth()
  const isSuperAdmin = (user?.role || "").toString().toLowerCase().includes("super")
  const canAdjustStock = isSuperAdmin
  const canCreateInventory = isSuperAdmin

  // Obtener datos de la sede desde el AuthContext
  // También mantenemos compatibilidad con sessionStorage como fallback
  const sedeId = user?.sede_id || activeSedeId || sessionStorage.getItem("beaux-sede_id")
  const nombreLocal = user?.nombre_local || sessionStorage.getItem("beaux-nombre_local")
  const resolveToken = () =>
    user?.token ||
    user?.access_token ||
    sessionStorage.getItem("access_token") ||
    localStorage.getItem("access_token")

  const resolveSedeId = (preferida?: string | null) =>
    (preferida && preferida.trim() && preferida.trim() !== "all" ? preferida.trim() : "") ||
    activeSedeId ||
    sedeId ||
    sessionStorage.getItem("beaux-sede_id") ||
    localStorage.getItem("beaux-sede_id") ||
    ""

  // Mantener dateRange sincronizado cuando cambia el período (excepto custom)
  useEffect(() => {
    if (period === "custom") return
    const next = buildInvoiceDateRange(period, dateRange)
    if (next.start_date !== dateRange.start_date || next.end_date !== dateRange.end_date) {
      setDateRange(next)
    }
  }, [period])

  // Cargar inventario
  useEffect(() => {
    if (authLoading) return
    if (selectedDashboardSede === "all") {
      if (sedesDisponibles.length === 0) {
        setProductos([])
        setIsLoading(false)
        setError(null)
        return
      }
      const loadAll = async () => {
        setIsLoading(true)
        setError(null)
        try {
          const token = resolveToken()
          if (!token) { setError("No hay token de autenticación"); return }
          const results = await Promise.allSettled(
            sedesDisponibles.map((sede) =>
              inventarioService.getInventarioUsuario(false, token, sede.sede_id)
            )
          )
          const merged: InventarioProducto[] = []
          results.forEach((r) => {
            if (r.status === "fulfilled") merged.push(...r.value)
          })
          setProductos(merged)
        } catch (err) {
          setError(err instanceof Error ? err.message : "Error al cargar inventarios")
          setProductos([])
        } finally {
          setIsLoading(false)
        }
      }
      void loadAll()
      return
    }
    cargarInventario(selectedDashboardSede || null)
  }, [authLoading, sedeId, activeSedeId, selectedDashboardSede, sedesDisponibles])

  // Mostrar mensaje si no está autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setError("Debes iniciar sesión para acceder al inventario")
      setIsLoading(false)
    }
  }, [authLoading, isAuthenticated])

  const selectedSedeName = useMemo(() => {
    const match = sedesDisponibles.find((sede) => sede.sede_id === selectedDashboardSede)
    return match?.nombre || nombreLocal || "Sede seleccionada"
  }, [sedesDisponibles, selectedDashboardSede, nombreLocal])

  useEffect(() => {
    const buildRange = () =>
      period === "custom" && dateRange.start_date && dateRange.end_date
        ? dateRange
        : buildInvoiceDateRange(period === "custom" ? "last_30_days" : period, dateRange)

    const cargarVentasProductosSede = async (sedeObjetivo: string) => {
      const effectiveRange = buildRange()
      const facturas = await facturaService.getVentasBySede(
        sedeObjetivo,
        1,
        200,
        effectiveRange.start_date,
        effectiveRange.end_date
      )
      const currency = normalizeCurrencyCode(facturas[0]?.moneda || user?.moneda || "COP")
      const rows = mapProductsRows(facturas as Factura[], currency).map((row) => ({
        productId: row.productId,
        nombre: row.producto,
        unidades: row.unidades,
        monto: row.ventas,
        currency: row.currency,
        participacion: row.participacion,
      }))
      return { rows, currency }
    }

    const cargarVentasProductos = async () => {
      if (!isAuthenticated) return

      const sedeObjetivo = selectedDashboardSede || resolveSedeId()
      if (!sedeObjetivo) {
        setVentasError("Selecciona una sede para ver las ventas de productos")
        setProductSalesRows([])
        return
      }

      try {
        setVentasLoading(true)
        setVentasError(null)

        if (sedeObjetivo === "all") {
          const mapaVentas: Record<string, ProductSalesRow[]> = {}
          const mapaMoneda: Record<string, string> = {}
          const sedes = sedesDisponibles.length > 0 ? sedesDisponibles : []

          if (sedes.length === 0) {
            setVentasError("No hay sedes disponibles para mostrar")
            setVentasLoading(false)
            return
          }

          await Promise.all(
            sedes.map(async (sede) => {
              try {
                const resultado = await cargarVentasProductosSede(sede.sede_id)
                mapaVentas[sede.sede_id] = resultado.rows
                mapaMoneda[sede.sede_id] = resultado.currency
              } catch (err) {
                console.warn(`No se pudieron cargar ventas para la sede ${sede.nombre}`, err)
              }
            })
          )

          setMultiSedeSales(mapaVentas)
          setMultiSedeCurrency(mapaMoneda)
          agruparVentasPorPais(sedes, mapaVentas, mapaMoneda)
          setProductSalesRows([])
        } else {
          const resultado = await cargarVentasProductosSede(sedeObjetivo)
          setVentasCurrency(resultado.currency)
          setProductSalesRows(resultado.rows)
          setCountrySales({})
          setMissingCountrySedes([])
        }
      } catch (err) {
        console.error("Error cargando ventas de productos:", err)
        setVentasError(
          err instanceof Error ? err.message : "No se pudieron cargar las ventas de productos"
        )
        setProductSalesRows([])
        setMultiSedeSales({})
        setCountrySales({})
        setMissingCountrySedes([])
      } finally {
        setVentasLoading(false)
      }
    }

    void cargarVentasProductos()
  }, [selectedDashboardSede, period, dateRange, isAuthenticated, user, sedesDisponibles])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sedeDropdownRef.current && !sedeDropdownRef.current.contains(e.target as Node)) {
        setIsSedeDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    const resolved = resolveSedeId()
    if (resolved && !nuevoSedeId) {
      setNuevoSedeId(resolved)
    }
  }, [sedeId, activeSedeId, nuevoSedeId])

  useEffect(() => {
    const cargarSedesDisponibles = async () => {
      const token = resolveToken()
      if (!token) return
      try {
        const sedes = await sedeService.getSedes(token)
        setSedesDisponibles(sedes)
        if (!selectedDashboardSede) {
          const resolvedPreferida = resolveSedeId() || sedes[0]?.sede_id || ""
          const next = resolvedPreferida || "all"
          setSelectedDashboardSede(next)
          if (next !== "all" && next.trim()) {
            setNuevoSedeId(next)
          } else if (sedes[0]?.sede_id) {
            setNuevoSedeId(sedes[0].sede_id)
          }
        }
      } catch (err) {
        console.warn("No se pudieron cargar las sedes disponibles:", err)
      }
    }

    void cargarSedesDisponibles()
  }, [authLoading])

  useEffect(() => {
    if (!authLoading && nuevoSedeId) {
      void cargarCatalogoProductosForm(nuevoSedeId)
    }
  }, [authLoading, nuevoSedeId])

  const cargarInventario = async (sedeDestino?: string | null) => {
    if (sedeDestino === "all") {
      setProductos([])
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      setError(null)

      // Verificar que tenemos los datos necesarios
      const sedeObjetivo = resolveSedeId(sedeDestino)
      if (!sedeObjetivo) {
        setError("Selecciona una sede para gestionar el inventario")
        return
      }

      const token = resolveToken()
      if (!token) {
        setError("No hay token de autenticación disponible")
        return
      }

      // Pasar el token y sede_id al servicio
      const inventario = await inventarioService.getInventarioUsuario(
        false,
        token,
        sedeObjetivo
      )

      setProductos(inventario)

    } catch (err) {
      console.error("Error cargando inventario:", err)
      const errorMessage = err instanceof Error ? err.message : "Error al cargar el inventario. Por favor, intenta nuevamente."
      setError(errorMessage)
      setProductos([])
    } finally {
      setIsLoading(false)
    }
  }

  const lineasDisponibles = useMemo(() => {
    const seen = new Set<string>()
    const result: { id: string; label: string }[] = []

    productos.forEach((producto) => {
      const label = (producto.categoria || "").trim()
      if (!label) return
      const id = normalizeText(label) || label.toLowerCase()
      if (seen.has(id)) return
      seen.add(id)
      result.push({ id, label })
    })

    if (result.length === 0) {
      return [{ id: "general", label: "General" }]
    }

    return result
  }, [productos])

  useEffect(() => {
    if (!lineaFormulario && lineasDisponibles.length > 0) {
      setLineaFormulario(lineasDisponibles[0].id)
    }
  }, [lineasDisponibles, lineaFormulario])

  // Validate activeLineaTab when lineas change
  useEffect(() => {
    if (activeLineaTab === "all") return
    const exists = lineasDisponibles.some((l) => l.id === activeLineaTab)
    if (!exists) setActiveLineaTab("all")
  }, [lineasDisponibles, activeLineaTab])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, activeLineaTab])

  // Auto-clear success message
  useEffect(() => {
    if (!successMessage) return
    const id = window.setTimeout(() => setSuccessMessage(null), 3000)
    return () => window.clearTimeout(id)
  }, [successMessage])

  const filteredProductos = useMemo(() => {
    let data = [...productos]
    if (activeLineaTab !== "all") {
      data = data.filter((p) => normalizeText(p.categoria) === normalizeText(activeLineaTab))
    }
    if (showLowStock) {
      data = data.filter((p) => Number(p.stock_actual ?? 0) <= Number(p.stock_minimo ?? 0))
    }
    if (searchTerm.trim()) {
      const term = normalizeText(searchTerm)
      data = data.filter(
        (p) =>
          normalizeText(p.producto_nombre).includes(term) ||
          normalizeText(p.nombre).includes(term) ||
          normalizeText(p.producto_codigo).includes(term)
      )
    }
    return data
  }, [productos, activeLineaTab, searchTerm, showLowStock])

  const totalPages = Math.max(1, Math.ceil(filteredProductos.length / PAGE_SIZE))
  const currentPageSafe = Math.min(currentPage, totalPages)
  const paginatedProductos = filteredProductos.slice(
    (currentPageSafe - 1) * PAGE_SIZE,
    currentPageSafe * PAGE_SIZE
  )
  const pageStart = filteredProductos.length === 0 ? 0 : (currentPageSafe - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(filteredProductos.length, currentPageSafe * PAGE_SIZE)

  const kpis = useMemo(() => ({
    totalProductos: productos.length,
    totalUnidades: productos.reduce((acc, p) => acc + Number(p.stock_actual ?? 0), 0),
    criticos: productos.filter((p) => Number(p.stock_actual ?? 0) <= Number(p.stock_minimo ?? 0)).length,
    sinStock: productos.filter((p) => Number(p.stock_actual ?? 0) <= 0).length,
  }), [productos])

  const handleLineaChange = (lineaId: string) => {
    setActiveLineaTab(lineaId)
    setCurrentPage(1)
  }

  const handleFiltrarStockBajo = () => {
    setShowLowStock((prev) => !prev)
  }

  const renderEstadoBadge = (producto: InventarioProducto) => {
    const actual = Number(producto.stock_actual ?? 0)
    if (actual <= 0) {
      return <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-50 text-red-600">Sin stock</span>
    }
    return <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">Activo</span>
  }

  const agruparVentasPorPais = (
    sedes: Sede[],
    ventasPorSede: Record<string, ProductSalesRow[]>,
    monedaPorSede: Record<string, string>
  ) => {
    const missing: string[] = []
    const agrupado: Record<string, Record<string, ProductSalesRow>> = {}
    const monedaPais: Record<string, string> = {}

    sedes.forEach((sede) => {
      const pais = (sede.pais || "").trim()
      if (!pais) {
        missing.push(sede.nombre)
        return
      }

      const rows = ventasPorSede[sede.sede_id] || []
      if (!monedaPais[pais]) {
        monedaPais[pais] = monedaPorSede[sede.sede_id] || sede.moneda || ventasCurrency
      }

      rows.forEach((row) => {
        const key = row.productId || row.nombre
        if (!agrupado[pais]) agrupado[pais] = {}
        const existente = agrupado[pais][key]
        if (existente) {
          agrupado[pais][key] = {
            ...existente,
            unidades: existente.unidades + row.unidades,
            monto: existente.monto + row.monto,
          }
        } else {
          agrupado[pais][key] = { ...row }
        }
      })
    })

    const resultado: Record<string, ProductSalesRow[]> = {}
    Object.entries(agrupado).forEach(([pais, rowsMap]) => {
      resultado[pais] = Object.values(rowsMap).sort((a, b) => b.unidades - a.unidades)
    })

    setCountrySales(resultado)
    setCountryCurrency(monedaPais)
    setMissingCountrySedes(missing)
  }

  const abrirModalCreacion = () => {
    setModalDataError(null)
    setCatalogoError(null)
    setNuevoProductoId("")
    setNuevoSedeId(
      selectedDashboardSede && selectedDashboardSede !== "all"
        ? selectedDashboardSede
        : resolveSedeId() || ""
    )
    setNuevoNombreManual("")
    setNuevoSkuManual("")
    setNuevoStockInicial("0")
    setNuevoStockMinimo("5")
    setNuevoStockIdeal("20")
    setLineaFormulario("")
    setTipoProducto("ACCESORIO")
    setPrecioReferencia("")
    setCostoReferencia("")
    setParaVentaCheck(true)
    setUsoInternoCheck(false)
    setIsNuevoProductoModalOpen(true)
    void cargarDatosModalCreacion()
  }

  const cerrarModalCreacion = () => {
    setIsCreateModalOpen(false)
    setModalDataError(null)
  }

  const parseApiErrorSimple = (error: unknown): string => {
    if (error instanceof Error) return error.message
    if (typeof error === "string") return error
    return "No fue posible completar la operación"
  }

  const cargarCatalogoProductosForm = async (sedeObjetivo?: string) => {
    const sedeDestino = sedeObjetivo || nuevoSedeId || resolveSedeId()
    if (!sedeDestino) return
    const token = resolveToken()
    if (!token) return

    try {
      setIsLoadingCatalogo(true)
      setCatalogoError(null)

      const response = await fetch(
        `${API_BASE_URL}inventary/product/productos/?moneda=COP&sede_id=${sedeDestino}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      )

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.detail || "No se pudo cargar el catálogo de productos")
      }

      const items = Array.isArray(data)
        ? data
        : Array.isArray((data as { results?: unknown }).results)
          ? (data as { results: unknown[] }).results
          : []

      const formatted = (items as any[])
        .filter((item) => item?._id && item?.nombre)
        .map((item) => ({
          id: String(item._id),
          nombre: String(item.nombre),
          codigo: item.codigo || item.producto_codigo || "—",
        }))
        .filter((item) => !productos.some((p) => p.producto_id === item.id))

      setCatalogoProductosForm(formatted)
    } catch (err) {
      setCatalogoError(parseApiErrorSimple(err))
    } finally {
      setIsLoadingCatalogo(false)
    }
  }

  const crearInventarioDesdeCard = async () => {
    if (creacionModo === "manual") {
      setCatalogoError("Crear producto desde cero está listo en UI. Conecta el endpoint de creación y reemplaza este aviso.")
      return
    }

    const token = resolveToken()
    if (!token) {
      setCatalogoError("No se encontró token de autenticación")
      return
    }
    const sedeDestino = (nuevoSedeId || resolveSedeId())?.trim()
    if (!sedeDestino) {
      setCatalogoError("Selecciona una sede para registrar el inventario")
      return
    }
    if (!nuevoProductoId) {
      setCatalogoError("Selecciona un producto del catálogo")
      return
    }

    const payload = {
      producto_id: nuevoProductoId,
      sede_id: sedeDestino,
      stock_actual: Number(nuevoStockInicial) || 0,
      stock_minimo: Number(nuevoStockMinimo) || 0,
    }

    try {
      setIsCreatingInventario(true)
      setCatalogoError(null)
      const result = await inventarioService.crearInventario(payload, token)
      if (!result.success) {
        setCatalogoError(result.error || "No se pudo crear el inventario")
        return
      }
      setCreateProductSuccess(result.message || "Producto agregado al inventario")
      setNuevoProductoId("")
      setNuevoStockInicial("0")
      setNuevoStockMinimo("5")
      setPrecioReferencia("")
      setCostoReferencia("")
      setTipoProducto("ACCESORIO")
      setLineaFormulario(lineasDisponibles[0]?.id ?? "")
      await Promise.all([
        cargarInventario(sedeDestino),
        cargarCatalogoProductosForm(sedeDestino),
      ])
    } catch (err) {
      setCatalogoError(parseApiErrorSimple(err))
    } finally {
      setIsCreatingInventario(false)
    }
  }

  const parseApiError = async (response: Response, fallback: string) => {
    try {
      const body = await response.json() as { detail?: string | Array<{ msg?: string }> }
      if (typeof body?.detail === "string" && body.detail.trim().length > 0) {
        return body.detail
      }
      if (Array.isArray(body?.detail) && body.detail.length > 0) {
        const firstMessage = body.detail[0]?.msg
        if (typeof firstMessage === "string" && firstMessage.trim().length > 0) {
          return firstMessage
        }
      }
      return fallback
    } catch {
      return fallback
    }
  }

  const handleCreateProduct = async () => {
    setCreateProductError(null)
    setCreateProductSuccess(null)

    const nombre = newProductName.trim()
    if (!nombre) {
      setCreateProductError("El nombre es obligatorio")
      return
    }

    const parseNumber = (value: string) => {
      const num = Number(value)
      return Number.isFinite(num) ? num : NaN
    }

    const precios: Record<string, number> = {}
    const cop = parseNumber(newProductPriceCOP)
    const usd = parseNumber(newProductPriceUSD)
    const mxn = parseNumber(newProductPriceMXN)

    if (Number.isFinite(cop) && cop > 0) precios.COP = cop
    if (Number.isFinite(usd) && usd > 0) precios.USD = usd
    if (Number.isFinite(mxn) && mxn > 0) precios.MXN = mxn

    if (Object.keys(precios).length === 0) {
      setCreateProductError("Debes ingresar al menos un precio (COP, USD o MXN)")
      return
    }

    const stockActual = parseNumber(newProductStock)
    const stockMinimo = parseNumber(newProductStockMin)
    if (!Number.isFinite(stockActual) || stockActual < 0) {
      setCreateProductError("Stock actual debe ser un número mayor o igual a 0")
      return
    }
    if (!Number.isFinite(stockMinimo) || stockMinimo < 0) {
      setCreateProductError("Stock mínimo debe ser un número mayor o igual a 0")
      return
    }

    const comision = newProductCommission.trim()
    let comisionNum: number | undefined
    if (comision) {
      comisionNum = Number(comision)
      if (!Number.isFinite(comisionNum) || comisionNum < 0 || comisionNum > 100) {
        setCreateProductError("La comisión debe estar entre 0 y 100")
        return
      }
    }

    const token = resolveToken()
    if (!token) {
      setCreateProductError("No hay token de autenticación disponible")
      return
    }

    const payload = {
      nombre,
      codigo: newProductCode.trim() || undefined,
      descripcion: newProductDescription.trim() || undefined,
      categoria: newProductCategory.trim() || undefined,
      comision: comision ? comisionNum : undefined,
      precios,
      stock_actual: stockActual || 0,
      stock_minimo: stockMinimo || 0,
    }

    setIsCreatingProduct(true)
    try {
      const response = await fetch(`${API_BASE_URL}inventary/product/productos/`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(await parseApiError(response, "No se pudo crear el producto"))
      }

      const data = await response.json() as { msg?: string; producto?: { id?: string; _id?: string } }
      setCreateProductSuccess(data.msg || "Producto creado correctamente")

      const createdId = data.producto?.id || data.producto?._id
      if (createdId) {
        setNuevoProductoId(String(createdId))
      }

      // Refrescar catálogo y limpiar formulario
      try {
        const catalogoActualizado = await cargarCatalogoProductos(token)
        setProductosCatalogo(catalogoActualizado)
      } catch {
        // si falla, no interrumpe la UX principal
      }

      setNewProductName("")
      setNewProductCategory("")
      setNewProductCode("")
      setNewProductDescription("")
      setNewProductPriceCOP("")
      setNewProductPriceUSD("")
      setNewProductPriceMXN("")
      setNewProductCommission("")
      setNewProductStock("0")
      setNewProductStockMin("5")
    } catch (err) {
      setCreateProductError(err instanceof Error ? err.message : "Error desconocido al crear el producto")
    } finally {
      setIsCreatingProduct(false)
    }
  }

  const cargarCatalogoProductos = async (token: string): Promise<CatalogoProducto[]> => {
    const moneda = (user?.moneda || sessionStorage.getItem("beaux-moneda") || "USD").toUpperCase()
    const params = new URLSearchParams()
    params.set("moneda", moneda)
    const url = `${API_BASE_URL}inventary/product/productos/?${params.toString()}`

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error(await parseApiError(response, `Error ${response.status}: ${response.statusText}`))
    }

    const data = await response.json()
    const rawProductos: Array<Record<string, unknown>> = Array.isArray(data)
      ? data
      : Array.isArray((data as { productos?: Array<Record<string, unknown>> })?.productos)
        ? (data as { productos: Array<Record<string, unknown>> }).productos
        : Array.isArray((data as { items?: Array<Record<string, unknown>> })?.items)
          ? (data as { items: Array<Record<string, unknown>> }).items
          : []

    const productosNormalizados = rawProductos
      .map((producto) => {
        const id = String(producto.id ?? producto._id ?? producto.producto_id ?? "").trim()
        const nombre = String(producto.nombre ?? producto.producto_nombre ?? "").trim()
        const codigo = String(producto.codigo ?? producto.producto_codigo ?? "").trim()
        if (!id || !nombre) {
          return null
        }
        return { id, nombre, codigo }
      })
      .filter((producto): producto is CatalogoProducto => Boolean(producto))

    const mapPorId = new Map<string, CatalogoProducto>()
    productosNormalizados.forEach((producto) => {
      if (!mapPorId.has(producto.id)) {
        mapPorId.set(producto.id, producto)
      }
    })

    return Array.from(mapPorId.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }

  const cargarDatosModalCreacion = async () => {
    const token = resolveToken()
    if (!token) {
      setModalDataError("No hay token de autenticación disponible para cargar los catálogos")
      return
    }

    setIsLoadingCreateData(true)
    setModalDataError(null)

    const [sedesResult, productosResult] = await Promise.allSettled([
      sedeService.getSedes(token),
      cargarCatalogoProductos(token),
    ])

    const errores: string[] = []

    if (sedesResult.status === "fulfilled") {
      const sedes = sedesResult.value
      setSedesDisponibles(sedes)
      if (!nuevoSedeId && sedes.length > 0) {
        const sedeActual = sedes.find((sede) => sede.sede_id === sedeId || sede._id === sedeId)
        setNuevoSedeId(sedeActual?.sede_id || sedes[0].sede_id)
      }
    } else {
      setSedesDisponibles([])
      errores.push("No se pudieron cargar las sedes")
    }

    if (productosResult.status === "fulfilled") {
      const catalogo = productosResult.value
      setProductosCatalogo(catalogo)
      setCatalogoProductosForm(catalogo)
      if (!nuevoProductoId && catalogo.length === 1) {
        setNuevoProductoId(catalogo[0].id)
      }
    } else {
      setProductosCatalogo([])
      setCatalogoProductosForm([])
      errores.push("No se pudieron cargar los productos")
    }

    if (errores.length > 0) {
      setModalDataError(`${errores.join(". ")}.`)
    }

    setIsLoadingCreateData(false)
  }

  // Mostrar loading mientras se verifica la autenticación
  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
          <p className="text-gray-600 ml-2">Verificando autenticación...</p>
        </div>
      </div>
    )
  }

  // Mostrar mensaje de error si no está autenticado
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex flex-col items-center justify-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Acceso no autorizado</h2>
          <p className="text-gray-600 mb-4">Debes iniciar sesión para acceder a esta página</p>
          <Button
            onClick={() => window.location.href = "/login"} // Ajusta la ruta según tu aplicación
            className="bg-black text-white hover:bg-neutral-900"
          >
            Ir al inicio de sesión
          </Button>
        </div>
      </div>
    )
  }

  const productCards = useMemo(
    () =>
      {
        const base = productos.map((p) => ({
          id: p.producto_id || p._id,
          nombre: p.nombre || p.producto_nombre || "Producto",
          categoria: p.categoria,
          codigo: p.producto_codigo,
          stock: p.stock_actual,
          stockMinimo: p.stock_minimo,
          updatedAt: p.fecha_ultima_actualizacion,
          price: productPrices[p.producto_id || p._id]?.price,
          priceCurrency: productPrices[p.producto_id || p._id]?.currency || ventasCurrency,
        }))

        if (!isSuperAdmin) return base

        const existingIds = new Set(base.map((p) => p.id))
        const extras = productosCatalogo
          .filter((prod) => prod.id && !existingIds.has(prod.id))
          .map((prod) => ({
            id: prod.id,
            nombre: prod.nombre || "Producto",
            categoria: prod.codigo ? `Código: ${prod.codigo}` : undefined,
            codigo: prod.codigo,
            stock: 0,
            stockMinimo: 0,
            price: productPrices[prod.id]?.price,
            priceCurrency: productPrices[prod.id]?.currency || ventasCurrency,
          }))

        return [...base, ...extras]
      },
    [productos, productosCatalogo, productPrices, ventasCurrency, isSuperAdmin]
  )

  useEffect(() => {
    // Evitar llamadas que generan CORS en entornos locales con preview API
    if (typeof window !== "undefined" && window.location.origin.includes("localhost") && API_BASE_URL.includes("previewapi.rizosfelices.co")) {
      return
    }

    const fetchPrices = async () => {
      const token = resolveToken()
      const moneda = ventasCurrency || user?.moneda || "COP"
      const ids = productos.map((p) => p.producto_id || p._id).filter(Boolean)
      if (!token || ids.length === 0) return
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            const resp = await fetch(
              `${API_BASE_URL}inventary/product/productos/${encodeURIComponent(id)}?moneda=${encodeURIComponent(moneda)}`,
              {
                headers: {
                  Accept: "application/json",
                  Authorization: `Bearer ${token}`,
                },
              }
            )
            if (!resp.ok) return null
            const data = await resp.json() as any
            const price =
              data?.precio_local ??
              data?.precio ??
              (data?.precios && (data.precios[moneda] ?? data.precios.USD))
            if (price === undefined || price === null) return null
            return { id, price: Number(price), currency: moneda }
          })
        )
        const map: Record<string, { price: number; currency: string }> = {}
        results.forEach((r) => {
          if (r) map[r.id] = { price: r.price, currency: r.currency }
        })
        if (Object.keys(map).length > 0) {
          setProductPrices((prev) => ({ ...prev, ...map }))
        }
      } catch (err) {
        console.warn("No se pudieron obtener precios de productos", err)
      }
    }
    fetchPrices().catch(() => {})
  }, [productos, ventasCurrency, user])

  const openEditModal = async (productId: string) => {
    const product = productCards.find((p) => p.id === productId)
    if (!product) return
    setEditingProductId(productId)
    setEditingName(product.nombre)
    setEditingStock(
      product.stock !== undefined && product.stock !== null
        ? String(product.stock)
        : "0"
    )
    const cachedPrice = productPrices[productId]?.price
    setEditingPrice(cachedPrice !== undefined ? String(cachedPrice) : "")
    setEditingLoading(true)
    try {
      const token = resolveToken()
      const moneda = ventasCurrency || "COP"
      const resp = await fetch(
        `${API_BASE_URL}inventary/product/productos/${encodeURIComponent(productId)}?moneda=${encodeURIComponent(moneda)}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: token ? `Bearer ${token}` : "",
          },
        }
      )
      if (resp.ok) {
        const data = await resp.json() as any
        const precio =
          data?.precio_local ??
          data?.precio ??
          (data?.precios && (data.precios[moneda] ?? data.precios.USD)) ??
          ""
        setEditingPrice(
          precio !== null && precio !== undefined
            ? String(precio)
            : cachedPrice !== undefined
              ? String(cachedPrice)
              : ""
        )
      }
    } catch (err) {
      console.warn("No se pudo obtener precio del producto", err)
    } finally {
      setEditingLoading(false)
    }
  }

  const handleSaveEdit = () => {
    if (!editingProductId) return
    setProductos((prev) =>
      prev.map((p) =>
        (p.producto_id || p._id) === editingProductId
          ? {
              ...p,
              nombre: editingName || p.nombre,
              stock_actual: Number(editingStock) || 0,
            }
          : p
      )
    )
    setEditingProductId(null)
  }

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <Sidebar />
      <div className="flex-1">
        {/* Products sub-navigation */}
        <div className="border-b border-gray-200 bg-white px-4 md:px-8 pt-1 flex items-end gap-2 min-w-0">
          <nav className="flex gap-0 overflow-x-auto flex-1 min-w-0">
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

          {/* Sede selector — Vista Global style */}
          <div className="relative mb-1.5 flex-shrink-0" ref={sedeDropdownRef}>
            <button
              onClick={() => setIsSedeDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
            >
              {selectedDashboardSede === "all" ? (
                <Globe className="h-4 w-4 text-gray-500 shrink-0" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              )}
              <span className="max-w-[160px] truncate">
                {selectedDashboardSede === "all"
                  ? "Vista Global"
                  : sedesDisponibles.find((s) => s.sede_id === selectedDashboardSede)?.nombre || "Sede"}
              </span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-gray-400 transition-transform", isSedeDropdownOpen && "rotate-180")} />
            </button>

            {isSedeDropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white py-1 shadow-lg max-h-80 overflow-y-auto">
                {/* Vista Global option */}
                <button
                  onClick={() => {
                    setSelectedDashboardSede("all")
                    setIsSedeDropdownOpen(false)
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Globe className="h-4 w-4 text-gray-500 shrink-0" />
                  <span className="flex-1 text-left">Vista Global</span>
                  {selectedDashboardSede === "all" && <Check className="h-4 w-4 text-gray-900" />}
                </button>

                {/* Divider */}
                <div className="my-1 border-t border-gray-100" />

                {/* Individual sedes */}
                {sedesDisponibles.map((sede) => (
                  <button
                    key={sede.sede_id}
                    onClick={() => {
                      setSelectedDashboardSede(sede.sede_id)
                      setNuevoSedeId(sede.sede_id)
                      setIsSedeDropdownOpen(false)
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="flex-1 truncate text-left">{sede.nombre}</span>
                    {selectedDashboardSede === sede.sede_id && <Check className="h-4 w-4 text-gray-900 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {activeProductsTab !== "lista" ? (
          <div className="p-4 md:p-8">
            {activeProductsTab === "dashboard" && (
              <InventoryDashboardTab
                productos={productos}
                sedeLabel={selectedSedeName || selectedDashboardSede || "Sede"}
                sedeId={resolveSedeId(selectedDashboardSede)}
              />
            )}
            {activeProductsTab === "movimientos" && (
              <InventoryMovimientosTab
                productos={productos}
                sedeLabel={selectedSedeName || "Sede"}
                sedeId={resolveSedeId(selectedDashboardSede)}
              />
            )}
            {activeProductsTab === "kardex" && (
              <InventoryKardexTab
                productos={productos}
                sedeId={resolveSedeId(selectedDashboardSede)}
              />
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

          <>
            <PageHeader
              title="Productos"
              actions={
                canCreateInventory ? (
                  <Button
                    onClick={abrirModalCreacion}
                    className="bg-black text-white hover:bg-gray-800"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Nuevo producto
                  </Button>
                ) : null
              }
            />

            {selectedDashboardSede === "all" && (
              <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
                <Globe className="h-4 w-4 shrink-0" />
                <span>Vista Global — mostrando inventario consolidado de <strong>{sedesDisponibles.length}</strong> {sedesDisponibles.length === 1 ? "sede" : "sedes"}</span>
              </div>
            )}

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
                    {selectedDashboardSede !== "all" && (
                      <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                        <Building2 className="h-4 w-4 text-gray-500" />
                        <div className="leading-tight">
                          <div className="text-[11px] uppercase tracking-[0.08em] text-gray-400">Sede</div>
                          <div className="font-medium text-gray-800">{selectedSedeName || "Sede seleccionada"}</div>
                        </div>
                      </div>
                    )}

                    <Button
                      variant={showLowStock ? "default" : "outline"}
                      onClick={handleFiltrarStockBajo}
                      className={cn(
                        "text-sm",
                        showLowStock
                          ? "bg-black text-white hover:bg-gray-800"
                          : "border-gray-300 text-gray-700 hover:bg-gray-100"
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
                      <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Producto</TableHead>
                      {selectedDashboardSede === "all" && (
                        <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Sede</TableHead>
                      )}
                      <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Línea</TableHead>
                      <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">SKU</TableHead>
                      <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-center">Stock</TableHead>
                      <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-center">Mín</TableHead>
                      <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-center">Ventas</TableHead>
                      <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-center">Precio</TableHead>
                      <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-center">Costo</TableHead>
                      <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Estado</TableHead>
                      <TableHead className="w-10 px-4 py-3" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={selectedDashboardSede === "all" ? 11 : 10} className="px-4 py-8 text-center text-sm text-gray-500">
                          <div className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {selectedDashboardSede === "all" ? "Cargando inventario de todas las sedes..." : "Cargando productos..."}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : paginatedProductos.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={selectedDashboardSede === "all" ? 11 : 10} className="px-4 py-10 text-center text-sm text-gray-500">
                          No hay productos para mostrar con los filtros actuales
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedProductos.map((producto, idx) => {
                        const actual = Number(producto.stock_actual ?? 0)
                        const minimo = Number(producto.stock_minimo ?? 0)
                        const dotCls =
                          actual <= 0 ? "bg-gray-400"
                          : actual <= minimo ? "bg-red-500"
                          : actual <= minimo * 1.5 ? "bg-amber-500"
                          : "bg-emerald-500"
                        const numCls =
                          actual <= 0 ? "text-gray-400"
                          : actual <= minimo ? "text-red-600"
                          : actual <= minimo * 1.5 ? "text-amber-600"
                          : "text-emerald-600"
                        const sedeName = sedesDisponibles.find((s) => s.sede_id === producto.sede_id)?.nombre || producto.sede_id || "—"
                        return (
                          <TableRow key={`${producto._id}-${producto.sede_id}-${idx}`} className="hover:bg-gray-50">
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
                            {selectedDashboardSede === "all" && (
                              <TableCell className="px-4 py-3">
                                <span className="text-xs font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                                  {sedeName}
                                </span>
                              </TableCell>
                            )}
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
                            <TableCell className="px-4 py-3 text-center text-sm text-gray-400">{minimo}</TableCell>
                            <TableCell className="px-4 py-3 text-center text-sm text-gray-700">
                              {typeof producto.ventas === "number" ? producto.ventas : "—"}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-center text-sm text-gray-800">
                              {producto.precio ? formatMoney(producto.precio) : "—"}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-center text-sm text-gray-400">
                              {producto.costo ? formatMoney(producto.costo) : "—"}
                            </TableCell>
                            <TableCell className="px-4 py-3">{renderEstadoBadge(producto)}</TableCell>
                            <TableCell className="px-4 py-3 text-center">
                              {canAdjustStock && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button className="text-gray-400 hover:text-gray-700 transition-colors p-1 rounded">
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="bg-white">
                                    <DropdownMenuItem onSelect={() => openEditModal(producto.producto_id || producto._id)}>
                                      Editar producto
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </TableCell>
                          </TableRow>
                        )
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
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPageSafe === totalPages}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        </div>
        )}

        {/* ─── Nuevo producto (sede-style) ─────────────────────────── */}
        <Dialog open={isNuevoProductoModalOpen} onOpenChange={setIsNuevoProductoModalOpen}>
          <DialogContent className="w-full max-w-[500px] bg-white border-gray-200 text-gray-900">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-gray-900">Crear producto</DialogTitle>
              <p className="text-xs text-gray-400 -mt-1">Registra un nuevo producto en el inventario.</p>
            </DialogHeader>
            <div className="space-y-3 pt-1">
              {/* Sede destino — solo en superadmin */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Sede destino</label>
                <Select
                  value={nuevoSedeId || ""}
                  onValueChange={(v) => { setNuevoSedeId(v); void cargarCatalogoProductosForm(v) }}
                  disabled={isLoadingCreateData || sedesDisponibles.length === 0}
                >
                  <SelectTrigger className="border-gray-200 bg-white text-sm">
                    <SelectValue placeholder={isLoadingCreateData ? "Cargando sedes…" : "Selecciona la sede"} />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-gray-200">
                    {sedesDisponibles.map((sede) => (
                      <SelectItem key={sede.sede_id} value={sede.sede_id}>{sede.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {modalDataError && (
                  <p className="text-xs text-amber-600 mt-1">{modalDataError}</p>
                )}
              </div>

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
                onClick={() => { setCreacionModo("manual"); void crearInventarioDesdeCard() }}
                disabled={isCreatingInventario}
              >
                {isCreatingInventario && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Registrar producto
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isCreateModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              cerrarModalCreacion()
              return
            }
            setIsCreateModalOpen(true)
          }}
        >
          <DialogContent className="w-full max-w-6xl lg:max-w-[1100px] max-h-[90vh] overflow-y-auto bg-white border-gray-200 text-gray-900 px-4 sm:px-6">
            <div className="grid gap-5 lg:grid-cols-[300px,1fr] xl:grid-cols-[320px,1fr]">
              <div className="space-y-4">
                <DialogHeader className="p-0">
                  <DialogTitle>Crear producto</DialogTitle>
                  <DialogDescription>
                    Reutiliza el catálogo existente y registra el stock inicial para la sede seleccionada.
                  </DialogDescription>
                </DialogHeader>

                {isLoadingCreateData && (
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando productos y sedes...
                  </div>
                )}

                {modalDataError && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    {modalDataError}
                  </div>
                )}

                {catalogoError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{catalogoError}</AlertDescription>
                  </Alert>
                ) : null}
                {createProductSuccess && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    {createProductSuccess}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Sede destino</label>
                  <Select
                    value={nuevoSedeId || ""}
                    onValueChange={(value) => {
                      setNuevoSedeId(value)
                      void cargarCatalogoProductosForm(value)
                    }}
                    disabled={isCreatingInventario || isLoadingCreateData || sedesDisponibles.length === 0}
                  >
                    <SelectTrigger className="border-gray-300 bg-white text-gray-900">
                      <SelectValue placeholder="Selecciona la sede" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {sedesDisponibles.map((sede) => (
                        <SelectItem key={sede.sede_id} value={sede.sede_id}>
                          {sede.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

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
                          {catalogoProductosForm.length === 0 ? (
                            <SelectItem value="none" disabled>
                              {isLoadingCatalogo
                                ? "Cargando..."
                                : "No hay productos disponibles"}
                            </SelectItem>
                          ) : (
                            catalogoProductosForm.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.nombre} — {item.codigo}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>

                      <Input
                        value={
                          catalogoProductosForm.find((item) => item.id === nuevoProductoId)?.codigo ||
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

                <div className="flex items-center gap-2 pt-1 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cerrarModalCreacion}
                    disabled={isCreatingInventario}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={crearInventarioDesdeCard} disabled={isCreatingInventario} className="bg-gray-900 text-white hover:bg-gray-800">
                    {isCreatingInventario && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Registrar producto
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-gray-900">Inventario de la sede</h3>
                  <p className="text-sm text-gray-600">
                    Ajusta mínimos y stock existente. Usa el lápiz para editar cada producto.
                  </p>
                </div>
                <ProductCardsGrid
                  title=""
                  products={productCards}
                  loading={isLoading}
                  onEditProduct={(id) => openEditModal(id)}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(editingProductId)} onOpenChange={(open) => !open && setEditingProductId(null)}>
          <DialogContent className="sm:max-w-md bg-white border-gray-200">
            <DialogHeader>
              <DialogTitle>Editar producto</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-700">Nombre</label>
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  disabled={editingLoading}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm text-gray-700">Precio</label>
                <Input
                  type="number"
                  min="0"
                  value={editingPrice}
                  onChange={(e) => setEditingPrice(e.target.value)}
                  disabled={editingLoading}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">Edición local en UI; no guarda en backend.</p>
              </div>
              <div>
                <label className="text-sm text-gray-700">Stock</label>
                <Input
                  type="number"
                  min="0"
                  value={editingStock}
                  onChange={(e) => setEditingStock(e.target.value)}
                  disabled={editingLoading}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingProductId(null)} disabled={editingLoading}>
                Cancelar
              </Button>
              <Button onClick={handleSaveEdit} disabled={editingLoading}>
                Guardar cambios
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isCreateProductModalOpen} onOpenChange={(open) => !open && setIsCreateProductModalOpen(false)}>
          <DialogContent className="sm:max-w-lg bg-white border-gray-200">
            <DialogHeader>
              <DialogTitle>Crear producto (catálogo)</DialogTitle>
              <DialogDescription>Se crea en el catálogo global. Luego podrás asignarlo al inventario de una sede.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {createProductError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {createProductError}
                </div>
              )}
              {createProductSuccess && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {createProductSuccess}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Nombre *</label>
                  <Input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Código</label>
                  <Input value={newProductCode} onChange={(e) => setNewProductCode(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Categoría</label>
                  <Input value={newProductCategory} onChange={(e) => setNewProductCategory(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Descripción</label>
                  <Input value={newProductDescription} onChange={(e) => setNewProductDescription(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Precio COP</label>
                  <Input type="number" min="0" value={newProductPriceCOP} onChange={(e) => setNewProductPriceCOP(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Precio USD</label>
                  <Input type="number" min="0" value={newProductPriceUSD} onChange={(e) => setNewProductPriceUSD(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Precio MXN</label>
                  <Input type="number" min="0" value={newProductPriceMXN} onChange={(e) => setNewProductPriceMXN(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Comisión (%)</label>
                  <Input type="number" min="0" max="100" value={newProductCommission} onChange={(e) => setNewProductCommission(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Stock actual</label>
                  <Input type="number" min="0" value={newProductStock} onChange={(e) => setNewProductStock(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Stock mínimo</label>
                  <Input type="number" min="0" value={newProductStockMin} onChange={(e) => setNewProductStockMin(e.target.value)} />
                </div>
              </div>

              <p className="text-xs text-gray-500">El producto se guarda en backend y quedará disponible para crear inventario por sede.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateProductModalOpen(false)} disabled={isCreatingProduct}>
                Cancelar
              </Button>
              <Button onClick={handleCreateProduct} disabled={isCreatingProduct} className="gap-2 bg-gray-900 text-white hover:bg-gray-800">
                {isCreatingProduct && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
