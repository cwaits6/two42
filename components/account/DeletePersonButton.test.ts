// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeletePersonButton } from "./DeletePersonButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const SUMMARY = {
  name: "Ada Okafor",
  lastChurchAdmin: false,
  platformOperator: false,
  groupContent: { kind: "counts", fundsRetired: 0, fundsDeleted: 0, groupsLosingLeader: 0 },
  household: null,
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

let root: Root | null = null;
const fetchMock = vi.fn();

async function mount(subject: "self" | "other", onDeleted: () => Promise<void> = vi.fn(async () => {})) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(DeletePersonButton, { url: "/api/x", subject, label: "Delete it", onDeleted }),
    ),
  );
  return onDeleted;
}

function button(label: string) {
  const match = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label);
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match;
}

const click = (label: string) => act(async () => button(label).click());
const dialogOpen = () => document.querySelector('[role="dialog"]') !== null;

async function openThenConfirm(subject: "self" | "other", answer: Response) {
  fetchMock.mockResolvedValueOnce(json(200, SUMMARY)).mockResolvedValueOnce(answer);
  const onDeleted = await mount(subject);
  await click("Delete it");
  expect(dialogOpen()).toBe(true);
  await click(subject === "self" ? "Delete my account" : "Delete account");
  return onDeleted;
}

beforeEach(() => {
  fetchMock.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("DeletePersonButton: an account already gone", () => {
  it("closes the dialog, says so and reloads when the delete gets a 404", async () => {
    const onDeleted = await openThenConfirm("other", json(404, { error: "Not found" }));
    expect(dialogOpen()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("That account is already deleted.");
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("says so and reloads when opening the confirmation gets a 404", async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: "Not found" }));
    const onDeleted = await mount("other");
    await click("Delete it");
    expect(dialogOpen()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("That account is already deleted.");
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("goes on when a self-delete's retry gets a 401", async () => {
    const onDeleted = await openThenConfirm("self", json(401, { error: "Unauthorized" }));
    expect(dialogOpen()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("You're signed out.");
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("goes on when opening a self-delete's confirmation gets a 401", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: "Unauthorized" }));
    const onDeleted = await mount("self");
    await click("Delete it");
    expect(toast.error).toHaveBeenCalledWith("You're signed out.");
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("keeps a church admin's expired session a failure, with the dialog open", async () => {
    const onDeleted = await openThenConfirm("other", json(401, { error: "Unauthorized" }));
    expect(dialogOpen()).toBe(true);
    expect(toast.error).toHaveBeenCalledWith("Couldn't delete this account. Sign in again, then try again.");
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("keeps a server failure a failure, with the dialog open", async () => {
    const onDeleted = await openThenConfirm("other", json(500, { error: "Failed to delete" }));
    expect(dialogOpen()).toBe(true);
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe("DeletePersonButton: a delete that went through", () => {
  it("tells a church admin, and closes the dialog, without waiting for the reload", async () => {
    fetchMock.mockResolvedValueOnce(json(200, SUMMARY)).mockResolvedValueOnce(json(200, { ok: true, photosNotRemoved: 0 }));
    const onDeleted = vi.fn(() => new Promise<void>(() => {}));
    await mount("other", onDeleted);
    await click("Delete it");
    await click("Delete account");
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Account deleted.");
    expect(dialogOpen()).toBe(false);
  });

  it("reports a reload that fails as the reload's own, never as a failed delete", async () => {
    fetchMock.mockResolvedValueOnce(json(200, SUMMARY)).mockResolvedValueOnce(json(200, { ok: true, photosNotRemoved: 0 }));
    // loadData() reports a failure itself and resolves.
    const onDeleted = vi.fn(async () => {
      toast.error("Couldn't load the latest members. Try again.");
    });
    await mount("other", onDeleted);
    await click("Delete it");
    await click("Delete account");
    expect(toast.success).toHaveBeenCalledWith("Account deleted.");
    expect(toast.error.mock.calls).toEqual([["Couldn't load the latest members. Try again."]]);
    expect(dialogOpen()).toBe(false);
  });

  it("reports photos still stored instead of a plain success", async () => {
    await openThenConfirm("other", json(200, { ok: true, photosNotRemoved: 2 }));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error.mock.calls[0][0]).toContain("2 photos are still stored");
  });
});
