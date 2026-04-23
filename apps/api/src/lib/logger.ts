/**
 * Structured logger for the API.
 *
 * Uses pino when available; falls back to a thin console shim so the app still
 * boots without the dependency in dev/test environments that haven't run `pnpm
 * install` yet.  Production Docker builds will always have pino installed.
 */

interface Logger {
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
  debug(obj: Record<string, unknown> | string, msg?: string): void;
  child(ctx: Record<string, unknown>): Logger;
}

function makeConsoleLogger(ctx: Record<string, unknown> = {}): Logger {
  const prefix = Object.keys(ctx).length
    ? `[${Object.entries(ctx)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}] `
    : '';

  const fmt = (obj: Record<string, unknown> | string, msg?: string): string => {
    if (typeof obj === 'string') return prefix + obj;
    return prefix + (msg ?? '') + ' ' + JSON.stringify(obj);
  };

  return {
    info: (obj, msg) => console.log(fmt(obj, msg)),
    warn: (obj, msg) => console.warn(fmt(obj, msg)),
    error: (obj, msg) => console.error(fmt(obj, msg)),
    debug: (obj, msg) => {
      if (process.env['LOG_LEVEL'] === 'debug') console.debug(fmt(obj, msg));
    },
    child: (childCtx) => makeConsoleLogger({ ...ctx, ...childCtx }),
  };
}

let _logger: Logger;

try {
  // Dynamic import so the module resolves at runtime; avoids a hard build
  // dependency on pino for packages that don't need it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const pino = require('pino') as (opts: unknown) => {
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
    debug(obj: unknown, msg?: string): void;
    child(ctx: Record<string, unknown>): unknown;
  };
  const pinoLogger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

  function wrapPino(p: typeof pinoLogger): Logger {
    return {
      info: (obj, msg) => (typeof obj === 'string' ? p.info({}, obj) : p.info(obj, msg)),
      warn: (obj, msg) => (typeof obj === 'string' ? p.warn({}, obj) : p.warn(obj, msg)),
      error: (obj, msg) => (typeof obj === 'string' ? p.error({}, obj) : p.error(obj, msg)),
      debug: (obj, msg) => (typeof obj === 'string' ? p.debug({}, obj) : p.debug(obj, msg)),
      child: (ctx) => wrapPino(p.child(ctx) as typeof pinoLogger),
    };
  }

  _logger = wrapPino(pinoLogger);
} catch {
  _logger = makeConsoleLogger();
}

export const logger: Logger = _logger;

export function childLogger(ctx: {
  arenaId?: string;
  agentId?: string;
  handId?: string;
  workerId?: string;
}): Logger {
  return logger.child(ctx as Record<string, unknown>);
}
