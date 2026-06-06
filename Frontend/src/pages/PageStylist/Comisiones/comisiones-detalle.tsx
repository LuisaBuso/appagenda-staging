"use client"

// Detalle de transacciones que generan comisiones (perfil ESTILISTA).

import { useState } from "react";
import { Download, Filter, Calendar, User, Building } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";

export function ComisionesDetalle() {
  const [filtroActivo, setFiltroActivo] = useState<string>("todos");

  // En una implementación real, estos datos vendrían de una API
  const datosDetalle: any[] = []; // Array vacío

  const filtros = [
    { id: "todos", label: "Todos" },
    { id: "servicios", label: "Solo servicios" },
    { id: "productos", label: "Solo productos" },
    { id: "comisionados", label: "Comisionados" },
    { id: "no-comisionados", label: "No comisionados" },
  ];

  const noHayDatos = datosDetalle.length === 0;

  return (
    <div className="space-y-6">
      {/* Encabezado y filtros */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-gray-200 bg-white p-6 md:flex-row md:items-center">
        <div>
          <h3 className="text-lg font-semibold">Detalle de transacciones</h3>
          <p className="text-sm text-gray-600">
            Vista detallada de todas las transacciones que generan comisiones
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {/* Filtros rápidos */}
          <div className="flex flex-wrap gap-2">
            {filtros.map((filtro) => (
              <button
                key={filtro.id}
                onClick={() => setFiltroActivo(filtro.id)}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  filtroActivo === filtro.id
                    ? "bg-[oklch(0.65_0.25_280)] text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {filtro.label}
              </button>
            ))}
          </div>

          {/* Selector de período */}
          <Select defaultValue="mes-actual">
            <SelectTrigger className="w-[180px]">
              <Calendar className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hoy">Hoy</SelectItem>
              <SelectItem value="ayer">Ayer</SelectItem>
              <SelectItem value="semana">Esta semana</SelectItem>
              <SelectItem value="mes-actual">Este mes</SelectItem>
              <SelectItem value="mes-anterior">Mes anterior</SelectItem>
              <SelectItem value="personalizado">Personalizado</SelectItem>
            </SelectContent>
          </Select>

          {/* Botón exportar */}
          <Button variant="outline" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Exportar
          </Button>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="rounded-lg border border-gray-200 bg-white">
        {noHayDatos ? (
          <div className="p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Filter className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-gray-700">
              No hay datos para mostrar
            </h3>
            <p className="mb-6 text-gray-500 max-w-md mx-auto">
              Aplica filtros para ver el detalle de comisiones por servicio, producto, estilista o período.
            </p>
            
            {/* Información sobre los datos disponibles */}
            <div className="mx-auto max-w-2xl rounded-lg bg-gray-50 p-6 text-left">
              <h4 className="mb-3 font-medium text-gray-700">Información disponible en esta vista:</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <div className="mt-1 h-2 w-2 rounded-full bg-[oklch(0.65_0.25_280)]"></div>
                  <span>Detalle de cada servicio prestado</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="mt-1 h-2 w-2 rounded-full bg-[oklch(0.65_0.25_280)]"></div>
                  <span>Productos vendidos con sus respectivas comisiones</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="mt-1 h-2 w-2 rounded-full bg-[oklch(0.65_0.25_280)]"></div>
                  <span>Fecha y hora de cada transacción</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="mt-1 h-2 w-2 rounded-full bg-[oklch(0.65_0.25_280)]"></div>
                  <span>Estilista que realizó el servicio/venta</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="mt-1 h-2 w-2 rounded-full bg-[oklch(0.65_0.25_280)]"></div>
                  <span>Sede donde se realizó la transacción</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="mt-1 h-2 w-2 rounded-full bg-[oklch(0.65_0.25_280)]"></div>
                  <span>Porcentajes y montos de comisión aplicados</span>
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    Fecha
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      Estilista
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    <div className="flex items-center gap-1">
                      <Building className="h-4 w-4" />
                      Sede
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    Servicio/Producto
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    Precio
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    Comisión %
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    Comisión $
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Aquí se renderizarían los datos cuando estén disponibles */}
                {datosDetalle.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                    {/* Contenido de cada fila */}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Información sobre la vista de detalle */}
      <div className="rounded-lg border border-gray-200 bg-blue-50 p-6">
        <h4 className="mb-3 font-medium text-blue-800">¿Cómo funciona esta vista?</h4>
        <p className="mb-3 text-sm text-blue-700">
          Esta vista muestra el detalle de todas las transacciones que generan comisiones para los estilistas.
          Puedes filtrar por tipo de transacción, período, estilista o sede.
        </p>
        <div className="grid gap-4 text-sm text-blue-700 md:grid-cols-2">
          <div>
            <p className="font-medium">Servicios:</p>
            <p>Muestra todos los servicios prestados por los estilistas con sus respectivas comisiones.</p>
          </div>
          <div>
            <p className="font-medium">Productos:</p>
            <p>Muestra los productos vendidos por los estilistas y las comisiones generadas.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
