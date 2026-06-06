// // app/(protected)/admin-sede/ventas/products-for-sale.tsx
// "use client"

// import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card"
// import { useEffect, useState } from "react"
// import { API_BASE_URL } from "../../../types/config"
// import { Package } from "lucide-react"
// import { useNavigate } from "react-router-dom"

// export function ProductsForSale() {
//   const [products, setProducts] = useState<any[]>([])
//   const [loading, setLoading] = useState(true)
//   const navigate = useNavigate()

//   const getUserInfo = () => ({
//     token: localStorage.getItem('access_token') || sessionStorage.getItem('access_token'),
//     pais: localStorage.getItem('beaux-pais') || sessionStorage.getItem('beaux-pais') || undefined
//   })

//   const getCurrency = (pais?: string) => {
//     if (!pais) return 'USD'
//     const map: Record<string, string> = {
//       'Colombia': 'COP', 'México': 'MXN', 'Mexico': 'MXN',
//       'Ecuador': 'USD', 'Perú': 'USD', 'Chile': 'USD',
//       'Argentina': 'USD', 'Estados Unidos': 'USD'
//     }
//     return map[pais] || 'USD'
//   }

//   const formatPrice = (price: number, currency: string) => {
//     if (currency === 'COP' && price >= 1000000) {
//       return `$${(price / 1000000).toFixed(0)}M`
//     }
//     if (currency === 'COP') {
//       return `$${Math.round(price).toLocaleString('es-CO')}`
//     }
//     return `$${price.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
//   }

//   useEffect(() => {
//     const fetchProducts = async () => {
//       try {
//         const userInfo = getUserInfo()
//         if (!userInfo.token) return

//         const moneda = getCurrency(userInfo.pais)
//         const url = `${API_BASE_URL}inventary/product/productos/?moneda=${moneda}`
        
//         const res = await fetch(url, {
//           headers: {
//             'accept': 'application/json',
//             'Authorization': `Bearer ${userInfo.token}`,
//           },
//         })
        
//         if (res.ok) {
//           const data = await res.json()
//           setProducts(Array.isArray(data) ? data.slice(0, 4) : [])
//         }
//       } catch (error) {
//         console.error("Error cargando productos", error)
//       } finally {
//         setLoading(false)
//       }
//     }

//     fetchProducts()
//   }, [])

//   const handleClick = () => {
//     navigate('/sede/products')
//   }

//   const userInfo = getUserInfo()
//   const currency = getCurrency(userInfo.pais)

//   return (
//     <Card className="border shadow-sm">
//       <CardHeader className="pb-2 px-4 pt-4">
//         <CardTitle className="text-sm flex items-center justify-between">
//           <div className="flex items-center gap-2">
//             <Package className="w-3.5 h-3.5" />
//             <span>Productos</span>
//           </div>
//           <button 
//             onClick={handleClick}
//             className="text-xs text-blue-500 hover:underline"
//           >
//             Ver todos
//           </button>
//         </CardTitle>
//       </CardHeader>
      
//       <CardContent className="px-4 pb-4 pt-0">
//         {loading ? (
//           <p className="text-xs text-gray-500 text-center py-3">Cargando...</p>
//         ) : products.length === 0 ? (
//           <p className="text-xs text-gray-500 text-center py-3">No hay productos</p>
//         ) : (
//           <div className="flex gap-3">
//             {products.map((product) => {
//               const price = product.precio_local || product.precio || 0
//               return (
//                 <div 
//                   key={product._id || product.id} 
//                   className="flex-1 min-w-0 text-center cursor-pointer hover:opacity-80 transition-opacity"
//                   onClick={handleClick}
//                   title={product.nombre}
//                 >
//                   {/* Imagen mini */}
//                   <div className="w-12 h-12 mx-auto mb-1 rounded bg-gray-100 overflow-hidden">
//                     {product.imagen_url ? (
//                       <img 
//                         src={product.imagen_url} 
//                         alt=""
//                         className="w-full h-full object-cover"
//                       />
//                     ) : (
//                       <div className="w-full h-full bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center">
//                         <span className="text-xs font-bold text-gray-400">
//                           {product.nombre?.charAt(0) || 'P'}
//                         </span>
//                       </div>
//                     )}
//                   </div>
                  
//                   {/* Nombre super pequeño */}
//                   <p className="text-[10px] font-medium text-gray-800 truncate mb-0.5">
//                     {product.nombre?.substring(0, 8) || 'Prod'}
//                   </p>
                  
//                   {/* Precio */}
//                   <p className="text-xs font-bold text-blue-600">
//                     {formatPrice(price, currency)}
//                   </p>
                  
//                   {/* Stock mini */}
//                   {product.stock !== undefined && (
//                     <div className="text-[9px] text-gray-500">
//                       {product.stock > 0 ? (
//                         <span className="text-green-600">✓ {product.stock}</span>
//                       ) : (
//                         <span className="text-red-600">✗ 0</span>
//                       )}
//                     </div>
//                   )}
//                 </div>
//               )
//             })}
//           </div>
//         )}
//       </CardContent>
//     </Card>
//   )
// }