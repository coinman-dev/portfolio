export type DiagLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Writes to the app's diagnostic log (Settings → Debug mode) through the
 * DebugLog object that index.js puts on window. A no-op while debug mode is
 * off, or when the bundle runs outside the app.
 */
export function diag(level: DiagLevel, category: string, message: string, data?: unknown): void {
  const log = (window as any).DebugLog;
  if (log && typeof log.write === 'function') {
    log.write(level, category, message, data);
  }
}
