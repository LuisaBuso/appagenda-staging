"use client"

import { Clock, DollarSign, Percent, Tag, Pencil, Trash2 } from 'lucide-react'
import { confirmAction } from '../../../components/ui/confirm-dialog'
import type { Service } from "../../../types/service"

interface ServicesListProps {
  services: Service[]
  onEdit: (service: Service) => void
  onDelete: (id: string) => void
}

export function ServicesList({ services, onEdit, onDelete }: ServicesListProps) {
  const getSafeValue = (obj: any, key: string, defaultValue: string = '') => {
    return obj && obj[key] !== undefined && obj[key] !== null ? obj[key] : defaultValue;
  };
  const formatAmountNoDecimals = (value: number) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    return Math.round(safeValue).toLocaleString("es-CO", { maximumFractionDigits: 0 });
  };

  const validServices = services.filter(service => service && service.id);

  if (validServices.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-600 text-sm">No hay servicios</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {validServices.map((service) => (
        <div
          key={service.id}
          className="border p-3 hover:bg-gray-50 flex flex-col"
        >
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm truncate">{getSafeValue(service, 'nombre')}</h3>
              <span className={`text-xs px-1.5 py-0.5 ml-1 flex-shrink-0 ${
                service.activo 
                  ? 'bg-gray-100' 
                  : 'bg-gray-200'
              }`}>
                {service.activo ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            
            <div className="space-y-1.5">
              <div className="flex items-center text-xs text-gray-600">
                <Tag className="h-3 w-3 mr-1.5 flex-shrink-0" />
                <span className="truncate">{getSafeValue(service, 'categoria')}</span>
              </div>
              
              <div className="flex items-center text-xs text-gray-600">
                <DollarSign className="h-3 w-3 mr-1.5 flex-shrink-0" />
                <span>${formatAmountNoDecimals(service.precio || 0)}</span>
              </div>
              
              <div className="flex items-center text-xs text-gray-600">
                <Clock className="h-3 w-3 mr-1.5 flex-shrink-0" />
                <span>{service.duracion} min</span>
              </div>
              
              <div className="flex items-center text-xs text-gray-600">
                <Percent className="h-3 w-3 mr-1.5 flex-shrink-0" />
                <span>{service.comision_porcentaje}% comisión</span>
              </div>
            </div>
            
            {service.requiere_producto && (
              <div className="text-xs text-gray-500 mt-2 pt-1.5 border-t">
                Requiere producto
              </div>
            )}
          </div>
          
          <div className="flex justify-end gap-1 mt-3 pt-2 border-t">
            <button
              onClick={() => onEdit(service)}
              className="p-0.5 hover:bg-gray-100 text-gray-600"
              title="Editar"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={async () => {
                const confirmed = await confirmAction({ title: "Confirmar", message: "¿Eliminar servicio?", confirmLabel: "Sí, eliminar", variant: "danger" });
                if (confirmed) {
                  onDelete(service.id);
                }
              }}
              className="p-0.5 hover:bg-gray-100 text-gray-600"
              title="Eliminar"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
