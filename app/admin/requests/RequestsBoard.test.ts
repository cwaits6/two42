// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

// Each queue lists its rows with a button that decides one, as approving or declining does.
type QueueProps = { requests: { id: string }[]; onRemove: (id: string) => void };
const queue = ({ requests, onRemove }: QueueProps) =>
  requests.map((r) => h("button", { key: r.id, type: "button", onClick: () => onRemove(r.id) }, `Decide ${r.id}`));
vi.mock("@/components/admin/PendingAccessRequests", () => ({ PendingAccessRequests: queue }));
vi.mock("@/components/admin/PendingGroupRequests", () => ({ PendingGroupRequests: queue }));
vi.mock("@/components/admin/PendingJoinRequests", () => ({ PendingJoinRequests: queue }));

const { RequestsBoard } = await import("./RequestsBoard");

type Rows = { id: string }[] | null;
let root: Root;
let host: HTMLDivElement;

async function mount(access: Rows, group: Rows, join: Rows) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(h(RequestsBoard, { access, group, join, timeZone: "America/Chicago" } as never));
  });
}

const headings = () => [...host.querySelectorAll("h2")].map((heading) => heading.textContent);
const status = () => host.querySelector('[role="status"]')?.textContent;
const occurrences = (text: string) => host.textContent!.split(text).length - 1;

async function decide(id: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === `Decide ${id}`);
  if (!button) throw new Error(`No request ${id}`);
  await act(async () => button.click());
}

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("RequestsBoard", () => {
  it("shows a kind only when it has something waiting, and how many wait in all", async () => {
    await mount([{ id: "a1" }, { id: "a2" }], [], [{ id: "j1" }]);

    expect(headings()).toEqual(["Access requests", "Join requests"]);
    expect(status()).toBe("3 requests waiting.");
  });

  it("says once that nothing is waiting", async () => {
    await mount([], [], []);

    expect(headings()).toEqual([]);
    expect(occurrences("No requests waiting.")).toBe(1);
  });

  it("says a kind couldn't be read and still shows the others, with no total", async () => {
    await mount([{ id: "a1" }], [], null);

    expect(headings()).toEqual(["Access requests", "Join requests"]);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load the join requests.");
    expect(host.textContent).toContain("Decide a1");
    expect(status()).toBeUndefined();
    expect(host.textContent).not.toContain("requests waiting.");
  });

  it("never says nothing is waiting while a kind is unread", async () => {
    await mount([], [], null);

    expect(headings()).toEqual(["Join requests"]);
    expect(host.textContent).toContain("No other requests waiting.");
    expect(host.textContent).not.toContain("No requests waiting.");
  });

  it("drops a kind with its last request, then says nothing is waiting", async () => {
    await mount([{ id: "a1" }], [{ id: "g1" }], []);

    await decide("a1");
    expect(headings()).toEqual(["Group requests"]);
    expect(status()).toBe("1 request waiting.");

    await decide("g1");
    expect(headings()).toEqual([]);
    expect(occurrences("No requests waiting.")).toBe(1);
  });
});
