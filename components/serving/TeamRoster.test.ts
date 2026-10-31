// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type WriteResult = { data: { profile_id: string }[] | null; error: { message: string } | null; status: number };
let result: WriteResult;

// Both writes end in .select(), which is where the result resolves.
vi.mock("@/lib/supabase/client", () => {
  const chain = {
    insert: () => chain,
    delete: () => chain,
    eq: () => chain,
    select: async () => result,
  };
  return { createClient: () => ({ from: () => chain }) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { TeamRoster } = await import("./TeamRoster");

const henry = {
  id: "p-henry",
  first_name: "Henry",
  last_name: "Mockingham",
  preferred_name: null,
  avatar_url: null,
};
const zoe = { ...henry, id: "p-zoe", first_name: "Zoe", last_name: "Dummyfield" };

let root: Root;

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(TeamRoster, {
        teamId: "t1",
        teamName: "Greeters",
        groupName: "Group B",
        members: [{ ...henry, is_leader: false }],
        candidates: [zoe],
      }),
    ),
  );
}

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`No button "${label}"`);
  await act(async () => button.click());
}

const dialog = () => document.querySelector('[role="dialog"]');

describe("TeamRoster writes that touch no row", () => {
  it("reports a remove that deletes nothing as a failure and keeps the dialog open", async () => {
    result = { data: [], error: null, status: 200 };
    await mount();
    await click("Remove Henry Mockingham from Greeters");
    await click("Remove from team");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.success).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("reports an add that inserts nothing as a failure", async () => {
    result = { data: [], error: null, status: 201 };
    await mount();
    await click("Add person");
    await click("Add Zoe Dummyfield to Greeters");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reports a remove that deletes the row as done", async () => {
    result = { data: [{ profile_id: henry.id }], error: null, status: 200 };
    await mount();
    await click("Remove Henry Mockingham from Greeters");
    await click("Remove from team");

    expect(toast.success).toHaveBeenCalledWith("Removed Henry Mockingham from Greeters.");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
