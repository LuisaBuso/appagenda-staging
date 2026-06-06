"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { DayPicker, type DateRange as RdpDateRange } from "react-day-picker";
import { es } from "date-fns/locale";
import { format } from "date-fns";

export type PeriodoId = "hoy" | "7dias" | "mes" | "30dias" | "rango";

export interface PeriodoSelectorProps {
  periodoActivo: PeriodoId;
  onPeriodoChange: (periodo: PeriodoId, fechas?: { from: Date; to: Date }) => void;
  rangoAplicado?: { from: Date; to: Date };
  className?: string;
}

const OPCIONES: Array<{ id: PeriodoId; label: string }> = [
  { id: "hoy", label: "Hoy" },
  { id: "7dias", label: "7 días" },
  { id: "mes", label: "Mes actual" },
  { id: "30dias", label: "30 días" },
  { id: "rango", label: "Rango" },
];

const POPOVER_WIDTH = 290;
const POPOVER_HEIGHT = 400;
const MARGIN = 8;

interface PopoverCoords {
  top?: number;
  bottom?: number;
  left: number;
}

function computeCoords(triggerEl: HTMLElement): PopoverCoords {
  const rect = triggerEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal: alinear al borde derecho del trigger; ajustar si se sale
  let left = rect.right - POPOVER_WIDTH;
  if (left < MARGIN) left = MARGIN;
  if (left + POPOVER_WIDTH > vw - MARGIN) left = vw - MARGIN - POPOVER_WIDTH;

  // Vertical: abrir hacia abajo por defecto; subir si no cabe
  const spaceBelow = vh - rect.bottom - MARGIN;
  const spaceAbove = rect.top - MARGIN;

  if (spaceBelow >= POPOVER_HEIGHT || spaceBelow >= spaceAbove) {
    return { top: rect.bottom + MARGIN, left };
  }
  return { bottom: vh - rect.top + MARGIN, left };
}

export function PeriodoSelector({
  periodoActivo,
  onPeriodoChange,
  rangoAplicado,
  className,
}: PeriodoSelectorProps) {
  const [rangeOpen, setRangeOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<RdpDateRange | undefined>(undefined);
  const [coords, setCoords] = useState<PopoverCoords>({ left: 0, top: 0 });

  const rangeButtonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updateCoords = useCallback(() => {
    if (rangeButtonRef.current) {
      setCoords(computeCoords(rangeButtonRef.current));
    }
  }, []);

  const openPopover = () => {
    setDraftRange(
      rangoAplicado
        ? { from: rangoAplicado.from, to: rangoAplicado.to }
        : undefined
    );
    updateCoords();
    setRangeOpen((o) => !o);
  };

  // Cerrar al hacer clic afuera
  useEffect(() => {
    if (!rangeOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        rangeButtonRef.current && !rangeButtonRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setRangeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [rangeOpen]);

  // Cerrar con Escape + reposicionar con scroll/resize
  useEffect(() => {
    if (!rangeOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setRangeOpen(false); };
    const onReposition = () => updateCoords();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [rangeOpen, updateCoords]);

  const getRangeButtonLabel = () => {
    if (periodoActivo === "rango" && rangoAplicado) {
      return `${format(rangoAplicado.from, "dd/MM")} – ${format(rangoAplicado.to, "dd/MM")}`;
    }
    return "Rango";
  };

  const handleApply = () => {
    if (draftRange?.from && draftRange?.to) {
      // ✅ DEBUG: Verify selected dates are correct before applying
      console.log('=== PERIODO SELECTOR DEBUG ===');
      console.log('Selected start:', draftRange.from);
      console.log('Selected end:', draftRange.to);
      console.log('Start month (0-indexed):', draftRange.from.getMonth());
      console.log('End month (0-indexed):', draftRange.to.getMonth());

      onPeriodoChange("rango", { from: draftRange.from, to: draftRange.to });
      setRangeOpen(false);
    }
  };

  const handleCancel = () => {
    setDraftRange(
      rangoAplicado
        ? { from: rangoAplicado.from, to: rangoAplicado.to }
        : undefined
    );
    setRangeOpen(false);
  };

  const handleClearRange = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRangeOpen(false);
    onPeriodoChange("hoy");
  };

  const canApply = !!(draftRange?.from && draftRange?.to);

  const popoverPortal = rangeOpen
    ? ReactDOM.createPortal(
        <div
          ref={popoverRef}
          className="rdp-popover rdp-popover-portal"
          style={{
            position: "fixed",
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
            width: POPOVER_WIDTH,
            maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
          }}
        >
          {/* Instrucción de selección */}
          <p className="rdp-popover-hint">
            {!draftRange?.from
              ? "Selecciona el día de inicio"
              : !draftRange?.to
              ? "Ahora selecciona el día fin"
              : `${format(draftRange.from, "dd/MM/yyyy")} → ${format(draftRange.to, "dd/MM/yyyy")}`}
          </p>

          <DayPicker
            mode="range"
            numberOfMonths={1}
            selected={draftRange}
            onSelect={setDraftRange}
            locale={es}
            captionLayout="dropdown"
            startMonth={new Date(2020, 0)}
            endMonth={new Date(new Date().getFullYear() + 1, 11)}
            disabled={{ after: new Date() }}
          />

          {/* Acciones */}
          <div className="rdp-popover-actions">
            <button
              onClick={handleApply}
              disabled={!canApply}
              className={`rdp-popover-btn rdp-popover-btn-primary ${!canApply ? "rdp-popover-btn-disabled" : ""}`}
            >
              Aplicar
            </button>
            <button
              onClick={() => setDraftRange(undefined)}
              className="rdp-popover-btn rdp-popover-btn-secondary"
            >
              Limpiar
            </button>
            <button
              onClick={handleCancel}
              className="rdp-popover-btn rdp-popover-btn-secondary"
            >
              Cancelar
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className ?? ""}`}>
      <span className="text-xs text-slate-500 font-medium">Período:</span>

      {OPCIONES.map((option) =>
        option.id === "rango" ? (
          <div key="rango" className="relative flex items-center">
            <button
              ref={rangeButtonRef}
              onClick={openPopover}
              className={`px-3.5 py-1.5 border rounded-full text-[11px] font-medium transition-colors ${
                periodoActivo === "rango"
                  ? "bg-slate-800 text-white border-slate-800"
                  : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {getRangeButtonLabel()}
            </button>
            {periodoActivo === "rango" && rangoAplicado && (
              <button
                onClick={handleClearRange}
                title="Limpiar rango"
                className="ml-1 w-4 h-4 flex items-center justify-center rounded-full bg-slate-300 hover:bg-slate-500 hover:text-white text-slate-600 text-[10px] font-bold leading-none transition-colors"
              >
                ×
              </button>
            )}
          </div>
        ) : (
          <button
            key={option.id}
            onClick={() => onPeriodoChange(option.id)}
            className={`px-3.5 py-1.5 border rounded-full text-[11px] font-medium transition-colors ${
              periodoActivo === option.id
                ? "bg-slate-800 text-white border-slate-800"
                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            {option.label}
          </button>
        )
      )}

      {popoverPortal}
    </div>
  );
}
