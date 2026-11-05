import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCode, formatLine, logError, logInfo, logWarn, newReference } from "./core";

const EMAIL = "sample.person@example.com";
const SENTENCE = "Please pray for my mother before her surgery on Friday.";
const UUID = "3f0c9a52-7b1e-4c7d-9a41-0d2f6e8b1c33";

const databaseError = {
  code: "23505",
  message: `duplicate key value violates unique constraint "profiles_email_key" (${EMAIL})`,
  details: `Key (email)=(${EMAIL}) already exists.`,
  hint: SENTENCE,
};

function written(spy: ReturnType<typeof vi.spyOn>) {
  expect(spy).toHaveBeenCalledOnce();
  return spy.mock.calls[0][0] as string;
}

afterEach(() => vi.restoreAllMocks());

describe("log line", () => {
  it("writes the code of a database error and nothing from its message, details or hint", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const reference = logError("Profile save failed", databaseError, {
      route: "/api/members/[id]",
      ids: { member: UUID },
    });

    const line = written(spy);
    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain("example.com");
    expect(line).not.toContain("pray");
    expect(line).not.toContain("duplicate key");
    expect(JSON.parse(line)).toEqual({
      level: "error",
      what: "Profile save failed",
      route: "/api/members/[id]",
      code: "23505",
      ref: reference,
      ids: { member: UUID },
    });
  });

  it("is a single line on standard output for every level", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logError("a", new Error("x"));
    logWarn("b", new Error("x"));
    logInfo("c");

    expect(log.mock.calls.map(([line]) => JSON.parse(line as string).level)).toEqual(["error", "warn", "info"]);
    for (const [line] of log.mock.calls) expect(line).not.toContain("\n");
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("writes only the class name of a thrown error", () => {
    const line = formatLine("error", "Send failed", new TypeError(`no route to ${EMAIL}`), undefined, "REF");
    expect(JSON.parse(line)).toEqual({ level: "error", what: "Send failed", code: "TypeError", ref: "REF" });
  });

  it("writes nothing from an error passed as text", () => {
    const line = formatLine("error", "Cleanup failed", `Failing row contains (${EMAIL})`, undefined, "REF");
    expect(JSON.parse(line).code).toBe("string");
    expect(line).not.toContain(EMAIL);
  });

  it("keeps row ids and counts, and drops every other value", () => {
    const line = formatLine(
      "warn",
      "Reminder skipped",
      undefined,
      {
        ids: {
          event: UUID,
          sent: 3,
          email: EMAIL,
          name: "Ada Okafor",
          phone: "555-010-0199",
          token: "b7Qe2mXw9LpA4tRz8sKd1VnC6yHg3JfU",
          link: `https://two42.io/join/b7Qe2mXw9LpA4tRz8sKd1VnC6yHg3JfU`,
          nested: { id: UUID },
          nan: Number.NaN,
        },
      },
      "REF",
    );
    expect(JSON.parse(line).ids).toEqual({ event: UUID, sent: 3 });
  });

  it("drops a route with a query or a host, and keeps a pattern or a function name", () => {
    const route = (value: string) => JSON.parse(formatLine("error", "x", undefined, { route: value }, "REF")).route;
    expect(route("/g/[groupId]/calendar/[id]")).toBe("/g/[groupId]/calendar/[id]");
    expect(route("send-event-reminders")).toBe("send-event-reminders");
    expect(route("/login?next=/x&email=a@b.co")).toBeUndefined();
    expect(route("https://two42.io/join/abc")).toBeUndefined();
  });

  // Shape cannot tell these from a pattern or an id, so call sites must not pass them;
  // lint requires a fixed string only for a `route` written inside the call.
  it("cannot tell a bare path or a UUID token from what it accepts", () => {
    const line = JSON.parse(
      formatLine("error", "x", undefined, { route: "/join/Zk3-secret-invite-token", ids: { token: UUID } }, "REF"),
    );
    expect(line.route).toBe("/join/Zk3-secret-invite-token");
    expect(line.ids).toEqual({ token: UUID });
  });

  it("drops a step that is not a fixed label", () => {
    const step = (value: string) => JSON.parse(formatLine("error", "x", undefined, { step: value }, "REF")).step;
    expect(step("family_members")).toBe("family_members");
    expect(step(`insert for ${EMAIL}`)).toBeUndefined();
    expect(step("a".repeat(41))).toBeUndefined();
  });

  it("leaves the code out when no error was passed", () => {
    expect(JSON.parse(formatLine("info", "Done", undefined, undefined, "REF"))).toEqual({
      level: "info",
      what: "Done",
      ref: "REF",
    });
  });
});

describe("errorCode", () => {
  it.each([
    [{ code: "PGRST116", message: EMAIL }, "PGRST116"],
    [{ code: "ECONNRESET" }, "ECONNRESET"],
    [{ code: "", message: "TypeError: fetch failed", details: EMAIL, hint: "" }, "empty"],
    [{ code: `oops ${EMAIL}`, status: 422 }, "422"],
    [{ statusCode: 429, name: "rate_limit_exceeded", message: EMAIL }, "429"],
    [{ name: "validation_error", message: `Invalid to: ${EMAIL}` }, "validation_error"],
    [{ name: `Bad ${EMAIL}` }, "unknown"],
    [{ status: 9000 }, "unknown"],
    [{}, "unknown"],
    [42, "number"],
  ])("reads %j as %s", (error, code) => {
    expect(errorCode(error)).toBe(code);
  });
});

describe("newReference", () => {
  it("is eight characters with no look-alikes, and differs between calls", () => {
    const references = Array.from({ length: 50 }, newReference);
    for (const reference of references) expect(reference).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(new Set(references).size).toBe(50);
  });
});
