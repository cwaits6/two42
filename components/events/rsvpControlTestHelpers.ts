// Mounts RSVP controls in jsdom and stands in for the Supabase client their
// writes go through. Used by RsvpControl.test.ts; not production code.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type WriteResult = {
  data: string | null;
  error: { message: string } | null;
};

export type RsvpWrite = { fn: string; args: Record<string, unknown> };

export const writeFailed = (): WriteResult => ({
  data: null,
  error: { message: "permission denied for table rsvps" },
});
export const writeSaved = (): WriteResult => ({ data: null, error: null });

/** Records each `rpc()` call and answers it with `result()`. */
export function stubRsvpClient(result: () => WriteResult) {
  const writes: RsvpWrite[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      writes.push({ fn, args });
      return result();
    },
  };
  return { client, writes };
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
    labels: () => buttons().map((b) => b.textContent?.trim()),
    checked: () =>
      buttons()
        .filter((b) => b.querySelector("svg"))
        .map((b) => b.textContent?.trim()),
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
