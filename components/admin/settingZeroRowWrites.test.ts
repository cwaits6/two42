// @vitest-environment jsdom
import { act, createElement, type FunctionComponent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/ui/select", () => import("@/components/ui/select.mock"));

const write = vi.hoisted(() => ({
  result: null as unknown as { data: unknown[] | null; error: { code: string } | null },
  calls: [] as { table: string; values: unknown; filter: [string, unknown] }[],
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      update: (values: unknown) => ({
        eq: (column: string, value: unknown) => ({
          select: async () => {
            write.calls.push({ table, values, filter: [column, value] });
            return write.result;
          },
        }),
      }),
    }),
  }),
}));

const { GroupDiscoverySettings } = await import("@/components/groups/GroupDiscoverySettings");
const { OrgGroupControls } = await import("./OrgGroupControls");
const { DirectoryVisibilitySettings } = await import("./DirectoryVisibilitySettings");

let root: Root;

async function mount<P extends object>(control: FunctionComponent<P>, props: P) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(control, props)));
}

const flipSwitch = () => act(async () => document.querySelector<HTMLElement>('[role="switch"]')!.click());
const pick = (label: string) =>
  act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click());

// Each row changes the control, and names the write and the toast a save makes.
const SETTINGS = [
  {
    name: "group discovery",
    change: async () => {
      await mount(GroupDiscoverySettings, { orgId: "org-1", discoveryOn: false });
      await flipSwitch();
    },
    values: { group_discovery: true },
    saved: "Members can now find and request to join groups.",
    failed: "Couldn't update the setting. Try again.",
  },
  {
    name: "who can add groups",
    change: async () => {
      await mount(OrgGroupControls, { orgId: "org-1", policy: "approval" });
      await pick("Open");
    },
    values: { group_creation_policy: "open" },
    saved: "Members can now add groups.",
    failed: "Couldn't save who can add groups. Try again.",
  },
  {
    name: "directory visibility",
    change: async () => {
      await mount(DirectoryVisibilitySettings, { orgId: "org-1", visibility: "shared_groups" });
      await flipSwitch();
    },
    values: { directory_visibility: "org" },
    saved: "Members can now see everyone in the church.",
    failed: "Couldn't change who can see the directory. Try again.",
  },
];

beforeEach(() => {
  write.calls = [];
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe.each(SETTINGS)("the $name setting", ({ change, values, saved, failed }) => {
  it("writes the church's own row and says what changed", async () => {
    write.result = { data: [{}], error: null };
    await change();

    expect(write.calls).toEqual([{ table: "organizations", values, filter: ["id", "org-1"] }]);
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(saved);
  });

  it.each([
    ["matched no row", { data: [], error: null }],
    ["was refused", { data: null, error: { code: "42501" } }],
  ])("claims no save when the write %s", async (_case, result) => {
    write.result = result;
    await change();

    expect(write.calls).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(failed);
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("who can add groups", () => {
  it("writes nothing when the option picked is the one in force", async () => {
    await mount(OrgGroupControls, { orgId: "org-1", policy: "approval" });
    await pick("Approval required");

    expect(write.calls).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
