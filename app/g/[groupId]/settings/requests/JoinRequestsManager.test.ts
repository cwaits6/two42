// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
const rpc = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: (fn: string, args: unknown) => rpc(fn, args) }),
}));

const { JoinRequestsManager } = await import("./JoinRequestsManager");

const GROUP = "11111111-1111-4111-8111-111111111111";
const request = {
  id: "r1",
  created_at: "2026-11-01T15:00:00.000Z",
  first_name: "Amelia",
  last_name: "Demoski",
  preferred_name: null,
  email: null,
};

let root: Root;
let container: HTMLElement;

beforeEach(async () => {
  refresh.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) =>
    fn === "pending_group_join_requests" ? { data: [request], error: null } : { data: null, error: null },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(JoinRequestsManager, {
        groupId: GROUP,
        groupName: "Grace",
        emptyText: "No pending requests.",
        timeZone: "America/New_York",
      }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;

describe("JoinRequestsManager", () => {
  it("lists the requests pending_group_join_requests returns for this group id", () => {
    expect(rpc).toHaveBeenCalledWith("pending_group_join_requests", { _group_id: GROUP });
    expect(container.textContent).toContain("Amelia Demoski");
  });

  it.each([
    ["Decline", false],
    ["Approve", true],
  ])("%s removes the row and refreshes the menu's count", async (label, approve) => {
    await act(async () => button(label).click());
    expect(rpc).toHaveBeenCalledWith("review_group_join_request", { _request_id: "r1", _approve: approve });
    expect(container.textContent).not.toContain("Amelia Demoski");
    expect(container.textContent).toContain("No pending requests.");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the row when the review fails for another reason", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "pending_group_join_requests" ? { data: [request], error: null } : { data: null, error: { code: "42501" } },
    );
    await act(async () => button("Decline").click());
    expect(container.textContent).toContain("Amelia Demoski");
    expect(refresh).not.toHaveBeenCalled();
  });
});
