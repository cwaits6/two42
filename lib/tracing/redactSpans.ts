import { SpanKind, type Attributes } from "@opentelemetry/api";
import type { tracing } from "@opentelemetry/sdk-node";
import { pagePattern } from "@/lib/analytics/pagePattern";

type ReadableSpan = tracing.ReadableSpan;
type SpanExporter = tracing.SpanExporter;

// An allow-list, so an attribute an upgraded instrumentation starts writing is
// dropped until someone decides it holds nothing a person entered. What each
// kept key holds is listed in docs/security/logging.md.
const KEPT_ATTRIBUTES = new Set([
  "next.span_category",
  "next.span_type",
  "next.route",
  "next.page",
  "next.segment",
  "next.rsc",
  "next.bubble",
  "next.clientComponentLoadCount",
  "next.fetch.idx",
  "next.fetch.cache_status",
  "next.fetch.cache_reason",
  "http.route",
  "http.method",
  "http.request.method",
  "http.status_code",
  "http.response.status_code",
  "url.scheme",
  "network.protocol.version",
  "error.type",
  "exception.type",
  "db.system",
  "db.system.name",
  "db.operation",
  "db.operation.name",
  "db.collection.name",
  "db.sql.table",
]);

// On an incoming request these name the client and the real path, so they
// are kept only on a span for a request the server made.
const KEPT_OUTGOING_ATTRIBUTES = new Set(["server.address", "server.port", "net.peer.name", "net.peer.port"]);

// A PostgREST table or function path names the database operation and holds
// no values: filters travel in the query string, which is never kept.
const DATABASE_OPERATION_PATH = /^\/rest\/v1\/(?:rpc\/)?[A-Za-z_][A-Za-z0-9_]*$/;

function keep(attributes: Attributes | undefined, outgoing = false): Attributes {
  const kept: Attributes = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (KEPT_ATTRIBUTES.has(key) || (outgoing && KEPT_OUTGOING_ATTRIBUTES.has(key))) kept[key] = value;
  }
  const path = attributes?.["url.path"];
  if (outgoing && typeof path === "string" && DATABASE_OPERATION_PATH.test(path)) kept["url.path"] = path;
  return kept;
}

/** An address cut to its origin, plus its path only when that path names a database operation. */
export function redactAddress(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "[address]";
  }
  return url.origin + (DATABASE_OPERATION_PATH.test(url.pathname) ? url.pathname : "");
}

// A path is safe to name only when it is a route pattern: it has a dynamic
// segment, or it is a page with none. Any other path can be a real address
// holding a token or an id.
function isRoutePattern(path: string, route: string | undefined): boolean {
  return path === route || /\/\[[^/\]]+\](?=\/|$)/.test(path) || pagePattern(path) === path;
}

/**
 * The framework names a fetch span after its full address and can name a
 * request span after its real path; the name keeps only what redactAddress
 * keeps, and a path that is not a route pattern becomes the span's route.
 */
export function redactSpanName(name: string, route?: string): string {
  return name
    .replace(/\S+:\/\/\S*/g, redactAddress)
    .replace(/[?#].*$/, "")
    .replace(/(^|\s)(\/\S*)/g, (_, lead: string, path: string) =>
      lead + (isRoutePattern(path, route) ? path : (route ?? "[path]")),
    );
}

function routeOf(attributes: Attributes | undefined): string | undefined {
  const route = attributes?.["next.route"] ?? attributes?.["http.route"];
  return typeof route === "string" ? route : undefined;
}

export function redactSpan(span: ReadableSpan): ReadableSpan {
  return {
    name: redactSpanName(span.name, routeOf(span.attributes)),
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    duration: span.duration,
    ended: span.ended,
    status: { code: span.status.code },
    attributes: keep(span.attributes, span.kind === SpanKind.CLIENT),
    links: span.links.map((link) => ({ ...link, attributes: keep(link.attributes) })),
    events: span.events.map((event) => ({ ...event, attributes: keep(event.attributes) })),
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

/** Wraps the exporter so every span is redacted before it leaves the process. */
export function redactingExporter(next: SpanExporter): SpanExporter {
  return {
    export: (spans, done) => next.export(spans.map(redactSpan), done),
    shutdown: () => next.shutdown(),
    forceFlush: () => next.forceFlush?.() ?? Promise.resolve(),
  };
}
