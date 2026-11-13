// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
const recordUsage = vi.fn();
vi.mock("@/lib/analytics/recordUsage", () => ({ recordUsage }));

const { UsageRecorder } = await import("./UsageRecorder");

describe("UsageRecorder", () => {
  it("counts one view per address, and none for a re-render of the same one", async () => {
    const root = createRoot(document.createElement("div"));
    for (const address of ["/g/a/calendar", "/g/a/calendar", "/g/b/calendar"]) {
      pathname = address;
      await act(async () => root.render(createElement(UsageRecorder)));
    }
    expect(recordUsage.mock.calls).toEqual([
      ["view", "/g/a/calendar"],
      ["view", "/g/b/calendar"],
    ]);
    await act(async () => root.unmount());
  });
});
