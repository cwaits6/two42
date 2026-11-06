// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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

const listed = (...kinds: Rows[]) => kinds.reduce((sum, rows) => sum + (rows?.length ?? 0), 0);

const render = (access: Rows, group: Rows, join: Rows, waiting: number | null) =>
  act(async () => {
    root.render(h(RequestsBoard, { access, group, join, waiting, timeZone: "America/Chicago" } as never));
  });

/** `waiting` is the server's count; it agrees with the lists unless a test says otherwise. */
async function mount(access: Rows, group: Rows, join: Rows, waiting: number | null = listed(access, group, join)) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render(access, group, join, waiting);
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

  it("shows the server's count, the number the menu shows, not a sum of its own", async () => {
    await mount([{ id: "a1" }], [], [{ id: "j1" }], 5);

    expect(status()).toBe("5 requests waiting.");
  });

  it("shows no number when the count couldn't be read", async () => {
    await mount([{ id: "a1" }], [], [], null);

    expect(headings()).toEqual(["Access requests"]);
    expect(status()).toBeUndefined();
  });

  it("takes a decided request off the count once, before and after the page re-reads", async () => {
    await mount([{ id: "a1" }, { id: "a2" }], [], [{ id: "j1" }], 3);

    await decide("a1");
    expect(status()).toBe("2 requests waiting.");

    await render([{ id: "a2" }], [], [{ id: "j1" }], 2);
    expect(status()).toBe("2 requests waiting.");
  });

  it("re-reads the page after each decision, so the menu's count follows", async () => {
    refresh.mockClear();
    await mount([{ id: "a1" }, { id: "a2" }], [], [], 2);
    expect(refresh).not.toHaveBeenCalled();

    await decide("a1");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("claims nothing about the rest when no kind could be read", async () => {
    await mount(null, null, null, null);

    expect(headings()).toEqual(["Access requests", "Group requests", "Join requests"]);
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(3);
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
