// Mounts an RSVP control in jsdom and stands in for the Supabase client its
// write goes through. Shared by the three control tests; not production code.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type WriteResult = {
  data: { user_id: string }[] | null;
  error: { message: string } | null;
};

export type RsvpWrite = { kind: "delete" } | { kind: "upsert"; row: unknown };

export const writeFailed = (): WriteResult => ({
  data: null,
  error: { message: "permission denied for table rsvps" },
});
export const writeSaved = (): WriteResult => ({ data: [{ user_id: "user-1" }], error: null });
export const writeTouchedNoRow = (): WriteResult => ({ data: [], error: null });

/**
 * The stub resolves the same result whether the chain ends in `.select()`
 * or is awaited directly, so it is honest about both write shapes.
 */
export function stubRsvpClient(result: () => WriteResult) {
  const writes: RsvpWrite[] = [];
  const chain = {
    delete() {
      writes.push({ kind: "delete" });
      return chain;
    },
    upsert(row: unknown) {
      writes.push({ kind: "upsert", row });
      return chain;
    },
    eq() {
      return chain;
    },
    select: async () => result(),
    then<T>(onFulfilled: (value: WriteResult) => T) {
      return Promise.resolve(result()).then(onFulfilled);
    },
  };
  return { client: { from: () => chain }, writes };
}

export type RsvpClientStub = ReturnType<typeof stubRsvpClient>;

const mounted: { root: Root; container: HTMLElement }[] = [];

export async function mountControl(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(element);
  });
  const buttons = () => Array.from(container.querySelectorAll("button"));
  return {
    text: () => container.textContent ?? "",
    pressed: () =>
      buttons()
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.textContent?.trim()),
    async click(label: string) {
      const button = buttons().find((b) => b.textContent?.trim() === label);
      if (!button) throw new Error(`No button labelled "${label}"`);
      await act(async () => {
        button.click();
      });
    },
  };
}

export async function unmountControls() {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
}
