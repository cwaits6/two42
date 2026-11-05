// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ui/select", () => import("@/components/ui/select.mock"));

const updates = vi.hoisted(() => [] as { values: unknown; id: unknown }[]);
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (values: unknown) => ({
        eq: (_column: string, id: unknown) => ({
          select: async () => {
            updates.push({ values, id });
            return { data: [{ id }], error: null };
          },
        }),
      }),
    }),
  }),
}));

const { MemberRole } = await import("./MemberRole");

let root: Root;

async function mount(role: "admin" | "member" | "pending") {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemberRole, { member: { id: "ben", name: "Ben Test", role }, lockReason: null }));
  });
}

async function click(name: string) {
  const found = [...document.querySelectorAll("button")].findLast((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  await act(async () => found.click());
}

beforeEach(() => {
  updates.length = 0;
  refresh.mockClear();
  toast.success.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("MemberRole", () => {
  it("approves a pending person only once the question is answered", async () => {
    await mount("pending");
    await click("Member");

    expect(updates).toEqual([]);
    expect(document.body.textContent).toContain("Approve Ben Test as a member?");

    await click("Approve member");
    expect(updates).toEqual([{ values: { role: "member" }, id: "ben" }]);
    expect(toast.success).toHaveBeenCalledWith("Role changed.");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("asks before making someone a church admin, and saves nothing on cancel", async () => {
    await mount("member");
    await click("Church admin");
    expect(document.body.textContent).toContain("Make Ben Test a church admin?");

    await click("Cancel");
    expect(updates).toEqual([]);
  });

  it("asks nothing when the role picked is the one they hold", async () => {
    await mount("member");
    await click("Member");

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(updates).toEqual([]);
  });
});
