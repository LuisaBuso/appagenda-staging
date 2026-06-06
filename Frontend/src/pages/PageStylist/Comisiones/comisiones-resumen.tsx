"use client"

// Resumen de comisiones para ESTILISTA (UI preparada para consumir su propia data).

import { useState, useEffect } from "react";
import { AlertTriangle } from "lucide-react";

// Interfaces para los datos
interface ServicioComision {
  id: string;
  nombre: string;
  precio: number;
  comisionEstilistaPorcentaje: number;
  comisionEstilistaMonto: number;
  comisionCasaPorcentaje: number;
  comisionCasaMonto: number;
  fecha: string;
}

interface ProductoComision {
  id: string;
  nombre: string;
  precio: number;
  comisionEstilistaPorcentaje: number;
  comisionEstilistaMonto: number;
  comisionCasaPorcentaje: number;
  comisionCasaMonto: number;
}

interface Totales {
  totalServicios: number;
  totalProductos: number;
  totalComisionEstilista: number;
  totalComisionCasa: number;
  descuentosNomina: number;
  anticiposBonos: number;
  totalAPagar: number;
}

export function ComisionesResumen() {
  const [servicios, setServicios] = useState<ServicioComision[]>([]);
  const [productos, setProductos] = useState<ProductoComision[]>([]);
  const [totales, setTotales] = useState<Totales>({
    totalServicios: 0,
    totalProductos: 0,
    totalComisionEstilista: 0,
    totalComisionCasa: 0,
    descuentosNomina: 0,
    anticiposBonos: 0,
    totalAPagar: 0,
  });
  const [cargando, setCargando] = useState<boolean>(false);

  // Función para formatear moneda
  const formatMoneda = (monto: number): string => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(monto);
  };

  // Función para calcular totales
  const calcularTotales = () => {
    // En una implementación real, estos cálculos vendrían de una API
    return {
      totalServicios: 0,
      totalProductos: 0,
      totalComisionEstilista: 0,
      totalComisionCasa: 0,
      descuentosNomina: 0,
      anticiposBonos: 0,
      totalAPagar: 0,
    };
  };

  // Simular carga de datos (en realidad estaría vacío)
  useEffect(() => {
    setCargando(true);
    // Simular delay de carga
    const timer = setTimeout(() => {
      setServicios([]);
      setProductos([]);
      setTotales(calcularTotales());
      setCargando(false);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-[oklch(0.65_0.25_280)]"></div>
          <p className="mt-4 text-gray-600">Cargando datos de comisiones...</p>
        </div>
      </div>
    );
  }

  const noHayDatos = servicios.length === 0 && productos.length === 0;

  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      {/* Main content */}
      <div className="flex-1">
        {noHayDatos ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <h3 className="mb-2 text-lg font-medium text-gray-700">
              No hay datos de comisiones
            </h3>
            <p className="text-gray-500">
              Selecciona un estilista y un rango de fechas para ver las comisiones
            </p>
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div className="mb-4 grid grid-cols-[2fr_1fr_1.5fr_1.5fr_1.5fr] gap-4 border-b pb-3 text-sm font-semibold">
              <div>Servicio/Producto</div>
              <div className="text-right">Precio</div>
              <div className="text-right">% Comisión Estilista</div>
              <div className="text-right">Comisión Estilista</div>
              <div className="text-right">% Comisión Casa</div>
            </div>

            {/* Servicios Section */}
            {servicios.length > 0 && (
              <div className="mb-6">
                <h3 className="mb-3 text-lg font-semibold">Servicios</h3>
                <div className="space-y-2">
                  {servicios.map((servicio) => (
                    <div
                      key={servicio.id}
                      className="grid grid-cols-[2fr_1fr_1.5fr_1.5fr_1.5fr] gap-4 rounded-lg py-3 text-sm hover:bg-gray-50"
                    >
                      <div className="font-medium">{servicio.nombre}</div>
                      <div className="text-right">{formatMoneda(servicio.precio)}</div>
                      <div className="text-right">{servicio.comisionEstilistaPorcentaje}%</div>
                      <div className="text-right font-medium">
                        {formatMoneda(servicio.comisionEstilistaMonto)}
                      </div>
                      <div className="text-right">{servicio.comisionCasaPorcentaje}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Productos Section */}
            {productos.length > 0 && (
              <div>
                <h3 className="mb-3 text-lg font-semibold">Productos</h3>
                <div className="space-y-2">
                  {productos.map((producto) => (
                    <div
                      key={producto.id}
                      className="grid grid-cols-[2fr_1fr_1.5fr_1.5fr_1.5fr] gap-4 rounded-lg py-3 text-sm hover:bg-gray-50"
                    >
                      <div className="font-medium">{producto.nombre}</div>
                      <div className="text-right">{formatMoneda(producto.precio)}</div>
                      <div className="text-right">{producto.comisionEstilistaPorcentaje}%</div>
                      <div className="text-right font-medium">
                        {formatMoneda(producto.comisionEstilistaMonto)}
                      </div>
                      <div className="text-right">{producto.comisionCasaPorcentaje}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Configuration note */}
            <div className="mt-6 rounded-lg bg-blue-50 p-4">
              <p className="text-sm text-blue-700">
                Los porcentajes de comisión se configuran en{" "}
                <a
                  href="/configuracion/estilistas"
                  className="font-medium text-blue-800 hover:underline"
                >
                  Configuración → Estilistas
                </a>{" "}
                y{" "}
                <a
                  href="/configuracion/servicios-productos"
                  className="font-medium text-blue-800 hover:underline"
                >
                  Configuración → Servicios & Productos
                </a>
                .
              </p>
            </div>
          </>
        )}
      </div>

      {/* Sidebar with totals */}
      <div className="w-full lg:w-80">
        <div className="sticky top-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-sm font-medium text-gray-600">Totales</span>
            <span className="text-2xl font-bold">{formatMoneda(totales.totalComisionEstilista)}</span>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Total servicios</span>
              <span className="font-medium">{formatMoneda(totales.totalServicios)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Total productos</span>
              <span className="font-medium">{formatMoneda(totales.totalProductos)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Comisión casa</span>
              <span className="font-medium">{formatMoneda(totales.totalComisionCasa)}</span>
            </div>
            <div className="flex justify-between text-sm text-red-600">
              <span>Descuentos nómina</span>
              <span>-{formatMoneda(totales.descuentosNomina)}</span>
            </div>
            <div className="flex justify-between text-sm text-green-600">
              <span>Anticipos/Bonos</span>
              <span>+{formatMoneda(totales.anticiposBonos)}</span>
            </div>
          </div>

          <div className="mt-4 flex justify-between border-t pt-4 text-base font-semibold">
            <span>Total de comisión</span>
            <span className="text-[oklch(0.65_0.25_280)]">
              {formatMoneda(totales.totalAPagar)}
            </span>
          </div>

          {/* Información adicional */}
          <div className="mt-6 rounded-lg bg-gray-50 p-4">
            <p className="text-xs text-gray-600">
              * Las comisiones se calculan según la configuración establecida para cada estilista y producto.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
