// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Result = { data: unknown[] | null; error: { message: string } | null };

const people = [
  { id: "a", first_name: "Ada", last_name: "Lovelace", preferred_name: null },
  { id: "b", first_name: "Ben", last_name: "Okafor", preferred_name: null },
];
const failed: Result = { data: null, error: { message: "permission denied for table group_members" } };

/** Membership reads are answered in order; profile reads and writes always succeed. */
function stubClient(memberReads: Result[]) {
  const from = (table: string) => {
    let writing = false;
    const chain = {
      select: () => (writing ? Promise.resolve({ data: [{ id: "row" }], error: null }) : chain),
      update: () => {
        writing = true;
        return chain;
      },
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      range: async () =>
        table === "profiles" ? { data: people, error: null } : (memberReads.shift() ?? failed),
    };
    return chain;
  };
  return { from };
}

let client: ReturnType<typeof stubClient>;
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));
vi.mock("@/components/ui/dialog", () => {
  const passthrough = (tag: string) =>
    function Part({ children }: { children?: ReactNode }) {
      return createElement(tag, null, children);
    };
  return {
    Dialog: passthrough("div"),
    DialogContent: passthrough("div"),
    DialogHeader: passthrough("div"),
    DialogTitle: passthrough("h2"),
    DialogDescription: passthrough("p"),
  };
});

const { GroupLeadersDialog } = await import("./GroupLeadersDialog");

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`No button labelled "${label}"`);
  await act(async () => button.click());
}

describe("GroupLeadersDialog after a saved write", () => {
  it("drops the stale leaders when the reload fails", async () => {
    client = stubClient([{ data: [{ profile_id: "a", role: "leader" }], error: null }, failed]);
    const onChanged = vi.fn();
    await act(async () =>
      root.render(
        createElement(GroupLeadersDialog, {
          group: { id: "g", name: "Tuesday Group" },
          onClose: () => {},
          onChanged,
        }),
      ),
    );
    expect(container.textContent).toContain("Ada Lovelace");

    await click("Remove Ada Lovelace as leader");

    expect(onChanged).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Ada Lovelace");
    expect(container.textContent).toContain("Couldn't load this group's leaders.");
    expect(container.textContent).not.toContain("permission denied");
  });

  it("shows the new leaders when the reload succeeds", async () => {
    client = stubClient([
      { data: [{ profile_id: "a", role: "leader" }], error: null },
      { data: [{ profile_id: "a", role: "member" }], error: null },
    ]);
    await act(async () =>
      root.render(
        createElement(GroupLeadersDialog, {
          group: { id: "g", name: "Tuesday Group" },
          onClose: () => {},
          onChanged: () => {},
        }),
      ),
    );

    await click("Remove Ada Lovelace as leader");

    expect(container.textContent).toContain("This group has no leader yet.");
    expect(container.textContent).not.toContain("Couldn't load");
  });
});
