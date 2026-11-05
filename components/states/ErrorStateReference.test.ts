import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loggedLines } from "@/lib/log/testing";

// Stands in for a server component render, where React memoizes cache().
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T,>(make: () => T) => {
    let made: { value: T } | null = null;
    return () => (made ??= { value: make() }).value;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { logError } = await import("@/lib/log");
const { ErrorState } = await import("./ErrorState");

describe("ErrorState in a server page", () => {
  it("shows the reference of the line the page logged, for the person to quote", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    logError("Events read failed", { code: "PGRST301" });

    const html = renderToStaticMarkup(createElement(ErrorState, { thing: "events" }));
    const [{ ref }] = loggedLines(logged);

    expect(ref).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(html).toContain("Reference: ");
    expect(html).toContain(ref);
  });
});
