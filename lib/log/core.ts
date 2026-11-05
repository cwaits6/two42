// The one place a log line is built. supabase/functions/_shared/log.ts is a
// byte-for-byte copy, because edge functions cannot import from lib/; keep this
// file free of imports so the copy runs unchanged under Deno. What may and may
// not be written is specified in docs/security/logging.md.

export type LogLevel = "error" | "warn" | "info";

export type LogContext = {
  /** The page or API route pattern, or an edge function's name. Never a real address. */
  route?: string;
  /** A fixed lower_snake_case label for the stage that failed, such as a table name. */
  step?: string;
  /** Row ids and counts. Any value that is not a UUID or a finite number is dropped. */
  ids?: Record<string, unknown>;
};

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REFERENCE_LENGTH = 8;

const CODE = /^[A-Za-z0-9_.-]{1,40}$/;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const ROUTE_PATTERN = /^\/[A-Za-z0-9_\-/[\].]{0,119}$/;
const FUNCTION_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const STEP = /^[a-z]+(_[a-z0-9]+)*$/;
const ID_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WHAT = 200;
const MAX_STEP = 40;

/** A short random value a person can read back, with no look-alike characters. */
export function newReference(): string {
  // 32 symbols divide 256 evenly, so the low five bits of a byte are unbiased.
  const bytes = crypto.getRandomValues(new Uint8Array(REFERENCE_LENGTH));
  let reference = "";
  for (const byte of bytes) reference += REFERENCE_ALPHABET[byte & 31];
  return reference;
}

function field(error: object, key: string): unknown {
  return (error as Record<string, unknown>)[key];
}

/**
 * The only thing read from an error. A message, details, hint or stack can
 * quote the row being written, so none of them is ever consulted.
 */
export function errorCode(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error !== "object") return typeof error;

  const code = field(error, "code");
  if (typeof code === "string" && CODE.test(code)) return code;
  // The database client reports a request that got no response with an empty code.
  if (code === "") return "empty";
  if (typeof code === "number" && Number.isInteger(code)) return String(code);

  for (const key of ["status", "statusCode"]) {
    const status = field(error, key);
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
      return String(status);
    }
  }

  const name = field(error, "name");
  if (typeof name === "string" && ERROR_NAME.test(name)) return name;

  return "unknown";
}

function safeIds(ids: Record<string, unknown> | undefined): Record<string, string | number> | undefined {
  if (!ids) return undefined;
  const kept: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(ids)) {
    if (!ID_KEY.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) kept[key] = value;
    else if (typeof value === "string" && UUID.test(value)) kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** One JSON object on one line. Fields that are absent or fail their shape are left out. */
export function formatLine(
  level: LogLevel,
  what: string,
  error: unknown,
  context: LogContext | undefined,
  reference: string,
): string {
  const route = context?.route;
  const step = context?.step;
  return JSON.stringify({
    level,
    what: what.slice(0, MAX_WHAT),
    route: route && (ROUTE_PATTERN.test(route) || FUNCTION_NAME.test(route)) ? route : undefined,
    step: step && step.length <= MAX_STEP && STEP.test(step) ? step : undefined,
    code: errorCode(error),
    ref: reference,
    ids: safeIds(context?.ids),
  });
}

/** Writes the line to standard output, whatever the level, and returns its reference. */
export function writeLog(
  level: LogLevel,
  what: string,
  error?: unknown,
  context?: LogContext,
  reference: string = newReference(),
): string {
  console.log(formatLine(level, what, error, context, reference));
  return reference;
}

export function logError(what: string, error?: unknown, context?: LogContext): string {
  return writeLog("error", what, error, context);
}

export function logWarn(what: string, error?: unknown, context?: LogContext): string {
  return writeLog("warn", what, error, context);
}

export function logInfo(what: string, context?: LogContext): string {
  return writeLog("info", what, undefined, context);
}
