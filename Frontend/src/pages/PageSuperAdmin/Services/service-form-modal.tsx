"use client";

import { useState, useEffect } from "react";
import { X, Loader } from "lucide-react";
import { toast } from 'sonner';
import type { Service } from "../../../types/service";

interface ServiceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (service: Service) => void;
  service: Service | null;
  isSaving?: boolean;
}

export function ServiceFormModal({
  isOpen,
  onClose,
  onSave,
  service,
  isSaving = false,
}: ServiceFormModalProps) {
  const [formData, setFormData] = useState<Partial<Service>>({
    nombre: "",
    descripcion: "",
    precio: 0,
    duracion: 30,
    categoria: "Cortes",
    activo: true,
    comision_porcentaje: 50,
  });

  useEffect(() => {
    if (service) {
      setFormData(service);
    } else {
      setFormData({
        nombre: "",
        descripcion: "",
        precio: 0,
        duracion: 30,
        categoria: "Cortes",
        activo: true,
        comision_porcentaje: 50,
      });
    }
  }, [service, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.nombre?.trim()) {
      toast.warning('El nombre del servicio es requerido');
      return;
    }

    if (!formData.precio || formData.precio <= 0) {
      toast.warning('El precio debe ser mayor a 0');
      return;
    }

    if (!formData.duracion || formData.duracion <= 0) {
      toast.warning('La duración debe ser mayor a 0');
      return;
    }

    onSave(formData as Service);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">
            {service ? "Editar servicio" : "Nuevo servicio"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="nombre" className="mb-1 block text-sm font-medium text-gray-700">
              Nombre *
            </label>
            <input
              id="nombre"
              type="text"
              value={formData.nombre || ""}
              onChange={(e) =>
                setFormData({ ...formData, nombre: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
              disabled={isSaving}
              required
              placeholder="Ej: Corte de cabello"
            />
          </div>

          <div>
            <label htmlFor="descripcion" className="mb-1 block text-sm font-medium text-gray-700">
              Descripción
            </label>
            <textarea
              id="descripcion"
              value={formData.descripcion || ""}
              onChange={(e) =>
                setFormData({ ...formData, descripcion: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
              disabled={isSaving}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="precio" className="mb-1 block text-sm font-medium text-gray-700">
                Precio *
              </label>
              <input
                id="precio"
                type="number"
                min="0"
                step="0.01"
                value={formData.precio ?? 0}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    precio: parseFloat(e.target.value || "0"),
                  })
                }
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
                disabled={isSaving}
                required
              />
            </div>

            <div>
              <label htmlFor="duracion" className="mb-1 block text-sm font-medium text-gray-700">
                Duración (min) *
              </label>
              <input
                id="duracion"
                type="number"
                min="5"
                step="5"
                value={formData.duracion ?? 0}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    duracion: parseInt(e.target.value || "0", 10),
                  })
                }
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
                disabled={isSaving}
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="categoria" className="mb-1 block text-sm font-medium text-gray-700">
              Categoría *
            </label>
            <select
              id="categoria"
              value={formData.categoria || "Cortes"}
              onChange={(e) =>
                setFormData({ ...formData, categoria: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
              disabled={isSaving}
            >
              <option value="Cortes">Cortes</option>
              <option value="Coloración">Coloración</option>
              <option value="Barba">Barba</option>
              <option value="Tratamientos">Tratamientos</option>
              <option value="Peinados">Peinados</option>
              <option value="Manicura">Manicura</option>
              <option value="Pedicura">Pedicura</option>
            </select>
          </div>

          <div>
            <label htmlFor="comision" className="mb-1 block text-sm font-medium text-gray-700">
              Comisión (%) *
            </label>
            <input
              id="comision"
              type="number"
              min="0"
              max="100"
              value={formData.comision_porcentaje ?? 0}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  comision_porcentaje: parseFloat(e.target.value || "0"),
                })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[oklch(0.55_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.55_0.25_280)]/20"
              disabled={isSaving}
              required
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
            <div>
              <label htmlFor="activo" className="block text-base font-medium text-gray-700">
                Activo
              </label>
              <p className="text-sm text-gray-500">Disponible para agendar</p>
            </div>
            <input
              id="activo"
              type="checkbox"
              checked={!!formData.activo}
              onChange={(e) =>
                setFormData({ ...formData, activo: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300 text-[oklch(0.55_0.25_280)] focus:ring-[oklch(0.55_0.25_280)]"
              disabled={isSaving}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-6 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              disabled={isSaving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-2 font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                service ? "Guardar cambios" : "Crear servicio"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
