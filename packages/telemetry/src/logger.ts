import pino from 'pino';
// Generated at build time by @hris/codegen from the Zod classification
// registry. Every confidential and special-category field path lands here,
// so a logged entity is masked even when someone forgets.
import { redactionPaths } from './generated/redaction.js';

/**
 * The tracer publishes the active span on `globalThis` so that logging does not
 * have to import the OTel SDK — a hard requirement here, because importing it
 * from the logger would make every package that logs depend on the tracing
 * stack. Declared rather than reached for untyped.
 */
declare global {
  /*
   * The leading underscores are the point, not an accident. This is a global
   * the OpenTelemetry bootstrap installs, and the name is the contract between
   * that bootstrap and this logger; the `__` prefix is the convention that
   * marks a global as injected rather than authored. Renaming it here would
   * simply stop the logger finding the span.
   */
  // oxlint-disable-next-line no-underscore-dangle
  var __otelActiveSpan: (() => { traceId: string; spanId: string } | undefined) | undefined;
}

function activeSpan(): { traceId: string; spanId: string } | undefined {
  // oxlint-disable-next-line no-underscore-dangle
  return globalThis.__otelActiveSpan?.();
}

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: { paths: [...redactionPaths], censor: '[redacted]' },
  formatters: {
    log(object) {
      // Correlate logs with traces without every call site remembering to.
      const span = activeSpan();
      return span ? { ...object, traceId: span.traceId, spanId: span.spanId } : object;
    },
  },
});

export type Logger = typeof logger;
