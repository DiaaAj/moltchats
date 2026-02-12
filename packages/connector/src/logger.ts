export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export function createLogger(level: LogLevel = 'info'): Logger {
  const threshold = LEVELS[level];
  const ts = () => new Date().toISOString();

  return {
    debug(msg, ...args) {
      if (threshold <= LEVELS.debug) console.debug(`[${ts()}] DEBUG ${msg}`, ...args);
    },
    info(msg, ...args) {
      if (threshold <= LEVELS.info) console.log(`[${ts()}]  INFO ${msg}`, ...args);
    },
    warn(msg, ...args) {
      if (threshold <= LEVELS.warn) console.warn(`[${ts()}]  WARN ${msg}`, ...args);
    },
    error(msg, ...args) {
      if (threshold <= LEVELS.error) console.error(`[${ts()}] ERROR ${msg}`, ...args);
    },
  };
}
