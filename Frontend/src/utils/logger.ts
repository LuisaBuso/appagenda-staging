const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args: unknown[]) => { if (isDev) console.log(...args); },
  info: (...args: unknown[]) => { if (isDev) console.info(...args); },
  warn: (...args: unknown[]) => { if (isDev) console.warn(...args); },
  debug: (...args: unknown[]) => { if (isDev) console.debug(...args); },
  error: (...args: unknown[]) => { console.error(...args); },
};
