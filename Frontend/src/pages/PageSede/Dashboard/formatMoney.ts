import { formatCurrencyNoDecimals, getStoredCurrency, resolveCurrencyLocale } from "../../../lib/currency";

// src/utils/formatMoney.ts
export function formatMoney(
  amount: number | string,
  currency: string = getStoredCurrency("USD"),
  locale: string = 'es-CO'
): string {
  // Convertir a número si es string
  let numAmount: number;
  
  if (typeof amount === 'string') {
    // Remover cualquier caracter no numérico excepto punto y coma
    const cleaned = amount.replace(/[^0-9.,-]+/g, '');
    // Reemplazar coma por punto para decimales
    const normalized = cleaned.replace(',', '.');
    numAmount = parseFloat(normalized) || 0;
  } else {
    numAmount = amount;
  }
  
  const resolvedLocale = locale || resolveCurrencyLocale(currency, "es-CO");
  return formatCurrencyNoDecimals(numAmount, currency, resolvedLocale);
}

// Función para extraer solo el valor numérico de un string con moneda
export function extractNumericValue(currencyString: string): number {
  if (!currencyString) return 0;
  
  // Remover símbolos de moneda, espacios y caracteres no numéricos
  const cleaned = currencyString.replace(/[^0-9.,-]+/g, '');
  const normalized = cleaned.replace(',', '.');
  return parseFloat(normalized) || 0;
}
