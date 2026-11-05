import { cache } from "react";
import { newReference, writeLog, type LogContext, type LogLevel } from "./core";

export { stepOf, type LogContext } from "./core";

const slot = cache(() => ({ reference: null as string | null }));

/**
 * The reference holder for the server render in progress, or null outside one.
 * React memoizes cache() only while rendering server components, so two calls
 * returning the same object is how a render is recognised.
 */
function requestSlot() {
  const first = slot();
  return first === slot() ? first : null;
}

/** The reference of the lines logged so far in this server render, for the failed state to show. */
export function requestReference(): string | null {
  return requestSlot()?.reference ?? null;
}

function write(level: LogLevel, what: string, error: unknown, context: LogContext | undefined): string {
  const request = requestSlot();
  const reference = request ? (request.reference ??= newReference()) : newReference();
  return writeLog(level, what, error, context, reference);
}

/** Logs a failure and returns the reference written with it. See docs/security/logging.md. */
export function logError(what: string, error?: unknown, context?: LogContext): string {
  return write("error", what, error, context);
}

export function logWarn(what: string, error?: unknown, context?: LogContext): string {
  return write("warn", what, error, context);
}

export function logInfo(what: string, context?: LogContext): string {
  return write("info", what, undefined, context);
}
