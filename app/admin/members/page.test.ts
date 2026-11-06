import { describe, expect, it, vi } from "vitest";

class RedirectSentinel extends Error {
  constructor(public readonly target: string) {
    super(`redirect:${target}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectSentinel(target);
  },
}));
vi.mock("./MembersList", () => ({ MembersList: () => null }));

const { default: MembersPage } = await import("./page");
const { default: AdminPage } = await import("../page");
const { MembersList } = await import("./MembersList");

const open = (tab?: string) => MembersPage({ searchParams: Promise.resolve({ tab }) });

describe("MembersPage", () => {
  it("sends a saved link to the old Requests tab to the Requests page", async () => {
    await expect(open("requests")).rejects.toMatchObject({ target: "/admin/requests" });
  });

  it("shows the members otherwise", async () => {
    expect((await open()).type).toBe(MembersList);
    expect((await open("members")).type).toBe(MembersList);
  });
});

describe("AdminPage", () => {
  it("opens church admin on Members", () => {
    expect(AdminPage).toThrow(expect.objectContaining({ target: "/admin/members" }));
  });
});
