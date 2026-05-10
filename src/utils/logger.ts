const isDev = process.env.NODE_ENV !== 'production';
type Level = 'info' | 'warn' | 'error';

function log(level: Level, message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  if (isDev) {
    const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[36m';
    const reset = '\x1b[0m';
    const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
    console[level === 'info' ? 'log' : level](`${color}[${ts}] [${level.toUpperCase()}]${reset} ${message}${metaStr}`);
  } else {
    console.log(JSON.stringify({ ts, level, message, ...meta }));
  }
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
