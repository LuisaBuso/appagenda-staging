"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader, X } from "lucide-react";
import type { ServiceCommissionEntry, ServiceCommissionType } from "../../lib/serviceCommissions";

interface ServiceOption {
  id: string;
  nombre: string;
}

interface CommissionRowState {
  valor: string;
  tipo: ServiceCommissionType;
}

interface ServiceCommissionsModalProps {
  isOpen: boolean;
  stylistName: string;
  services: ServiceOption[];
  initialEntries: ServiceCommissionEntry[];
  canPersist: boolean;
  isSaving?: boolean;
  onClose: () => void;
  onSave: (entries: ServiceCommissionEntry[]) => void;
}

function getInitialRow(
  serviceId: string,
  initialMap: Map<string, ServiceCommissionEntry>,
): CommissionRowState {
  const current = initialMap.get(serviceId);
  return {
    valor: current ? String(current.valor) : "0",
    tipo: current?.tipo ?? "%",
  };
}

export function ServiceCommissionsModal({
  isOpen,
  stylistName,
  services,
  initialEntries,
  canPersist,
  isSaving = false,
  onClose,
  onSave,
}: ServiceCommissionsModalProps) {
  const [rows, setRows] = useState<Record<string, CommissionRowState>>({});

  const initialMap = useMemo(() => {
    return new Map(initialEntries.map((entry) => [entry.servicio_id, entry]));
  }, [initialEntries]);

  const orderedServices = useMemo(() => {
    return [...services].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [services]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const nextRows: Record<string, CommissionRowState> = {};
    for (const service of orderedServices) {
      nextRows[service.id] = getInitialRow(service.id, initialMap);
    }
    setRows(nextRows);
  }, [initialMap, isOpen, orderedServices]);

  const errorsByService = useMemo(() => {
    const errors: Record<string, string> = {};

    for (const service of orderedServices) {
      const row = rows[service.id] ?? getInitialRow(service.id, initialMap);
      const rawValue = row.valor.trim();
      const parsedValue = rawValue === "" ? 0 : Number(rawValue);

      if (!Number.isFinite(parsedValue)) {
        errors[service.id] = "Ingresa un número válido";
        continue;
      }

      if (parsedValue < 0) {
        errors[service.id] = "No se permiten valores negativos";
        continue;
      }

      if (row.tipo === "%" && parsedValue > 100) {
        errors[service.id] = "Para porcentaje el máximo es 100";
      }
    }

    return errors;
  }, [initialMap, orderedServices, rows]);

  const hasErrors = useMemo(() => {
    return Object.keys(errorsByService).length > 0;
  }, [errorsByService]);

  const handleValueChange = (serviceId: string, value: string) => {
    setRows((current) => ({
      ...current,
      [serviceId]: {
        ...(current[serviceId] ?? { valor: "0", tipo: "%" }),
        valor: value,
      },
    }));
  };

  const handleTypeChange = (serviceId: string, value: ServiceCommissionType) => {
    setRows((current) => ({
      ...current,
      [serviceId]: {
        ...(current[serviceId] ?? { valor: "0", tipo: "%" }),
        tipo: value,
      },
    }));
  };

  const handleSave = () => {
    if (hasErrors || isSaving || !canPersist) {
      return;
    }

    const nextEntries: ServiceCommissionEntry[] = orderedServices.map((service) => {
      const row = rows[service.id] ?? getInitialRow(service.id, initialMap);
      const parsedValue = Number(row.valor);
      const normalizedValue =
        Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0;

      return {
        servicio_id: service.id,
        valor: normalizedValue,
        tipo: row.tipo,
      };
    });

    onSave(nextEntries);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
      onClick={() => {
        if (!isSaving) {
          onClose();
        }
      }}
    >
      <div
        className="bg-white rounded-lg border border-gray-300 shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col text-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h3 className="text-lg font-semibold">
            Editando comisiones para {stylistName || "estilista"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pt-4">
          {!canPersist && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Esta cuenta no expone un campo de comisiones por servicio en el payload actual, por lo que no se puede persistir desde frontend sin cambiar backend.
            </div>
          )}
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          {orderedServices.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              No hay servicios disponibles para configurar comisiones.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {orderedServices.map((service) => {
                const row = rows[service.id] ?? getInitialRow(service.id, initialMap);
                const error = errorsByService[service.id];

                return (
                  <div
                    key={service.id}
                    className="rounded-lg border border-gray-200 p-3 bg-white"
                  >
                    <p className="text-sm font-semibold text-gray-900 uppercase leading-tight">
                      {service.nombre}
                    </p>
                    <div className="mt-2 flex items-start gap-2">
                      <div className="flex-1">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={row.valor}
                          onChange={(event) =>
                            handleValueChange(service.id, event.target.value)
                          }
                          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900/10 ${
                            error ? "border-red-300" : "border-gray-300"
                          }`}
                          disabled={isSaving}
                        />
                        {error && (
                          <p className="mt-1 text-xs text-red-600">{error}</p>
                        )}
                      </div>
                      <select
                        value={row.tipo}
                        onChange={(event) =>
                          handleTypeChange(
                            service.id,
                            event.target.value as ServiceCommissionType,
                          )
                        }
                        className="w-20 px-2 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                        disabled={isSaving}
                      >
                        <option value="%">%</option>
                        <option value="$">$</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 px-5 py-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            disabled={isSaving}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 bg-black text-white border border-black rounded-lg hover:bg-gray-900 transition-colors disabled:opacity-50 flex items-center gap-2"
            disabled={
              isSaving ||
              orderedServices.length === 0 ||
              hasErrors ||
              !canPersist
            }
          >
            {isSaving ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              "Actualizar comisiones"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
