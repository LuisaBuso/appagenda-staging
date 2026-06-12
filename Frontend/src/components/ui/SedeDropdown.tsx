import { useEffect, useRef, useState } from "react";
import { Globe, Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SedeOption {
  sede_id: string;
  nombre: string;
}

interface SedeDropdownProps {
  /** Currently selected sede_id, or "all"/"global" for the global option */
  value: string;
  /** Callback when a sede is selected */
  onChange: (sedeId: string) => void;
  /** Available sedes */
  options: SedeOption[];
  /** Value that represents "all sedes" — defaults to "all" */
  allValue?: string;
  /** Label for the "all sedes" option — defaults to "Vista Global" */
  allLabel?: string;
  /** Whether to show the "all sedes" option — defaults to false */
  showAll?: boolean;
  /** Whether the dropdown is disabled */
  disabled?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  /** Additional className for the wrapper */
  className?: string;
  /** Alignment of the dropdown panel */
  align?: "left" | "right";
}

export function SedeDropdown({
  value,
  onChange,
  options,
  allValue = "all",
  allLabel = "Vista Global",
  showAll = false,
  disabled = false,
  size = "sm",
  className,
  align = "right",
}: SedeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  const isAllSelected = value === allValue || value === "global" || value === "";
  const selectedSede = options.find((s) => s.sede_id === value);

  const displayLabel = showAll && isAllSelected
    ? allLabel
    : selectedSede?.nombre || options[0]?.nombre || "Sede";

  const handleSelect = (sedeId: string) => {
    onChange(sedeId);
    setIsOpen(false);
  };

  const isSm = size === "sm";

  return (
    <div className={cn("relative flex-shrink-0", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 rounded-md border border-gray-200 bg-white font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors",
          isSm ? "px-3 py-1.5 text-xs" : "px-3 py-[7px] text-sm",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        {showAll && isAllSelected ? (
          <Globe className={cn("text-gray-500 shrink-0", isSm ? "h-3.5 w-3.5" : "h-4 w-4")} />
        ) : (
          <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
        )}
        <span className="max-w-[160px] truncate">{displayLabel}</span>
        <ChevronDown
          className={cn(
            "text-gray-400 transition-transform",
            isSm ? "h-3 w-3" : "h-3.5 w-3.5",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div
          className={cn(
            "absolute top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white py-1 shadow-lg max-h-80 overflow-y-auto",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {showAll && (
            <>
              <button
                type="button"
                onClick={() => handleSelect(allValue)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Globe className="h-4 w-4 text-gray-500 shrink-0" />
                <span className="flex-1 text-left">{allLabel}</span>
                {isAllSelected && <Check className="h-4 w-4 text-gray-900" />}
              </button>
              <div className="my-1 border-t border-gray-100" />
            </>
          )}

          {options.map((sede) => (
            <button
              type="button"
              key={sede.sede_id}
              onClick={() => handleSelect(sede.sede_id)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="flex-1 truncate text-left">{sede.nombre}</span>
              {value === sede.sede_id && <Check className="h-4 w-4 text-gray-900 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
