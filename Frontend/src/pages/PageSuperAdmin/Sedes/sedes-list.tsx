"use client"

import { Clock3, Mail, MapPin, Pencil, Phone, Trash2 } from 'lucide-react'
import { confirmAction } from '../../../components/ui/confirm-dialog'
import { Badge } from "../../../components/ui/badge"
import { Button } from "../../../components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../../../components/ui/card"
import type { Sede } from "../../../types/sede"

interface SedesListProps {
  sedes: Sede[]
  onEdit: (sede: Sede) => void
  onDelete: (sedeId: string) => void
}

export function SedesList({ sedes, onEdit, onDelete }: SedesListProps) {
  const getSafeValue = (obj: any, key: string, defaultValue: string = '') => {
    return obj && obj[key] !== undefined && obj[key] !== null ? obj[key] : defaultValue;
  };

  const SedeInfoRow = ({
    icon: Icon,
    label,
    value,
    clamp = false,
  }: {
    icon: typeof MapPin
    label: string
    value: string
    clamp?: boolean
  }) => (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-gray-50">
        <Icon className="h-3.5 w-3.5 text-gray-700" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <p className={`mt-0.5 text-[13px] leading-5 text-gray-700 ${clamp ? "line-clamp-3" : "truncate"}`}>
          {value}
        </p>
      </div>
    </div>
  )

  const validSedes = sedes.filter(sede => sede && sede._id);

  if (validSedes.length === 0) {
    return (
      <Card className="border-gray-300 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700">
            <MapPin className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">No hay sedes</h3>
          <p className="mt-2 max-w-sm text-sm text-gray-500">
            Cuando registres una sede, aparecerá aquí con el mismo formato visual del módulo de facturación.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {validSedes.map((sede) => (
        <Card
          key={sede._id}
          className="flex h-full w-full max-w-[320px] flex-col justify-self-center border-gray-300 shadow-sm transition-colors hover:border-gray-400"
        >
          <CardHeader className="space-y-2.5 p-3.5 pb-2.5">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-sm font-semibold text-gray-900">
                {getSafeValue(sede, 'nombre', 'Sin nombre')}
              </CardTitle>
              <Badge
                variant="outline"
                className={`shrink-0 rounded-full px-2 py-0 text-[10px] font-medium ${
                  sede.activa
                    ? 'border-gray-300 bg-gray-100 text-gray-700'
                    : 'border-gray-300 bg-white text-gray-500'
                }`}
              >
                {sede.activa ? 'Activa' : 'Inactiva'}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-3 p-3.5 pt-0">
            <SedeInfoRow
              icon={MapPin}
              label="Dirección"
              value={getSafeValue(sede, 'direccion', 'Sin dirección')}
              clamp
            />
            <SedeInfoRow
              icon={Phone}
              label="Teléfono"
              value={getSafeValue(sede, 'telefono', 'Sin teléfono')}
            />
            <SedeInfoRow
              icon={Mail}
              label="Email"
              value={getSafeValue(sede, 'email', 'Sin email')}
            />

            {sede.zona_horaria && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white">
                    <Clock3 className="h-3.5 w-3.5 text-gray-700" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Zona horaria</p>
                    <p className="mt-0.5 text-[13px] text-gray-700">{sede.zona_horaria}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="mt-auto justify-end gap-1.5 border-t border-gray-200 px-3.5 py-2.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onEdit(sede)}
              className="h-7.5 w-7.5 border-gray-300 text-gray-700 shadow-sm hover:bg-gray-100 hover:text-black"
              title="Editar"
              aria-label={`Editar ${getSafeValue(sede, 'nombre', 'sede')}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={async () => {
                const confirmed = await confirmAction({ title: "Confirmar", message: "¿Eliminar sede?", confirmLabel: "Sí, eliminar", variant: "danger" });
                if (confirmed) {
                  onDelete(sede._id);
                }
              }}
              className="h-7.5 w-7.5 border-gray-300 text-gray-700 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-700"
              title="Eliminar"
              aria-label={`Eliminar ${getSafeValue(sede, 'nombre', 'sede')}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
