// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

// The package itself is not mocked: what it queues for its script is the thing under test.
const { PageMeasurement } = await import("./PageMeasurement");

type Queue = [string, unknown][];
type Measured = { va?: unknown; vaq?: Queue };

const SECRET = "Zk3-secret-invite-token";

async function measure(address: string) {
  pathname = address;
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(PageMeasurement)));
  const queue = (window as Measured).vaq ?? [];
  const script = document.head.querySelector("script");
  await act(async () => root.unmount());
  return { queue, script, views: queue.filter(([kind]) => kind === "pageview").map(([, view]) => view) };
}

afterEach(() => {
  document.head.innerHTML = "";
  delete (window as Measured).va;
  delete (window as Measured).vaq;
});

describe("PageMeasurement", () => {
  it("reports an invite page by its pattern, and leaves the script nothing else to read", async () => {
    const { queue, script, views } = await measure(`/join/${SECRET}`);

    expect(views).toEqual([{ route: "/join/[token]", path: "/join/[token]" }]);
    expect(JSON.stringify(queue)).not.toContain(SECRET);
    expect(script?.dataset.disableAutoTrack).toBe("1");
  });

  it("reports nothing for an address that is no page, with the script's own tracking still off", async () => {
    const { script, views } = await measure(`/nope/${SECRET}`);

    expect(views).toEqual([]);
    expect(script?.dataset.disableAutoTrack).toBe("1");
  });

  it("hands the script a filter that rewrites a real address to its pattern, or drops the event", async () => {
    const { queue } = await measure("/login");
    const filters = queue.filter(([kind]) => kind === "beforeSend").map(([, filter]) => filter);
    expect(filters.length).toBeGreaterThan(0);

    for (const filter of filters as ((event: { type: string; url: string }) => { url: string } | null)[]) {
      expect(filter({ type: "pageview", url: `https://two42.io/join/${SECRET}?email=a@b.co#x` })).toEqual({
        type: "pageview",
        url: "https://two42.io/join/[token]",
      });
      expect(filter({ type: "pageview", url: `https://two42.io/nope/${SECRET}` })).toBeNull();
    }
  });
});
