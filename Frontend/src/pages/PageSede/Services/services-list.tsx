"use client";

import { Card } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Pencil, Trash2, Clock, DollarSign, Package } from "lucide-react";
import type { ServiceWithCurrency } from "./serviciosService";

interface ServicesListProps {
  services: ServiceWithCurrency[];
  onEdit: (service: ServiceWithCurrency) => void;
  onDelete: (id: string) => void;
}

export function ServicesList({ services, onEdit, onDelete }: ServicesListProps) {
  const formatAmountNoDecimals = (value: number, currency: string = "USD") => {
    const safeValue = Number.isFinite(value) ? value : 0;
    const locale = currency === "USD" ? "en-US" : currency === "MXN" ? "es-MX" : "es-CO";
    return Math.round(safeValue).toLocaleString(locale, { maximumFractionDigits: 0 });
  };

  if (services.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-900">No se encontraron servicios</p>
          <p className="mt-1 text-sm text-gray-500">
            Intenta ajustar los filtros o añade un nuevo servicio
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {services.map((service) => (
        <Card
          key={service.id}
          className="rounded-xl border bg-white p-5 shadow-sm transition-all hover:shadow-lg"
        >
          {/* Encabezado: Categoría + Estado */}
          <div className="mb-3 flex items-center justify-between">
            <Badge variant="outline" className="text-xs">
              {service.categoria}
            </Badge>

            <Badge
              variant="default"
              className={`${service.activo ? "bg-green-500" : "bg-gray-400"}`}
            >
              {service.activo ? "Activo" : "Inactivo"}
            </Badge>
          </div>

          {/* Nombre del servicio */}
          <h3 className="mb-1 text-lg font-semibold text-gray-900">{service.nombre}</h3>

          {/* Descripción */}
          <p className="mb-4 text-sm text-gray-600 line-clamp-2">
            {service.descripcion || `Servicio de ${service.categoria.toLowerCase()}`}
          </p>

          {/* Detalles del servicio */}
          <div className="mb-5 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1 text-gray-600">
                <DollarSign className="h-4 w-4" />
                Precio ({service.moneda_local || 'USD'})
              </span>
              <span className="font-semibold text-gray-900">
                ${formatAmountNoDecimals(service.precio_local || service.precio, service.moneda_local || "USD")}
                <span className="ml-1 text-xs text-gray-500">
                  {service.moneda_local || 'USD'}
                </span>
              </span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1 text-gray-600">
                <Clock className="h-4 w-4" />
                Duración
              </span>
              <span className="font-semibold text-gray-900">
                {service.duracion} min
              </span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Comisión estilista</span>
              <span className="font-semibold text-[oklch(0.55_0.25_280)]">
                {service.comision_porcentaje}%
              </span>
            </div>

            {/* Requiere producto */}
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1 text-gray-600">
                <Package className="h-4 w-4" />
                Requiere producto
              </span>
              <Badge variant={service.requiere_producto ? "default" : "outline"} className="text-xs">
                {service.requiere_producto ? "Sí" : "No"}
              </Badge>
            </div>

            {/* Mostrar todos los precios si están disponibles */}
            {service.precios_completos && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-2">Precios completos:</p>
                <div className="space-y-1 text-xs">
                  {service.precios_completos.USD && (
                    <div className="flex justify-between">
                      <span>USD:</span>
                      <span>${formatAmountNoDecimals(service.precios_completos.USD, "USD")}</span>
                    </div>
                  )}
                  {service.precios_completos.COP && (
                    <div className="flex justify-between">
                      <span>COP:</span>
                      <span>${formatAmountNoDecimals(service.precios_completos.COP, "COP")}</span>
                    </div>
                  )}
                  {service.precios_completos.MXN && (
                    <div className="flex justify-between">
                      <span>MXN:</span>
                      <span>${formatAmountNoDecimals(service.precios_completos.MXN, "MXN")}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-gray-300"
              onClick={() => onEdit(service)}
            >
              <Pencil className="mr-1 h-3 w-3" />
              Editar
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => onDelete(service.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
