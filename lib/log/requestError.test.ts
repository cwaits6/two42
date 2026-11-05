import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";
import { onRequestError } from "@/instrumentation";
import { loggedLines } from "./testing";

const TOKEN = "Zk3-secret-invite-token";
const EMAIL = "sam@example.com";

type RequestErrorArgs = Parameters<typeof onRequestError>;

const request = {
  path: `/join/${TOKEN}?email=${EMAIL}`,
  method: "GET",
  headers: {},
} as RequestErrorArgs[1];

const context = {
  routerKind: "App Router",
  routePath: "/join/[token]",
  routeType: "render",
} as RequestErrorArgs[2];

function thrown(digest: string) {
  return Object.assign(new Error(`duplicate key: Key (email)=(${EMAIL}) already exists.`), { digest });
}

afterEach(() => vi.restoreAllMocks());

describe("an error nothing caught", () => {
  it("is logged under the digest the error page shows, with the route pattern and nothing from the request or the message", async () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = thrown("1820308953");

    await onRequestError(error, request, context);

    expect(loggedLines(logged)).toEqual([
      {
        level: "error",
        what: "Request failed with an error nothing caught",
        route: "/join/[token]",
        step: "render",
        code: "Error",
        ref: "1820308953",
      },
    ]);
    const line = String(logged.mock.calls[0][0]);
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain(EMAIL);

    const html = renderToStaticMarkup(createElement(ErrorPage, { error, reset: () => {} }));
    expect(html).toContain("1820308953");
  });

  it("is logged under a random reference when the digest is not a plain token", async () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});

    await onRequestError(thrown(`/join/${TOKEN}`), request, context);

    const [{ ref }] = loggedLines(logged);
    expect(ref).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
});
