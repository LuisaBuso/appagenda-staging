// app/comisiones/comisiones-pendientes.tsx
"use client"

// Resumen de comisiones pendientes para ADMIN_SEDE.
// El backend ya filtra por la sede del usuario; aquí solo mostramos los totales.

import { useState, useEffect } from "react";
import { AlertTriangle, DollarSign, Users, Package, Scissors } from "lucide-react";
import { commissionsService } from "./Api/commissionsService";
import { PendientesResumen,  } from "../../../types/commissions";
import { formatCurrencyNoDecimals, getStoredCurrency } from "../../../lib/currency";

// Función para formatear moneda
const formatMoneda = (monto: number, moneda: string = getStoredCurrency("USD")): string => {
  return formatCurrencyNoDecimals(monto, moneda);
};

export function ComisionesPendientes() {
  const [resumen, setResumen] = useState<PendientesResumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cargarResumen();
  }, []);

  const cargarResumen = async () => {
    setCargando(true);
    setError(null);
    
    try {
      const data = await commissionsService.getPendientesResumen();
      setResumen(data);
    } catch (err) {
      console.error("Error cargando resumen pendientes:", err);
      setError("Error al cargar el resumen de comisiones pendientes");
    } finally {
      setCargando(false);
    }
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-black"></div>
          <p className="mt-4 text-gray-700">Cargando resumen pendientes...</p>
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
        <button
          onClick={cargarResumen}
          className="mt-4 rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!resumen) {
    return (
      <div className="rounded-lg border border-gray-300 bg-gray-50 p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-gray-600" />
        <h3 className="mb-2 text-lg font-medium text-gray-900">
          No hay datos disponibles
        </h3>
      </div>
    );
  }

  const { 
    total_comisiones_pendientes, 
    monto_total_pendiente, 
    total_comisiones_servicios,
    total_comisiones_productos,
    moneda,
    por_profesional 
  } = resumen;

  return (
    <div className="space-y-6">
      {/* Cards de resumen */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Total Pendientes */}
        <div className="rounded-lg border border-gray-300 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Pendientes</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {total_comisiones_pendientes}
              </p>
            </div>
            <div className="rounded-full bg-gray-200 p-3">
              <DollarSign className="h-6 w-6 text-gray-700" />
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-500">
            Comisiones por liquidar
          </div>
        </div>

        {/* Monto Total */}
        <div className="rounded-lg border border-gray-300 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Monto Total</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {formatMoneda(monto_total_pendiente, moneda)}
              </p>
            </div>
            <div className="rounded-full bg-gray-200 p-3">
              <DollarSign className="h-6 w-6 text-gray-700" />
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-500">
            Valor total pendiente
          </div>
        </div>

        {/* Comisiones Servicios */}
        <div className="rounded-lg border border-gray-300 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Por Servicios</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {formatMoneda(total_comisiones_servicios, moneda)}
              </p>
            </div>
            <div className="rounded-full bg-gray-200 p-3">
              <Scissors className="h-6 w-6 text-gray-700" />
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-500">
            Valor por servicios
          </div>
        </div>

        {/* Comisiones Productos */}
        <div className="rounded-lg border border-gray-300 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Por Productos</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {formatMoneda(total_comisiones_productos, moneda)}
              </p>
            </div>
            <div className="rounded-full bg-gray-200 p-3">
              <Package className="h-6 w-6 text-gray-700" />
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-500">
            Valor por productos
          </div>
        </div>
      </div>

      {/* Tabla de profesionales */}
      <div className="rounded-lg border border-gray-300 bg-white">
        <div className="border-b border-gray-300 p-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users className="h-5 w-5" />
            Comisiones por Profesional
          </h3>
        </div>
        
        {por_profesional.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Profesional
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Períodos
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tipo
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Servicios
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Productos
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {por_profesional.map((prof) => (
                  <tr key={prof.profesional_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="font-medium text-gray-900">
                          {prof.profesional_nombre}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-200 text-gray-800">
                        {prof.cantidad_periodos} períodos
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-200 text-gray-800">
                        {prof.tipo_comision || 'mixto'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatMoneda(prof.total_comisiones_servicios, prof.moneda)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatMoneda(prof.total_comisiones_productos, prof.moneda)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-lg font-bold text-gray-900">
                        {formatMoneda(prof.total_comisiones, prof.moneda)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <p className="text-gray-500">No hay comisiones pendientes</p>
          </div>
        )}
      </div>
    </div>
  );
}
