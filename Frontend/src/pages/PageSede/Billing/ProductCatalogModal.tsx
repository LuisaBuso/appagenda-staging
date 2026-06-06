// components/products/ProductCatalogModal.tsx
"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Search, X, Plus, Check, ShoppingCart, Filter, DollarSign, ChevronDown } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Badge } from "../../../components/ui/badge"
import { ScrollArea } from "../../../components/ui/scroll-area"
import { API_BASE_URL } from "../../../types/config"
import { useAuth } from "../../../components/Auth/AuthContext"
import {
  formatCurrencyNoDecimals,
  getStoredCurrency,
  normalizeCurrencyCode,
  resolveCurrencyLocale,
} from "../../../lib/currency"

interface Producto {
  _id?: string
  id: string
  nombre: string
  categoria: string
  descripcion: string
  imagen: string
  activo: boolean
  tipo_codigo: string
  descuento: string | number
  stock: string | number
  precios?: {
    COP?: number
    MXN?: number
    USD?: number
  }
  precio_local?: number
  moneda_local?: string
  precio?: number
  stock_actual?: number
  stock_minimo?: number
  tipo_precio?: string
}

interface ProductCatalogModalProps {
  isOpen: boolean
  onClose: () => void
  onAddProducts: (products: Producto[]) => void
  selectedProducts?: Producto[]
  moneda?: string
  citaId?: string
}

