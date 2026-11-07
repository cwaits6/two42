// The attribute shapes below are the ones the framework and the installed
// instrumentations wrote to a local collector for a page view and a failed
// database read.

import { describe, expect, it, vi } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import type { tracing } from "@opentelemetry/sdk-node";
import { redactAddress, redactingExporter, redactSpan, redactSpanName } from "./redactSpans";

type ReadableSpan = tracing.ReadableSpan;

const READ = "http://127.0.0.1:54321/rest/v1/profiles?select=id&email=eq.someone%40example.test";
const MESSAGE = "lookup failed for someone@example.test: column profiles.no_such_column does not exist";

function span(overrides: Partial<ReadableSpan>): ReadableSpan {
  return {
    name: "GET",
    kind: SpanKind.SERVER,
    spanContext: () => ({ traceId: "t".repeat(32), spanId: "s".repeat(16), traceFlags: 1 }),
    startTime: [1, 0],
    endTime: [1, 5],
    duration: [0, 5],
    ended: true,
    status: { code: 0 },
    attributes: {},
    links: [],
    events: [],
    resource: {} as ReadableSpan["resource"],
    instrumentationScope: { name: "test" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  };
}

const SECRETS = ["someone", "example.test", "SECRETTOKEN", "who=", "ProbeAgent", "203.0.113.7", "no_such_column"];

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

describe("redactSpan", () => {
  it("keeps the route pattern and status of a page view and drops its real address", () => {
    const out = redactSpan(
      span({
        name: "GET /join/[token]",
        attributes: {
          "next.span_type": "BaseServer.handleRequest",
          "http.method": "GET",
          "http.target": "/join/SECRETTOKEN-1234?who=someone",
          "http.status_code": 200,
          "next.route": "/join/[token]",
          "http.route": "/join/[token]",
        },
      }),
    );

    expect(out.name).toBe("GET /join/[token]");
    expect(out.attributes).toEqual({
      "next.span_type": "BaseServer.handleRequest",
      "http.method": "GET",
      "http.status_code": 200,
      "next.route": "/join/[token]",
      "http.route": "/join/[token]",
    });
    expect(out.duration).toEqual([0, 5]);
  });

  it("drops the client address, user agent and real path of an incoming request", () => {
    const out = redactSpan(
      span({
        attributes: {
          "http.url": "http://localhost/join/SECRETTOKEN-1234?who=someone",
          "http.target": "/join/SECRETTOKEN-1234?who=someone",
          "url.full": "http://localhost/join/SECRETTOKEN-1234?who=someone",
          "url.path": "/rest/v1/profiles",
          "url.query": "who=someone",
          "http.user_agent": "ProbeAgent/1.0",
          "user_agent.original": "ProbeAgent/1.0",
          "http.client_ip": "203.0.113.7",
          "client.address": "203.0.113.7",
          "net.peer.ip": "203.0.113.7",
          "net.peer.port": 52114,
          "server.address": "203.0.113.7",
          "network.peer.address": "203.0.113.7",
          "http.request.body": "{\"name\":\"someone\"}",
          "http.status_code": 200,
        },
      }),
    );

    expect(out.attributes).toEqual({ "http.status_code": 200 });
  });

  it("keeps the database operation of a failed read and drops its values and the error's text", () => {
    const out = redactSpan(
      span({
        kind: SpanKind.CLIENT,
        name: `fetch GET ${READ}`,
        status: { code: 2, message: MESSAGE },
        attributes: {
          "next.span_name": `fetch GET ${READ}`,
          "http.url": READ,
          "url.full": READ,
          "url.path": "/rest/v1/profiles",
          "url.query": "?select=id&email=eq.someone%40example.test",
          "http.method": "GET",
          "server.address": "127.0.0.1",
          "server.port": 54321,
          "http.status_code": 400,
          "error.type": "400",
        },
        events: [
          {
            name: "exception",
            time: [1, 4],
            attributes: { "exception.type": "Error", "exception.message": MESSAGE, "exception.stacktrace": `Error: ${MESSAGE}` },
          },
        ],
      }),
    );

    expect(out.name).toBe("fetch GET http://127.0.0.1:54321/rest/v1/profiles");
    expect(out.status).toEqual({ code: 2 });
    expect(out.attributes).toEqual({
      "url.path": "/rest/v1/profiles",
      "http.method": "GET",
      "server.address": "127.0.0.1",
      "server.port": 54321,
      "http.status_code": 400,
      "error.type": "400",
    });
    expect(out.events).toEqual([{ name: "exception", time: [1, 4], attributes: { "exception.type": "Error" } }]);
    expectNoSecrets(out);
  });

  it("keeps the trace and span ids", () => {
    const source = span({});
    expect(redactSpan(source).spanContext()).toEqual(source.spanContext());
  });
});

describe("redactAddress", () => {
  it("keeps a database function's path and drops its query", () => {
    expect(redactAddress("http://127.0.0.1:54321/rest/v1/rpc/app_request_org_id?x=1")).toBe(
      "http://127.0.0.1:54321/rest/v1/rpc/app_request_org_id",
    );
  });

  it("drops any other path, which can hold a storage key or a token", () => {
    expect(redactAddress("http://127.0.0.1:54321/storage/v1/object/sign/avatars/org/person/photo.jpg")).toBe(
      "http://127.0.0.1:54321",
    );
  });

  it("writes a placeholder for text that is not an address", () => {
    expect(redactAddress("http://")).toBe("[address]");
  });
});

describe("redactSpanName", () => {
  it("leaves a name with no address alone", () => {
    expect(redactSpanName("render route (app) /g/[groupId]/calendar")).toBe("render route (app) /g/[groupId]/calendar");
  });

  it("drops a query written straight into a name", () => {
    expect(redactSpanName("GET /join/[token]?who=someone")).toBe("GET /join/[token]");
  });

  it("names a real path by the span's route, so a token in it never leaves", () => {
    expect(redactSpanName("GET /join/SECRETTOKEN-1234", "/join/[token]")).toBe("GET /join/[token]");
    expect(redactSpanName("middleware GET /join/SECRETTOKEN-1234?who=someone")).toBe("middleware GET [path]");
  });

  it("keeps a page that has no dynamic segment", () => {
    expect(redactSpanName("GET /directory")).toBe("GET /directory");
  });
});

describe("redactSpan name", () => {
  it("takes the route from the span when its name holds the real path", () => {
    const out = redactSpan(span({ name: "GET /join/SECRETTOKEN-1234", attributes: { "next.route": "/join/[token]" } }));
    expect(out.name).toBe("GET /join/[token]");
    expectNoSecrets(out);
  });
});

describe("redactingExporter", () => {
  it("hands the next exporter only redacted spans", () => {
    const next = { export: vi.fn(), shutdown: vi.fn(async () => {}) };
    const done = vi.fn();
    redactingExporter(next).export([span({ status: { code: 2, message: MESSAGE } })], done);

    const [[sent, callback]] = next.export.mock.calls;
    expect(sent[0].status).toEqual({ code: 2 });
    expect(callback).toBe(done);
  });

  it("passes shutdown and flush through", async () => {
    const next = { export: vi.fn(), shutdown: vi.fn(async () => {}), forceFlush: vi.fn(async () => {}) };
    const exporter = redactingExporter(next);
    await exporter.shutdown();
    await exporter.forceFlush?.();
    expect(next.shutdown).toHaveBeenCalledOnce();
    expect(next.forceFlush).toHaveBeenCalledOnce();
  });
});
