// src/components/fichas/FichaSelector.tsx
"use client";

import { useState } from "react";
import { Cita } from '../../../../types/fichas';
import { FichaDiagnosticoRizotipo } from './FichaDiagnosticoRizotipo';
import { FichaColor } from './FichaColor';
import { FichaAsesoriaCorte } from './FichaAsesoriaCorte';
import { FichaCuidadoPostColor } from './FichaCuidadoPostColor';
import { FichaValoracionPruebaColor } from './FichaValoracionPruebaColor';
import { FichaOzonoterapiaCapilar } from './FichaOzonoterapiaCapilar';

interface FichaSelectorProps {
  citas: Cita[];
}

type TipoFicha = 
  | "DIAGNOSTICO_RIZOTIPO" 
  | "COLOR" 
  | "ASESORIA_CORTE" 
  | "CUIDADO_POST_COLOR" 
  | "VALORACION_PRUEBA_COLOR"
  | "OZONOTERAPIA_CAPILAR";

export function FichaSelector({ citas }: FichaSelectorProps) {
  const [citaSeleccionada, setCitaSeleccionada] = useState<Cita | null>(null);
  const [tipoFicha, setTipoFicha] = useState<TipoFicha>("DIAGNOSTICO_RIZOTIPO");

  const renderFicha = () => {
    if (!citaSeleccionada) return null;

    const props = {
      cita: citaSeleccionada,
      onSubmit: (data: any) => console.log('Datos de ficha:', data)
    };

    switch (tipoFicha) {
      case "DIAGNOSTICO_RIZOTIPO":
        return <FichaDiagnosticoRizotipo {...props} />;
      case "COLOR":
        return <FichaColor {...props} />;
      case "ASESORIA_CORTE":
        return <FichaAsesoriaCorte {...props} />;
      case "CUIDADO_POST_COLOR":
        return <FichaCuidadoPostColor {...props} />;
      case "VALORACION_PRUEBA_COLOR":
        return <FichaValoracionPruebaColor {...props} />;
      case "OZONOTERAPIA_CAPILAR":
        return <FichaOzonoterapiaCapilar {...props} />;
      default:
        return null;
    }
  };

  // Calendario bonito cuando no hay cita seleccionada
  const renderCalendario = () => (
    <div className="rounded-lg border bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">Protocolo de atención</h3>
      
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-[oklch(0.55_0.25_280)] rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h4 className="text-lg font-semibold text-gray-900 mb-2">Selecciona una cita</h4>
        <p className="text-gray-600 mb-4">
          Elige una cita de la lista para comenzar con el protocolo de atención
        </p>
        
        {/* Mini calendario decorativo */}
        <div className="max-w-xs mx-auto bg-gray-50 rounded-lg p-4 border">
          <div className="flex justify-between items-center mb-3">
            <button className="p-1 hover:bg-gray-200 rounded">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="font-semibold">Noviembre 2024</span>
            <button className="p-1 hover:bg-gray-200 rounded">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          
          <div className="grid grid-cols-7 gap-1 text-xs">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(dia => (
              <div key={dia} className="text-center text-gray-500 font-medium py-1">
                {dia}
              </div>
            ))}
            
            {Array.from({ length: 30 }, (_, i) => i + 1).map(dia => (
              <div
                key={dia}
                className={`text-center py-1 rounded ${
                  dia === new Date().getDate() 
                    ? 'bg-[oklch(0.55_0.25_280)] text-white' 
                    : 'hover:bg-gray-200'
                }`}
              >
                {dia}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Selector de cita */}
      <div className="rounded-lg border bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">Seleccionar cita para ficha</h3>
        <select 
          className="w-full p-2 border rounded-lg"
          onChange={(e) => setCitaSeleccionada(citas.find(c => c.cita_id === e.target.value) || null)}
        >
          <option value="">Selecciona una cita</option>
          {citas.map(cita => (
            <option key={cita.cita_id} value={cita.cita_id}>
              {cita.cliente.nombre} - {cita.servicios?.map((s: any) => s.nombre).join(', ') || 'Sin servicio'} - {cita.fecha}
            </option>
          ))}
        </select>
      </div>

      {/* Selector de tipo de ficha - Solo mostrar cuando hay cita seleccionada */}
      {citaSeleccionada && (
        <div className="rounded-lg border bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold">Tipo de ficha</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              { value: "DIAGNOSTICO_RIZOTIPO", label: "Diagnóstico Rizotipo" },
              { value: "COLOR", label: "Color" },
              { value: "ASESORIA_CORTE", label: "Asesoría Corte" },
              { value: "CUIDADO_POST_COLOR", label: "Cuidado Post Color" },
              { value: "VALORACION_PRUEBA_COLOR", label: "Valoración Color" },
              { value: "OZONOTERAPIA_CAPILAR", label: "Ozonoterapia Capilar" },
            ].map((tipo) => (
              <button
                key={tipo.value}
                className={`p-3 rounded-lg border text-sm ${
                  tipoFicha === tipo.value 
                    ? 'bg-[oklch(0.55_0.25_280)] text-white' 
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => setTipoFicha(tipo.value as TipoFicha)}
              >
                {tipo.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mostrar calendario cuando no hay cita seleccionada, ficha cuando sí */}
      {citaSeleccionada ? renderFicha() : renderCalendario()}
    </div>
  );
}