import React, { useEffect } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({ open, onClose, title, children }) => {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Limita la altura del contenedor para que nunca sobrepase la pantalla
  // (evita que el header quede fuera de vista y que el scroll se bloquee en iOS).
  const sheetMaxHeight = "calc(100dvh - 1rem)";
  const contentMaxHeight = "calc(100dvh - 6.5rem)"; // header + handle + margen inferior aproximado

  return (
    <div className="fixed inset-0 z-[90] overflow-hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
        aria-label="Cerrar"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || "Detalle"}
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[480px] overflow-hidden rounded-t-3xl bg-white shadow-2xl"
        style={{ maxHeight: sheetMaxHeight }}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-gray-300" />

        <div className="flex items-center justify-between border-b border-gray-200 px-4 pb-3 pt-2">
          <h2 className="text-base font-semibold text-gray-900">{title || "Detalle"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl px-3 text-sm font-medium text-gray-700 active:scale-[0.98]"
          >
            Cerrar
          </button>
        </div>

        <div
          data-bottom-sheet-scroll
          className="overflow-y-auto overscroll-contain touch-pan-y px-2 pb-[max(env(safe-area-inset-bottom),1rem)]"
          style={{ maxHeight: contentMaxHeight, WebkitOverflowScrolling: "touch" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export default BottomSheet;
