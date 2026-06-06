import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { DayPicker, type DateRange } from 'react-day-picker';
import { es } from 'date-fns/locale';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { parseLocalDate, formatLocalDate } from '../../lib/dateFormat';


function parseYMD(str?: string): Date | undefined {
  if (!str) return undefined;
  return parseLocalDate(str) ?? undefined;
}

function toYMD(d: Date): string {
  return formatLocalDate(d);
}

function displayDate(str?: string): string {
  const d = parseYMD(str);
  return d ? format(d, 'dd/MM/yyyy') : (str ?? '');
}

interface PopoverStyle {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

interface BaseProps {
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  min?: string;
  max?: string;
  'aria-label'?: string;
  popoverPosition?: 'down' | 'up';
  fromYear?: number;
  toYear?: number;
}

export interface SingleDatePickerProps extends BaseProps {
  mode?: 'single';
  value?: string;
  onChange?: (value: string) => void;
}

export interface RangeDatePickerProps extends BaseProps {
  mode: 'range';
  value?: { from?: string; to?: string };
  onChange?: (value: { from?: string; to?: string }) => void;
}

export interface MultipleDatePickerProps extends BaseProps {
  mode: 'multiple';
  value?: string[];
  onChange?: (value: string[]) => void;
}

export type DatePickerProps =
  | SingleDatePickerProps
  | RangeDatePickerProps
  | MultipleDatePickerProps;

const POPOVER_WIDTH = 300;
const POPOVER_HEIGHT = 340;
const MARGIN = 8;

function computePopoverStyle(triggerEl: HTMLElement): PopoverStyle {
  const rect = triggerEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal: prefer aligning to right edge of trigger; flip to left if it overflows
  let left: number | undefined;
  const rightAligned = rect.right - POPOVER_WIDTH;
  if (rightAligned >= MARGIN) {
    left = rightAligned;
  } else {
    left = Math.max(MARGIN, rect.left);
  }
  // Clamp so it never goes off the right edge
  if (left + POPOVER_WIDTH > vw - MARGIN) {
    left = vw - MARGIN - POPOVER_WIDTH;
  }

  // Vertical: prefer below; flip above if not enough space
  const spaceBelow = vh - rect.bottom - MARGIN;
  const spaceAbove = rect.top - MARGIN;
  let top: number | undefined;
  let bottom: number | undefined;

  if (spaceBelow >= POPOVER_HEIGHT || spaceBelow >= spaceAbove) {
    top = rect.bottom + MARGIN;
  } else {
    bottom = vh - rect.top + MARGIN;
  }

  return { left, top, bottom };
}

export function DatePicker(props: DatePickerProps) {
  const { disabled, placeholder = 'Seleccionar fecha', className, min, max, fromYear, toYear } = props;
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<PopoverStyle>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      setPopoverStyle(computePopoverStyle(triggerRef.current));
    }
  }, []);

  const handleOpen = () => {
    updatePosition();
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, updatePosition]);

  const disabledMatchers: object[] = [];
  const minDate = parseYMD(min);
  const maxDate = parseYMD(max);
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

  let triggerText = placeholder;
  if (props.mode === 'range') {
    const v = props.value;
    if (v?.from || v?.to) {
      triggerText = [v.from && displayDate(v.from), v.to && displayDate(v.to)]
        .filter(Boolean)
        .join(' — ');
    }
  } else if (props.mode === 'multiple') {
    const v = props.value;
    if (v && v.length > 0) triggerText = `${v.length} fecha${v.length > 1 ? 's' : ''}`;
  } else {
    const v = (props as SingleDatePickerProps).value;
    if (v) triggerText = displayDate(v);
  }

  const thisYear = new Date().getFullYear();
  const commonPickerProps = {
    locale: es,
    captionLayout: 'dropdown' as const,
    startMonth: new Date(fromYear ?? 2020, 0),
    endMonth: new Date(toYear ?? thisYear + 2, 11),
    ...(disabledMatchers.length > 0 && { disabled: disabledMatchers as Parameters<typeof DayPicker>[0]['disabled'] }),
  };

  let pickerNode: React.ReactNode;

  if (props.mode === 'range') {
    const v = props.value;
    const selected: DateRange = { from: parseYMD(v?.from), to: parseYMD(v?.to) };
    pickerNode = (
      <DayPicker
        {...commonPickerProps}
        mode="range"
        selected={selected}
        onSelect={(range) =>
          props.onChange?.({
            from: range?.from ? toYMD(range.from) : undefined,
            to: range?.to ? toYMD(range.to) : undefined,
          })
        }
      />
    );
  } else if (props.mode === 'multiple') {
    const selected = (props.value ?? []).map(parseYMD).filter((d): d is Date => d !== undefined);
    pickerNode = (
      <DayPicker
        {...commonPickerProps}
        mode="multiple"
        selected={selected}
        onSelect={(dates) => props.onChange?.((dates ?? []).map(toYMD))}
      />
    );
  } else {
    const singleProps = props as SingleDatePickerProps;
    pickerNode = (
      <DayPicker
        {...commonPickerProps}
        mode="single"
        selected={parseYMD(singleProps.value)}
        onSelect={(date) => {
          singleProps.onChange?.(date ? toYMD(date) : '');
          setOpen(false);
        }}
      />
    );
  }

  const popoverPortal = open
    ? ReactDOM.createPortal(
        <div
          ref={popoverRef}
          className="datepicker-popover datepicker-popover-portal"
          style={{
            position: 'fixed',
            top: popoverStyle.top,
            bottom: popoverStyle.bottom,
            left: popoverStyle.left,
            right: popoverStyle.right,
          }}
          role="dialog"
          aria-label="Calendario"
        >
          {pickerNode}
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`relative w-full ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={props['aria-label'] ?? placeholder}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={handleOpen}
        className={[
          'datepicker-trigger w-full flex items-center gap-2 px-3 py-2',
          'border border-gray-300 rounded text-sm bg-white text-left',
          'hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          triggerText === placeholder ? 'text-gray-400' : 'text-gray-900',
        ].join(' ')}
      >
        <CalendarIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
        <span className="flex-1 truncate">{triggerText}</span>
      </button>

      {popoverPortal}
    </div>
  );
}

export default DatePicker;
