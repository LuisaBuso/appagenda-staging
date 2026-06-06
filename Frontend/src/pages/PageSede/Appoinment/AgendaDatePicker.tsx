import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

interface Props {
  selectedDate: Date;
  today: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
}

export const AgendaDatePicker: React.FC<Props> = ({
  selectedDate,
  today,
  onSelect,
  onClose,
}) => {
  const [mesVisible, setMesVisible] = useState(
    new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
  );
  const [fechaTentativa, setFechaTentativa] = useState(
    new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    // slight delay so the click that opened the picker doesn't immediately close it
    const t = setTimeout(() => document.addEventListener("mousedown", handleClickOutside), 0);
    return () => {
      document.removeEventListener("keydown", handleKey);
      clearTimeout(t);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  const year = mesVisible.getFullYear();
  const month = mesVisible.getMonth();

  const prevMonth = () => setMesVisible(new Date(year, month - 1, 1));
  const nextMonth = () => setMesVisible(new Date(year, month + 1, 1));

  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Dom
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const handleOK = () => {
    onSelect(fechaTentativa);
    onClose();
  };

  const handleLimpiar = () => {
    onSelect(today);
    onClose();
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        padding: "16px 14px 12px",
        zIndex: 1000,
        width: 272,
        userSelect: "none",
      }}
    >
      {/* Header mes/año */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <button
          onClick={prevMonth}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#111827",
            padding: "4px 6px",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: "#111827",
            textTransform: "capitalize",
          }}
        >
          {MESES_ES[month]} {year}
        </span>
        <button
          onClick={nextMonth}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#111827",
            padding: "4px 6px",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Cabecera días */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          textAlign: "center",
          marginBottom: 4,
        }}
      >
        {["D", "L", "M", "M", "J", "V", "S"].map((d, i) => (
          <div
            key={i}
            style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8", padding: "2px 0" }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Grilla de días */}
      {rows.map((row, ri) => (
        <div
          key={ri}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            textAlign: "center",
            marginBottom: 2,
          }}
        >
          {row.map((day, ci) => {
            if (day === null) return <div key={ci} style={{ width: 36, height: 36 }} />;

            const thisDate = new Date(year, month, day);
            const isTentative = sameDay(thisDate, fechaTentativa);
            const isToday = sameDay(thisDate, today);

            return (
              <button
                key={ci}
                onClick={() =>
                  setFechaTentativa(new Date(year, month, day))
                }
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: isTentative ? 700 : 400,
                  background: isTentative
                    ? "#111827"
                    : isToday
                    ? "#F1F5F9"
                    : "none",
                  color: isTentative ? "#fff" : isToday ? "#111827" : "#334155",
                  margin: "0 auto",
                }}
              >
                {day}
              </button>
            );
          })}
        </div>
      ))}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 12,
          borderTop: "1px solid #F1F5F9",
          paddingTop: 10,
        }}
      >
        <button
          onClick={handleLimpiar}
          style={{
            padding: "6px 14px",
            fontSize: 11,
            fontWeight: 700,
            color: "#64748B",
            background: "none",
            border: "1px solid #E2E8F0",
            borderRadius: 6,
            cursor: "pointer",
            letterSpacing: "0.04em",
          }}
        >
          LIMPIAR
        </button>
        <button
          onClick={handleOK}
          style={{
            padding: "6px 18px",
            fontSize: 11,
            fontWeight: 700,
            color: "#fff",
            background: "#111827",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            letterSpacing: "0.04em",
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
};
