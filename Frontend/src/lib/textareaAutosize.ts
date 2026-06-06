import type React from "react";

/**
 * Auto-ajusta la altura de un textarea según su contenido.
 * Úsalo en onInput/onChange: onInput={handleTextareaAutoResize}
 */
export const handleTextareaAutoResize = (
  event: React.FormEvent<HTMLTextAreaElement>,
  minHeight: number = 140
) => {
  const el = event.currentTarget;
  if (!el) return;
  el.style.height = "auto";
  const next = Math.max(el.scrollHeight, minHeight);
  el.style.height = `${next}px`;
};

/**
 * Helper para ajustar un textarea referenciado (por ejemplo, al hidratar datos).
 */
export const autoResizeTextarea = (el: HTMLTextAreaElement | null, minHeight: number = 140) => {
  if (!el) return;
  el.style.height = "auto";
  const next = Math.max(el.scrollHeight, minHeight);
  el.style.height = `${next}px`;
};
