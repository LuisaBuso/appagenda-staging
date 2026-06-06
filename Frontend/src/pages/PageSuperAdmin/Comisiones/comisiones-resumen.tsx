"use client"

// Vista de detalle/resumen de comisiones para SUPER_ADMIN:
// recibe filtros (sede + estilista), fuerza estado pendiente y muestra el primer período encontrado.

import { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle, User, Building } from "lucide-react";
import { toast } from 'sonner';
import { commissionsService } from "./Api/commissionsService";
import { CommissionSummary } from "../../../types/commissions";
import { Button } from "../../../components/ui/button";
import { formatCurrencyNoDecimals, getStoredCurrency } from "../../../lib/currency";

interface ComisionesResumenProps {
  filters?: {
    profesional_id?: string;
    sede_id?: string;
    estado?: string;
    tipo_comision?: string;
    fecha_inicio?: string;
    fecha_fin?: string;
  };
}

// Función para formatear moneda (fuera del componente)
const formatMoneda = (monto: number, moneda: string = getStoredCurrency("USD")): string => {
  return formatCurrencyNoDecimals(monto, moneda);
};

export function ComisionesResumen({ filters = {} }: ComisionesResumenProps) {
  const [summary, setSummary] = useState<CommissionSummary | null>(null);
  const [cargando, setCargando] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCommissionId, setSelectedCommissionId] = useState<string | null>(null);
  
  // Usar useRef para evitar dependencia cíclica
  const previousFiltersRef = useRef<string>('');
  const isMountedRef = useRef(true);

  // Cargar comisiones basado en filtros - DECLARADO AL PRINCIPIO
  const cargarComisiones = useCallback(async () => {
    // Si no hay sede_id, no hacer nada
    if (!filters.sede_id || !isMountedRef.current) {
      setSummary(null);
      setError(null);
      return;
    }

    // Si no hay profesional_id, no hacer nada
    if (!filters.profesional_id || !isMountedRef.current) {
      setSummary(null);
      setError("Debes seleccionar un estilista para ver sus comisiones");
      return;
    }

    // Verificar si los filtros realmente cambiaron
    const currentFiltersString = JSON.stringify(filters);
    if (currentFiltersString === previousFiltersRef.current) {
      return; // No hacer nada si los filtros son iguales
    }
    
    // Actualizar referencia
    previousFiltersRef.current = currentFiltersString;

    setCargando(true);
    setError(null);
    setSummary(null);

    try {
      console.log("🎯 Cargando comisiones con filtros:", filters);

      // Asegurar que tenemos estado pendiente
      const comisionesFilters = {
        ...filters,
        estado: "pendiente"
      };

      console.log("✅ Filtros finales para API:", comisionesFilters);

      // 1. Obtener la lista de comisiones
      const comisiones = await commissionsService.getCommissions(comisionesFilters);

      console.log("📋 Comisiones obtenidas:", comisiones);

      if (comisiones.length === 0) {
        setError(`No se encontraron comisiones pendientes para el estilista seleccionado en el rango de fechas especificado.`);
        return;
      }

      // Tomar la primera comisión para el detalle
      const primeraComision = comisiones[0];
      console.log("🎯 Primera comisión:", primeraComision.id);
      setSelectedCommissionId(primeraComision.id);

      // 2. Obtener el resumen detallado
      const resumenDetallado = await commissionsService.getCommissionSummary(primeraComision.id);
      console.log("📊 Resumen detallado:", resumenDetallado);
      
      if (isMountedRef.current) {
        setSummary(resumenDetallado);
      }

    } catch (err: any) {
      console.error("❌ Error cargando comisiones:", err);
      
      if (isMountedRef.current) {
        // Mensajes de error más específicos
        if (err.message?.includes('Request aborted')) {
          console.log("Request fue cancelado");
          return;
        }
        
        if (err.message?.includes('Failed to fetch')) {
          setError("Error de conexión con el servidor. Por favor, verifica tu conexión a internet.");
        } else {
          setError(`Error al cargar las comisiones: ${err.message || 'Error desconocido'}`);
        }
      }
    } finally {
      if (isMountedRef.current) {
        setCargando(false);
      }
    }
  }, [filters]);

  // Efecto para cargar comisiones cuando cambian los filtros
  useEffect(() => {
    isMountedRef.current = true;
    
    const timer = setTimeout(() => {
      cargarComisiones();
    }, 300); // Debounce de 300ms

    return () => {
      isMountedRef.current = false;
      clearTimeout(timer);
    };
  }, [cargarComisiones]); // Solo depende de cargarComisiones

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ✅ ESTADO INICIAL: Cuando no hay sede seleccionada
  if (!filters.sede_id) {
    return (
      <div className="rounded-lg border border-gray-300 bg-gray-100 p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-200">
          <Building className="h-8 w-8 text-gray-700" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-gray-900">
          Selecciona una sede
        </h3>
        <p className="text-gray-700">
          Primero selecciona una sede en los filtros arriba para ver las comisiones.
        </p>
      </div>
    );
  }

  // ✅ ESTADO INICIAL: Cuando no hay estilista seleccionado
  if (!filters.profesional_id) {
    return (
      <div className="rounded-lg border border-gray-300 bg-gray-100 p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-200">
          <User className="h-8 w-8 text-gray-700" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-gray-900">
          Selecciona un estilista
        </h3>
        <p className="text-gray-700">
          Usa los filtros arriba para seleccionar un estilista y ver sus comisiones pendientes.
        </p>
      </div>
    );
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-black"></div>
          <p className="mt-4 text-gray-700">Cargando datos de comisiones...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-gray-300 bg-gray-50 p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-gray-600" />
        <h3 className="mb-2 text-lg font-medium text-gray-900">
          {error}
        </h3>
        <div className="mt-4">
          <button
            onClick={cargarComisiones}
            className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-lg border border-gray-300 bg-gray-50 p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-gray-600" />
        <h3 className="mb-2 text-lg font-medium text-gray-900">
          No se encontraron comisiones
        </h3>
        <p className="text-gray-700">
          No hay comisiones pendientes para el estilista y rango de fechas seleccionado.
        </p>
        <div className="mt-4">
          <button
            onClick={cargarComisiones}
            className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const { servicios, productos, totales } = summary;
  const moneda = summary.moneda || getStoredCurrency("USD");

  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      {/* Main content */}
      <div className="flex-1">
        {/* Header con botón de exportar */}
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-gray-900">
            Detalle de Comisiones
          </h3>
        </div>

        {/* Servicios Section */}
        {servicios.length > 0 && (
          <div className="mb-8">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Servicios</h3>
            <div className="overflow-hidden rounded-lg border border-gray-300">
              {/* Table Header */}
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 bg-gray-100 p-4 text-sm font-semibold text-gray-900">
                <div>Servicio</div>
                <div className="text-right">Precio</div>
                <div className="text-right">% Estilista</div>
                <div className="text-right">Comisión Estilista</div>
                <div className="text-right">Comisión Casa</div>
              </div>

              {/* Servicios List */}
              <div className="divide-y divide-gray-200">
                {servicios.map((servicio) => (
                  <div
                    key={servicio.id}
                    className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 p-4 text-sm hover:bg-gray-50"
                  >
                    <div className="font-medium text-gray-900">{servicio.nombre}</div>
                    <div className="text-right text-gray-800">{formatMoneda(servicio.precio, moneda)}</div>
                    <div className="text-right text-gray-800">{servicio.comisionEstilistaPorcentaje}%</div>
                    <div className="text-right font-medium text-gray-900">
                      {formatMoneda(servicio.comisionEstilistaMonto, moneda)}
                    </div>
                    <div className="text-right text-gray-800">
                      {formatMoneda(servicio.comisionCasaMonto, moneda)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Productos Section */}
        {productos.length > 0 && (
          <div className="mb-8">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Productos</h3>
            <div className="overflow-hidden rounded-lg border border-gray-300">
              {/* Table Header */}
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 bg-gray-100 p-4 text-sm font-semibold text-gray-900">
                <div>Producto</div>
                <div className="text-right">Precio</div>
                <div className="text-right">% Estilista</div>
                <div className="text-right">Comisión Estilista</div>
                <div className="text-right">Comisión Casa</div>
              </div>

              {/* Productos List */}
              <div className="divide-y divide-gray-200">
                {productos.map((producto) => (
                  <div
                    key={producto.id}
                    className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 p-4 text-sm hover:bg-gray-50"
                  >
                    <div className="font-medium text-gray-900">{producto.nombre}</div>
                    <div className="text-right text-gray-800">{formatMoneda(producto.precio, moneda)}</div>
                    <div className="text-right text-gray-800">{producto.comisionEstilistaPorcentaje}%</div>
                    <div className="text-right font-medium text-gray-900">
                      {formatMoneda(producto.comisionEstilistaMonto, moneda)}
                    </div>
                    <div className="text-right text-gray-800">
                      {formatMoneda(producto.comisionCasaMonto, moneda)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Si no hay servicios ni productos */}
        {servicios.length === 0 && productos.length === 0 && summary && (
          <div className="rounded-lg border border-gray-300 bg-gray-100 p-6 text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-gray-600" />
            <h3 className="mb-2 text-lg font-medium text-gray-900">
              Comisión encontrada sin detalle
            </h3>
            <p className="text-gray-700">
              Se encontró una comisión pendiente pero no hay servicios o productos detallados.
            </p>
          </div>
        )}
      </div>

      {/* Sidebar with totals */}
      <div className="w-full lg:w-80">
        <div className="sticky top-4 rounded-lg border border-gray-300 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Resumen de Liquidación</h3>
            {selectedCommissionId && (
              <p className="text-sm text-gray-600">
              </p>
            )}
          </div>

          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-sm font-medium text-gray-700">Comisión Total Estilista</span>
            <span className="text-2xl font-bold text-gray-900">
              {formatMoneda(totales.totalComisionEstilista, moneda)}
            </span>
          </div>

          <div className="space-y-3 border-t border-gray-300 pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">Total servicios</span>
              <span className="font-medium text-gray-900">{formatMoneda(totales.totalServicios, moneda)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">Total productos</span>
              <span className="font-medium text-gray-900">{formatMoneda(totales.totalProductos, moneda)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">Comisión casa</span>
              <span className="font-medium text-gray-900">{formatMoneda(totales.totalComisionCasa, moneda)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-800">
              <span>Descuentos nómina</span>
              <span>-{formatMoneda(totales.descuentosNomina, moneda)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-800">
              <span>Anticipos/Bonos</span>
              <span>+{formatMoneda(totales.anticiposBonos, moneda)}</span>
            </div>
          </div>

          <div className="mt-4 flex justify-between border-t border-gray-300 pt-4 text-base font-semibold">
            <span className="text-gray-900">Total a pagar</span>
            <span className="text-black font-bold">
              {formatMoneda(totales.totalAPagar, moneda)}
            </span>
          </div>

          {/* Botón de aprobación */}
          <div className="mt-6">
            <Button
              className="w-full bg-black text-white hover:bg-gray-800"
              onClick={async () => {
                if (selectedCommissionId) {
                  try {
                    const success = await commissionsService.approveCommission(selectedCommissionId);
                    if (success) {
                      toast.success("Liquidación aprobada correctamente");
                      cargarComisiones(); // Recargar datos
                    } else {
                      toast.error("Error al aprobar la liquidación");
                    }
                  } catch (error) {
                    console.error("Error aprobando comisión:", error);
                    toast.error("Error al aprobar la liquidación");
                  }
                }
              }}
              disabled={!selectedCommissionId}
            >
              Aprobar liquidación
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
