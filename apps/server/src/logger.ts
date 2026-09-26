type Level = 'debug' | 'info' | 'warn' | 'error' | 'trace';
export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const output = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  (level === 'error' ? console.error : console.log)(output);
}
function redact(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, '[database-url-redacted]');
}
export const frameworkLogger = Object.fromEntries(
  (['debug', 'info', 'warn', 'error', 'trace'] as const).map(level => [level, (...args: unknown[]) => log(level, 'colyseus', { message: args.map(redact).join(' ') })]),
) as Record<Level, (...args: unknown[]) => void>;
