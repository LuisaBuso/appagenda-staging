// types/producto.ts
export interface Producto {
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