export function ProductCatalogModal({
  isOpen,
  onClose,
  onAddProducts,
  selectedProducts = [],
  moneda = getStoredCurrency("USD"),
  citaId = ""
}: ProductCatalogModalProps) {
  const { user } = useAuth()
  const currencyFromSede = normalizeCurrencyCode(moneda || user?.moneda || getStoredCurrency("USD"))
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [tempSelectedProducts, setTempSelectedProducts] = useState<Producto[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [selectedMoneda, setSelectedMoneda] = useState<string>(currencyFromSede)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [mobileExpandedModule, setMobileExpandedModule] = useState<"catalog" | "summary">("catalog")

  // Función para preparar productos en el formato correcto
  const prepararProductosParaEnvio = () => {
    const productosUnicos: Record<string, { product: Producto, quantity: number }> = {}

    // Agrupar productos por ID
    tempSelectedProducts.forEach(product => {
      if (product && product.id) {
        if (!productosUnicos[product.id]) {
          productosUnicos[product.id] = {
            product: product,
            quantity: 0
          }
        }
        productosUnicos[product.id].quantity += 1
      }
    })

    // Convertir al formato requerido por el endpoint
    return Object.values(productosUnicos).map(({ product, quantity }) => ({
      producto_id: product.id,
      nombre: product.nombre,
      cantidad: quantity,
      precio_unitario: product.precio || 0
    }))
  }

  useEffect(() => {
    if (isOpen) {
      fetchProducts()
    }
  }, [isOpen, selectedMoneda])

  useEffect(() => {
    if (isOpen) {
      setSelectedMoneda(currencyFromSede)
    }
  }, [isOpen, currencyFromSede])

  useEffect(() => {
    if (isOpen) {
      console.log('🔄 Modal abierto - Inicializando productos...')
      console.log('Productos existentes recibidos:', selectedProducts)
      setMobileExpandedModule("catalog")
      
      // Siempre limpiar el carrito del modal cuando se abre
      setTempSelectedProducts([])
      setQuantities({})
      
      // Mostrar en consola para debugging
      if (selectedProducts.length > 0) {
        console.log('Productos que ya están en la cita:')
        selectedProducts.forEach((p, i) => {
          console.log(`${i + 1}. ${p.nombre} (ID: ${p.id})`)
        })
      }
    }
  }, [isOpen, selectedProducts])

  const fetchProducts = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('access_token') || sessionStorage.getItem('access_token')

      if (!token) {
        console.error('No hay token de autenticación')
        setProductos([])
        return
      }

      const response = await fetch(
        `${API_BASE_URL}inventary/product/productos/?moneda=${selectedMoneda}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      )

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('Productos recibidos del endpoint de inventario:', data)

      let productosArray: any[] = []

      if (Array.isArray(data)) {
        productosArray = data
      } else {
        console.error('La respuesta no es un array:', data)
        productosArray = []
      }

      console.log('Total de productos recibidos:', productosArray.length)

      const productosTransformados = productosArray.map(product => {
        let precio = 0
        let precio_local = 0

        if (product.precio_local !== undefined) {
          precio = product.precio_local
          precio_local = product.precio_local
        } else if (product.precios && product.precios[selectedMoneda]) {
          precio = product.precios[selectedMoneda]
          precio_local = product.precios[selectedMoneda]
        } else if (product.precio !== undefined) {
          precio = product.precio
          precio_local = product.precio
        }

        return {
          ...product,
          id: product.id || product._id || '',
          nombre: product.nombre || 'Producto sin nombre',
          categoria: product.categoria || 'Sin categoría',
          descripcion: product.descripcion || '',
          imagen: product.imagen || '',
          activo: product.activo !== false,
          tipo_codigo: product.tipo_codigo || '',
          descuento: product.descuento || 0,
          stock: product.stock || product.stock_actual || "0",
          precio: precio,
          precio_local: precio_local,
          moneda_local: selectedMoneda,
          tipo_precio: 'sin_iva_internacional',
          stock_actual: product.stock_actual || 0,
          stock_minimo: product.stock_minimo || 0
        }
      })

      console.log('Productos transformados:', productosTransformados)
      setProductos(productosTransformados)
    } catch (error) {
      console.error("Error fetching products from inventory API:", error)

      // Datos de ejemplo si falla la API
      const mockData: Producto[] = [
        {
          id: "P001",
          nombre: "Shampoo 250 ML",
          categoria: "SPECIAL",
          descripcion: "Shampoo especial para cabello rizado de 250ml",
          imagen: "",
          activo: true,
          tipo_codigo: "SH001",
          descuento: 0,
          stock: "500",
          precios: { COP: 77400, USD: 21, MXN: 349.10 },
          precio: 21,
          precio_local: 21,
          moneda_local: "USD",
          tipo_precio: "sin_iva_internacional"
        },
        {
          id: "P002",
          nombre: "Acondicionador 250 ML",
          categoria: "SPECIAL",
          descripcion: "Acondicionador especial para cabello rizado de 250ml",
          imagen: "",
          activo: true,
          tipo_codigo: "AC002",
          descuento: 0,
          stock: "500",
          precios: { COP: 77400, USD: 21, MXN: 349.10 },
          precio: 21,
          precio_local: 21,
          moneda_local: "USD",
          tipo_precio: "sin_iva_internacional"
        },
        {
          id: "P005",
          nombre: "ACEITE 30 ML",
          categoria: "SPECIAL",
          descripcion: "Aceite nutritivo para cabello rizado de 30ml",
          imagen: "",
          activo: true,
          tipo_codigo: "AC005",
          descuento: 0,
          stock: "500",
          precios: { COP: 77400, USD: 17, MXN: 349.10 },
          precio: 17,
          precio_local: 17,
          moneda_local: "USD",
          tipo_precio: "sin_iva_internacional"
        },
      ]
      setProductos(mockData)
    } finally {
      setLoading(false)
    }
  }

  const filteredProducts = productos.filter(product => {
    if (!product || !product.activo) return false

    const searchLower = searchTerm.toLowerCase()
    const matchesSearch =
      (product.nombre?.toLowerCase().includes(searchLower) || false) ||
      (product.categoria?.toLowerCase().includes(searchLower) || false) ||
      (product.descripcion?.toLowerCase().includes(searchLower) || false)

    const matchesCategory = !selectedCategory || product.categoria === selectedCategory
    return matchesSearch && matchesCategory
  })

  const categories = Array.from(new Set(
    productos
      .filter(product => product && product.categoria)
      .map(p => p.categoria)
  )).filter(Boolean)

  const handleProductSelect = (product: Producto) => {
    if (!product || !product.id) return

    console.log(`Agregando producto: ${product.nombre} (ID: ${product.id})`)

    setQuantities(prev => ({
      ...prev,
      [product.id]: (prev[product.id] || 0) + 1
    }))

    setTempSelectedProducts(prev => [...prev, product])
    
    console.log(`Carrito actualizado: ${tempSelectedProducts.length + 1} productos`)
  }

  const handleRemoveProduct = (productId: string) => {
    console.log(`Eliminando producto ID: ${productId}`)
    
    setQuantities(prev => {
      const newQuantities = { ...prev }
      delete newQuantities[productId]
      return newQuantities
    })
    
    setTempSelectedProducts(prev => {
      const filtered = prev.filter(p => p && p.id !== productId)
      console.log(`Productos después de eliminar: ${filtered.length}`)
      return filtered
    })
  }

  const handleQuantityChange = (productId: string, delta: number) => {
    const currentQty = quantities[productId] || 0
    const newQty = Math.max(0, currentQty + delta)

    console.log(`Cambiando cantidad de producto ${productId}: ${currentQty} -> ${newQty}`)

    if (newQty === 0) {
      handleRemoveProduct(productId)
      return
    }

    setQuantities(prev => ({ ...prev, [productId]: newQty }))

    const product = productos.find(p => p && p.id === productId)
    if (product) {
      const currentCount = tempSelectedProducts.filter(p => p && p.id === productId).length
      const diff = newQty - currentCount

      if (diff > 0) {
        console.log(`Añadiendo ${diff} unidades del producto ${product.nombre}`)
        const toAdd = Array(diff).fill(product)
        setTempSelectedProducts(prev => [...prev, ...toAdd])
      } else if (diff < 0) {
        console.log(`Removiendo ${Math.abs(diff)} unidades del producto ${product.nombre}`)
        let count = Math.abs(diff)
        setTempSelectedProducts(prev =>
          prev.filter(p => {
            if (p && p.id === productId && count > 0) {
              count--
              return false
            }
            return true
          })
        )
      }
    }
  }

  const handleConfirm = async () => {
    setIsSubmitting(true)
    console.log('🔵 Iniciando confirmación de productos...')

    try {
      const productosValidos = tempSelectedProducts.filter(product =>
        product && product.id
      )

      if (productosValidos.length === 0) {
        console.warn('❌ No hay productos válidos para confirmar')
        toast.warning('No hay productos seleccionados para agregar')
        onAddProducts([])
        onClose()
        return
      }

      console.log('📦 Productos a confirmar:', productosValidos.length)
      console.log('Detalle:', productosValidos.map(p => ({ id: p.id, nombre: p.nombre })))

      // Verificar que tenemos citaId
      if (!citaId) {
        console.error('❌ No hay cita_id disponible')
        toast.warning('Productos guardados localmente. Error: No se pudo identificar la cita para guardar en BD.')
        onAddProducts(productosValidos)
        onClose()
        return
      }

      // Preparar productos para enviar
      const productosParaEnviar = prepararProductosParaEnvio()
      console.log('📤 Productos preparados para enviar:', productosParaEnviar)

      if (productosParaEnviar.length === 0) {
        console.error('❌ No hay productos preparados para enviar')
        toast.warning('Error al preparar productos para enviar')
        onAddProducts(productosValidos)
        onClose()
        return
      }

      console.log('🚀 Enviando al endpoint /agregar-productos:', {
        cita_id: citaId,
        total_productos: productosParaEnviar.length,
        productos: productosParaEnviar
      })

      // Llamar al endpoint para agregar productos
      const token = localStorage.getItem('access_token') || sessionStorage.getItem('access_token')

      if (!token) {
        throw new Error('No hay token de autenticación')
      }

      const response = await fetch(
        `${API_BASE_URL}scheduling/quotes/cita/${citaId}/agregar-productos`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(productosParaEnviar)
        }
      )

      console.log('📥 Response status:', response.status)

      if (!response.ok) {
        let errorMessage = `Error ${response.status}: ${response.statusText}`
        try {
          const errorData = await response.json()
          console.error('Error del servidor:', errorData)
          if (errorData.detail) {
            errorMessage = errorData.detail
          } else if (errorData.message) {
            errorMessage = errorData.message
          }
        } catch (jsonError) {
          // Si no se puede parsear como JSON
          const errorText = await response.text()
          console.error('Error en texto:', errorText)
        }
        throw new Error(errorMessage)
      }

      const result = await response.json()
      console.log('✅ Productos agregados a cita:', result)

      // Mostrar mensaje de éxito
      if (result.success) {
        const productosAgregados = result.productos_agregados || productosParaEnviar.length
        const comision = result.comision_calculada || 0

        toast.success(`${productosAgregados} producto(s) agregado(s) correctamente a la cita.${
          comision > 0
            ? ` Comisión calculada: ${formatCurrencyNoDecimals(comision, selectedMoneda, resolveCurrencyLocale(selectedMoneda, "es-CO"))}`
            : ''
        }`)
      } else {
        console.warn('⚠️ El servidor no devolvió success=true:', result)
        toast.info('Productos procesados, pero el servidor no confirmó éxito.')
      }

      // IMPORTANTE: Pasar solo los productos NUEVOS al componente padre
      console.log('🔄 Pasando productos al componente padre:', productosValidos.length)
      onAddProducts(productosValidos)
      onClose()

    } catch (error) {
      console.error('❌ Error al agregar productos:', error)
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido'

      toast.error(`Error al guardar productos en el servidor: ${errorMsg}. Los productos se mostrarán en la interfaz pero no se guardaron en la base de datos.`)

      // Aún así pasar los productos al padre (para mantener la UI)
      onAddProducts(tempSelectedProducts.filter(product => product && product.id))
      onClose()
    } finally {
      setIsSubmitting(false)
      console.log('🏁 Confirmación finalizada')
    }
  }

  const total = tempSelectedProducts.reduce((sum, product) => {
    if (!product) return sum
    const precio = product.precio_local !== undefined ? product.precio_local : (product.precio || 0)
    return sum + precio
  }, 0)

  const totalQuantity = Object.values(quantities).reduce((sum, qty) => sum + qty, 0)

  const formatCurrency = (amount: number) => {
    return formatCurrencyNoDecimals(amount, selectedMoneda, resolveCurrencyLocale(selectedMoneda, "es-CO"))
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 p-0 sm:p-4">
      <div className="mx-auto flex h-[100dvh] w-full flex-col bg-white sm:h-auto sm:max-h-[95vh] sm:max-w-7xl sm:rounded-lg">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-300 px-4 py-4 sm:flex-nowrap sm:items-center sm:px-6">
          <div className="min-w-0 space-y-1">
            <h2 className="text-xl font-bold text-gray-900 sm:text-2xl">Catálogo de Productos</h2>
            <p className="text-gray-700 text-sm">
              Selecciona productos para agregar a la cita
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <div className="flex h-9 items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-3">
              <DollarSign className="h-4 w-4 text-gray-800" />
              <select
                value={selectedMoneda}
                disabled
                className="cursor-not-allowed bg-transparent border-none text-sm font-medium text-gray-900 focus:outline-none focus:ring-0"
              >
                <option value="USD">USD</option>
                <option value="COP">COP</option>
                <option value="MXN">MXN</option>
              </select>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-9 w-9 rounded-full p-0 text-gray-800 hover:bg-gray-200"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Cerrar</span>
            </Button>
          </div>
        </div>

        <div className="border-b border-gray-300 px-4 py-3 lg:hidden">
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setMobileExpandedModule("catalog")}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${
                mobileExpandedModule === "catalog"
                  ? "border-black bg-gray-100 text-black"
                  : "border-gray-300 bg-white text-gray-800"
              }`}
            >
              <span>Catálogo de productos</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  mobileExpandedModule === "catalog" ? "rotate-180" : ""
                }`}
              />
            </button>
            <button
              type="button"
              onClick={() => setMobileExpandedModule("summary")}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${
                mobileExpandedModule === "summary"
                  ? "border-black bg-gray-100 text-black"
                  : "border-gray-300 bg-white text-gray-800"
              }`}
            >
              <span>Resumen de compra ({totalQuantity})</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  mobileExpandedModule === "summary" ? "rotate-180" : ""
                }`}
              />
            </button>
          </div>
        </div>

        {/* Contenido principal */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Panel izquierdo - Catálogo */}
          <div
            className={`order-1 min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6 ${
              mobileExpandedModule === "catalog" ? "flex border-b border-gray-300" : "hidden"
            } lg:flex lg:border-b-0 lg:border-r`}
          >
            {/* Filtros y búsqueda */}
            <div className="mb-4 space-y-4 sm:mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-700" />
                <Input
                  placeholder="Buscar productos por nombre, categoría o descripción..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-11 text-base border-gray-300 focus:border-gray-500 focus:ring-gray-500"
                />
              </div>

              {/* Filtros de categoría */}
              {categories.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-gray-800" />
                    <span className="text-sm font-medium text-gray-900">Filtrar por categoría:</span>
                  </div>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    <Button
                      variant={selectedCategory === null ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedCategory(null)}
                      className={`h-8 whitespace-nowrap px-3 ${selectedCategory === null ? 'bg-black text-white hover:bg-gray-800' : 'border-gray-300 text-gray-800 hover:bg-gray-200 hover:text-black'}`}
                    >
                      Todas las categorías
                    </Button>
                    {categories.map(category => (
                      <Button
                        key={category}
                        variant={selectedCategory === category ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedCategory(category)}
                        className={`h-8 whitespace-nowrap px-3 ${selectedCategory === category ? 'bg-black text-white hover:bg-gray-800' : 'border-gray-300 text-gray-800 hover:bg-gray-200 hover:text-black'}`}
                      >
                        {category}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Lista de productos */}
            <ScrollArea className="flex-1 pr-1 sm:pr-3">
              {loading ? (
                <div className="flex flex-col justify-center items-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900 mb-4"></div>
                  <p className="text-gray-800">Cargando productos...</p>
                  <p className="text-sm text-gray-700 mt-1">Por favor espera</p>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-center py-16">
                  <ShoppingCart className="h-16 w-16 mx-auto mb-5 text-gray-400" />
                  <p className="text-gray-800 text-lg">No se encontraron productos</p>
                  <p className="text-gray-700 mt-2">
                    {searchTerm ? "Intenta con otros términos de búsqueda" : "No hay productos disponibles en este momento"}
                  </p>
                  {searchTerm && (
                    <Button
                      variant="outline"
                      className="mt-4 border-gray-300 text-gray-800 hover:bg-gray-200 hover:text-black"
                      onClick={() => setSearchTerm('')}
                    >
                      Limpiar búsqueda
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
                  {filteredProducts.map(product => {
                    if (!product) return null

                    const qty = quantities[product.id] || 0
                    const isSelected = qty > 0
                    const precio = product.precio_local !== undefined ? product.precio_local : (product.precio || 0)
                    const stock = product.stock || "0"
                    const nombre = product.nombre || "Producto sin nombre"
                    const categoria = product.categoria || "Sin categoría"
                    const stockDisponible = Number(stock) || 0

                    return (
                      <div
                        key={product.id}
                        className={`space-y-3 rounded-xl border p-3 transition-all duration-200 sm:p-4 ${isSelected
                          ? 'border-black bg-gray-50 shadow-sm'
                          : 'border-gray-300 hover:border-gray-500 hover:shadow-md'
                          }`}
                      >
                        {/* Encabezado del producto */}
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-sm text-gray-900 truncate">{nombre}</h4>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <Badge
                                  variant="outline"
                                  className="text-xs bg-gray-100 text-gray-800 border-gray-300"
                                >
                                  {categoria}
                                </Badge>
                                {product.tipo_codigo && (
                                  <span className="text-xs text-gray-700 font-mono">
                                    #{product.tipo_codigo}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Precio */}
                            <div className="text-right flex-shrink-0">
                              <div className="font-bold text-lg text-gray-900">
                                {formatCurrency(precio)}
                              </div>
                              <div className="text-xs text-gray-700 font-medium">
                                {selectedMoneda}
                              </div>
                            </div>
                          </div>

                          {/* Descripción */}
                          {product.descripcion && (
                            <p className="text-xs text-gray-800 line-clamp-2 leading-relaxed">
                              {product.descripcion}
                            </p>
                          )}
                        </div>

                        {/* Stock e información */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-300">
                          <div className="space-y-1">
                            <div className="text-sm text-gray-800">
                              <span className="font-medium">Disponible:</span> {stockDisponible} unidades
                            </div>
                            {product.stock_minimo && Number(product.stock_minimo) > 0 && (
                              <div className="text-xs text-gray-900 font-medium">
                                Mínimo: {product.stock_minimo} unidades
                              </div>
                            )}
                          </div>

                          {isSelected && (
                            <Badge
                              variant="secondary"
                              className="text-xs bg-gray-200 text-gray-900 border-gray-300"
                            >
                              {qty} seleccionado{qty > 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>

                        {/* Controles de cantidad */}
                        {isSelected ? (
                          <div className="flex flex-col gap-2 pt-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 w-9 p-0 rounded-lg border-gray-400 hover:border-gray-600 hover:bg-gray-100"
                                onClick={() => handleQuantityChange(product.id, -1)}
                              >
                                <span className="text-lg">-</span>
                              </Button>
                              <span className="font-medium text-base min-w-[2rem] text-center text-gray-900">
                                {qty}
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 w-9 p-0 rounded-lg border-gray-400 hover:border-gray-600 hover:bg-gray-100 disabled:opacity-50"
                                onClick={() => handleQuantityChange(product.id, 1)}
                                disabled={stockDisponible <= qty}
                              >
                                <span className="text-lg">+</span>
                              </Button>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 justify-start px-3 text-gray-800 hover:bg-gray-200 hover:text-black sm:justify-center"
                              onClick={() => handleRemoveProduct(product.id)}
                            >
                              <X className="h-4 w-4 mr-1" />
                              Quitar
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            className="w-full h-9 mt-2 bg-black text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => handleProductSelect(product)}
                            disabled={stockDisponible === 0}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Agregar al carrito
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollArea>

            {/* Contador de productos */}
            <div className="mt-4 border-t border-gray-300 pt-4 sm:mt-6">
              <div className="flex flex-col gap-1 text-xs text-gray-800 sm:flex-row sm:items-center sm:justify-between sm:text-sm">
                <span>
                  Mostrando <span className="font-medium text-gray-900">{filteredProducts.length}</span> de{" "}
                  <span className="font-medium text-gray-900">{productos.length}</span> productos
                </span>
                <span className="text-gray-700">
                  {selectedCategory ? `Categoría: ${selectedCategory}` : "Todas las categorías"}
                </span>
              </div>
            </div>
          </div>

          {/* Panel derecho - Resumen */}
          <div
            className={`order-2 min-h-0 flex-1 flex-col bg-gray-50 px-4 py-4 sm:px-6 ${
              mobileExpandedModule === "summary" ? "flex border-t border-gray-300" : "hidden"
            } lg:flex lg:w-[390px] lg:flex-none lg:border-l lg:border-t-0`}
          >
            <div className="mb-4 space-y-2 sm:mb-6">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 sm:text-xl">
                <ShoppingCart className="h-5 w-5" />
                Resumen de compra
              </h3>
              <div className="flex items-center gap-2 text-sm">
                <div className="px-2 py-1 bg-gray-200 text-gray-900 rounded-md font-medium border border-gray-300">
                  {selectedMoneda}
                </div>
                <span className="text-gray-700">Moneda de la sede</span>
              </div>
            </div>

            <ScrollArea className="mb-4 min-h-0 flex-1 sm:mb-6">
              {totalQuantity === 0 ? (
                <div className="text-center py-12">
                  <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4 border border-gray-300">
                    <ShoppingCart className="h-10 w-10 text-gray-600" />
                  </div>
                  <p className="text-gray-800 text-lg">Carrito vacío</p>
                  <p className="text-gray-700 text-sm mt-2">
                    Agrega productos desde el catálogo
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(quantities).map(([productId, qty]) => {
                    const product = productos.find(p => p && p.id === productId)
                    if (!product) return null

                    const precio = product.precio_local !== undefined ? product.precio_local : (product.precio || 0)
                    const nombre = product.nombre || "Producto"
                    const categoria = product.categoria || "Sin categoría"
                    const totalProducto = precio * qty

                    return (
                      <div key={productId} className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-sm text-gray-900 truncate mb-1">
                              {nombre}
                            </h4>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-xs bg-gray-100 text-gray-800 border-gray-300">
                                {categoria}
                              </Badge>
                              <span className="text-xs text-gray-700">
                                {formatCurrency(precio)} c/u
                              </span>
                            </div>
                          </div>
                          <div className="ml-2 flex-shrink-0 text-right sm:ml-4">
                            <div className="font-bold text-base text-gray-900">
                              {formatCurrency(totalProducto)}
                            </div>
                            <div className="text-xs text-gray-700">
                              {qty} × {formatCurrency(precio)}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-300 pt-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-800">Cantidad:</span>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                className="h-6 w-6 p-0 text-gray-800 hover:text-black hover:bg-gray-200"
                                onClick={() => handleQuantityChange(productId, -1)}
                              >
                                -
                              </Button>
                              <span className="font-medium text-sm min-w-[1.5rem] text-center text-gray-900">
                                {qty}
                              </span>
                              <Button
                                variant="ghost"
                                className="h-6 w-6 p-0 text-gray-800 hover:text-black hover:bg-gray-200"
                                onClick={() => handleQuantityChange(productId, 1)}
                              >
                                +
                              </Button>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-gray-800 hover:text-black hover:bg-gray-200"
                            onClick={() => handleRemoveProduct(productId)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollArea>

            {/* Resumen de totales */}
            <div className="space-y-4 border-t border-gray-400 pt-4 sm:pt-6">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-800">Productos seleccionados:</span>
                  <span className="font-medium text-gray-900">{totalQuantity} items</span>
                </div>
                <div className="flex justify-between text-base">
                  <span className="font-bold text-gray-900">Total a pagar:</span>
                  <span className="font-bold text-xl text-gray-900">
                    {formatCurrency(total)}
                  </span>
                </div>
              </div>

              <div className="text-xs text-gray-700 text-center pt-2">
                Precios en {selectedMoneda} - Impuestos no incluidos
              </div>
            </div>

            {/* Botones de acción */}
            <div className="mt-4 space-y-3 sm:mt-6">
              <Button
                className="w-full h-12 text-base font-medium bg-black text-white hover:bg-gray-800"
                size="lg"
                onClick={handleConfirm}
                disabled={totalQuantity === 0 || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="h-5 w-5 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Agregando productos...
                  </>
                ) : (
                  <>
                    <Check className="h-5 w-5 mr-2" />
                    Confirmar {totalQuantity} producto{totalQuantity !== 1 ? 's' : ''}
                  </>
                )}
              </Button>

              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <Button
                  variant="outline"
                  className="flex-1 h-11 border-gray-300 text-gray-800 hover:bg-gray-200 hover:text-black"
                  size="lg"
                  onClick={() => {
                    setTempSelectedProducts([])
                    setQuantities({})
                  }}
                  disabled={totalQuantity === 0}
                >
                  Vaciar carrito
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 h-11 border-gray-300 text-gray-800 hover:bg-gray-200 hover:text-black"
                  size="lg"
                  onClick={onClose}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
