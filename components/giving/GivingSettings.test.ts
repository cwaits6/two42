// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const write = vi.hoisted(() => ({
  update: vi.fn(),
  upsert: vi.fn(),
  eq: vi.fn(),
  result: { data: [{ key: "giving_manage_mode" }], error: null } as {
    data: unknown[] | null;
    error: { message: string } | null;
  },
}));

vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => {
      const chain = {
        update: (values: unknown) => {
          write.update(values);
          return chain;
        },
        upsert: write.upsert,
        eq: (column: string, value: unknown) => {
          write.eq(column, value);
          return chain;
        },
        select: () => Promise.resolve(write.result),
      };
      return chain;
    },
  }),
}));

const { GivingSettings } = await import("./GivingSettings");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(GivingSettings, { stewardsCanManage: true })));
  return container;
}

const theSwitch = () => document.querySelector<HTMLElement>('[role="switch"]')!;

beforeEach(() => {
  vi.clearAllMocks();
  write.result = { data: [{ key: "giving_manage_mode" }], error: null };
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("GivingSettings", () => {
  it("offers who can manage funds and nothing about a Give tile", async () => {
    const container = await mount();
    expect(container.textContent).toContain("Members can add their own funds");
    expect(container.textContent).toContain("only leaders can add and edit funds");
    expect(container.textContent).not.toMatch(/tile|only admins/i);
    expect(document.querySelectorAll('[role="switch"]')).toHaveLength(1);
  });

  it("updates the existing row, since the table has no insert policy for an upsert", async () => {
    await mount();
    await act(async () => theSwitch().click());
    expect(write.upsert).not.toHaveBeenCalled();
    expect(write.update).toHaveBeenCalledWith(expect.objectContaining({ value: "admins" }));
    expect(write.eq).toHaveBeenCalledWith("key", "giving_manage_mode");
    expect(toast.success).toHaveBeenCalledWith("Only leaders can add and edit funds.");
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it.each([
    ["the write fails", { data: null, error: { message: "denied" } }],
    ["no row changes", { data: [], error: null }],
  ])("puts the switch back and says so when %s", async (_case, result) => {
    write.result = result;
    await mount();
    await act(async () => theSwitch().click());
    expect(toast.error).toHaveBeenCalledWith("Couldn't update the setting. Try again.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(theSwitch().getAttribute("aria-checked")).toBe("true");
  });
});
