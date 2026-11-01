// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { PendingJoinRequests } = await import("./PendingJoinRequests");

const request = (id: string, first: string) => ({
  id,
  created_at: "2026-10-01T12:00:00Z",
  requester: { first_name: first, last_name: "Test", preferred_name: null },
  email: null,
  group: { id: "g1", name: "Group C" },
});

const QUESTION = "Decline Ada Test's request to join Group C?";

let root: Root;

async function openDecline() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(PendingJoinRequests, {
        initialRequests: [request("r1", "Ada"), request("r2", "Ben")],
        timeZone: "America/Chicago",
      }),
    );
  });
  await click("Decline");
  expect(document.body.textContent).toContain(QUESTION);
}

async function click(name: string) {
  const found = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  await act(async () => found.click());
}

beforeEach(() => {
  rpc.mockReset();
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("declining a join request", () => {
  it("keeps the question open and the row listed when the decline fails", async () => {
    rpc.mockResolvedValue({ error: { code: "XX000" } });
    await openDecline();
    await click("Decline request");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain(QUESTION);
    expect(document.body.textContent).toContain("Ada Test");
  });

  it("can be retried from the same dialog", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "XX000" } }).mockResolvedValueOnce({ error: null });
    await openDecline();
    await click("Decline request");
    await click("Decline request");

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("Request declined.");
    expect(document.body.textContent).not.toContain(QUESTION);
    expect(document.body.textContent).not.toContain("Ada Test");
  });

  it("closes and drops the row when someone else already decided it", async () => {
    rpc.mockResolvedValue({ error: { code: "GJ004" } });
    await openDecline();
    await click("Decline request");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain(QUESTION);
    expect(document.body.textContent).not.toContain("Ada Test");
  });
});
