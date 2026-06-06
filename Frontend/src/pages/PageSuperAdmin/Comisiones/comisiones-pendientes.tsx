"use client"

import { useState, useEffect } from "react";
import { AlertTriangle, DollarSign, Users, Package, Scissors, Building } from "lucide-react";
import { commissionsService } from "./Api/commissionsService";
import { PendientesResumen } from "../../../types/commissions";
import { sedeService } from "../Sedes/sedeService";
import type { Sede } from "../../../types/sede";
import { formatSedeNombre } from "../../../lib/sede";
import { formatCurrencyNoDecimals, getStoredCurrency } from "../../../lib/currency";

// Formatea valores con la moneda persistida para el usuario.
const formatMoneda = (monto: number, moneda: string = getStoredCurrency("USD")): string => {
  return formatCurrencyNoDecimals(monto, moneda);
};

export function ComisionesPendientes() {
  const [resumen, setResumen] = useState<PendientesResumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSede, setSelectedSede] = useState<string>("");
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [cargandoSedes, setCargandoSedes] = useState(false);

  // Cargar sedes disponibles (super_admin debe elegir en qué sede ver pendientes).
  useEffect(() => {
    const cargarSedes = async () => {
      setCargandoSedes(true);
      try {
        const token = sessionStorage.getItem("access_token");
        if (!token) {
          throw new Error("No hay token de autenticación");
        }
        
        const sedesData = await sedeService.getSedes(token);
        setSedes(sedesData);
        
        // Si solo hay una sede, seleccionarla automáticamente
        if (sedesData.length === 1) {
          setSelectedSede(sedesData[0]._id);
        }
      } catch (error) {
        console.error("Error cargando sedes:", error);
        setSedes([]);
      } finally {
        setCargandoSedes(false);
      }
    };

    cargarSedes();
  }, []);

  // Cargar resumen cuando se selecciona una sede; evita llamadas sin contexto.
  useEffect(() => {
    if (selectedSede) {
      cargarResumen();
    } else {
      setResumen(null);
    }
  }, [selectedSede]);

  const cargarResumen = async () => {
    if (!selectedSede) {
      setError("Debes seleccionar una sede primero");
      return;
    }

    setCargando(true);
    setError(null);
    
    try {
      // ⚠️ TODO backend: aún no acepta sede_id; el backend aplica sede según rol.
      // La vista fuerza selección de sede para que el usuario tenga contexto claro.
      const data = await commissionsService.getPendientesResumen();
      setResumen(data);
    } catch (err) {
      console.error("Error cargando resumen pendientes:", err);
      setError("Error al cargar el resumen de comisiones pendientes");
    } finally {
      setCargando(false);
    }
  };

  // ✅ ESTADO INICIAL: Cuando no hay sede seleccionada
  if (!selectedSede && sedes.length > 0) {
    return (
      <div className="rounded-lg border border-gray-300 bg-gray-100 p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-200">
          <Building className="h-8 w-8 text-gray-600" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-gray-900">
          Selecciona una sede
        </h3>
        <p className="text-gray-700 mb-6">
          Primero selecciona una sede para ver las comisiones pendientes.
        </p>
        
        <div className="max-w-md mx-auto">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Seleccionar sede
          </label>
          <select
            value={selectedSede}
            onChange={(e) => setSelectedSede(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-gray-400"
            disabled={cargandoSedes}
          >
            <option value="">-- Selecciona una sede --</option>
            {sedes.map((sede) => (
              <option key={sede._id} value={sede._id}>
                {formatSedeNombre(sede.nombre)}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

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
      {/* Header con selector de sede */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Comisiones Pendientes</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Sede:</span>
            <select
              value={selectedSede}
              onChange={(e) => setSelectedSede(e.target.value)}
              className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-gray-400"
              disabled={cargandoSedes}
            >
              {sedes.map((sede) => (
                <option key={sede._id} value={sede._id}>
                  {formatSedeNombre(sede.nombre)}
                </option>
              ))}
            </select>
          </div>
        </div>
        
        <p className="text-sm text-gray-600">
          Mostrando comisiones pendientes para la sede seleccionada
        </p>
      </div>

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
            <p className="text-gray-500">No hay comisiones pendientes en esta sede</p>
          </div>
        )}
      </div>
    </div>
  );
}
