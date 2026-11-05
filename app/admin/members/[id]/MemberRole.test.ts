// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { roleLockReason } from "../memberRoles";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const { MemberRole } = await import("./MemberRole");

let root: Root;
let host: HTMLDivElement;

async function mount(role: "admin" | "member" | "pending", lockReason: string | null) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemberRole, { member: { id: "me", name: "Ada Test", role }, lockReason }));
  });
}

const control = () => host.querySelector<HTMLElement>("#member-role")!;

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("MemberRole", () => {
  it("locks the last church admin's own role and says why", async () => {
    await mount("admin", roleLockReason("me", "me", 1));

    expect(control().hasAttribute("disabled") || control().getAttribute("aria-disabled") === "true").toBe(true);
    expect(control().textContent).toContain("Church admin");
    const hint = document.getElementById(control().getAttribute("aria-describedby")!);
    expect(hint?.textContent).toBe(
      "A church needs at least one church admin, so add another before changing your role.",
    );
  });

  it("leaves someone else's role open, with no reason shown", async () => {
    await mount("member", roleLockReason("you", "me", 1));

    expect(control().hasAttribute("disabled")).toBe(false);
    expect(control().textContent).toContain("Member");
    expect(host.querySelector("#member-role-hint")).toBeNull();
  });

  it("offers a pending person a role to choose, not a role they hold", async () => {
    await mount("pending", null);

    expect(control().textContent).toContain("Choose a role");
  });
});
