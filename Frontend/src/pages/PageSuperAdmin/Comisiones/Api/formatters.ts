// src/utils/formatters.ts
import { formatCurrencyNoDecimals, getStoredCurrency } from "../../../../lib/currency";

export const formatMoneda = (monto: number, moneda: string = getStoredCurrency("USD")): string => {
  return formatCurrencyNoDecimals(monto, moneda);
};
