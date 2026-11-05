// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

const { EmailDomainSettings } = await import("./EmailDomainSettings");

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  refresh.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("EmailDomainSettings when its read fails", () => {
  it("repeats the browser read when Try again is chosen", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "down" }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ enabled: false, data: null }));
    await act(async () => root.render(createElement(EmailDomainSettings)));
    expect(container.textContent).toContain("Couldn't load your sending domain settings.");

    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    await act(async () => retry!.click());

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Couldn't load");
    expect(container.textContent).toContain("Custom sending domain");
    // A server refresh would not re-run a read made in the browser.
    expect(refresh).not.toHaveBeenCalled();
  });
});
