// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

const { OrganizationDetail } = await import("./OrganizationDetail");

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("OrganizationDetail daily email limit", () => {
  it("ties the message to the field before focus lands on it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await act(async () =>
      root.render(
        createElement(OrganizationDetail, {
          org: {
            id: "o",
            name: "Sample Organization",
            status: "active",
            customEmailDomainEnabled: false,
            branding: { display_name: "", accent: "", reply_to: "" },
          },
          owner: null,
          emailCap: { dailyCap: 200, hasOverride: false, usedToday: 3 },
          emailDomain: { loaded: true, row: null },
        }),
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#email-daily-cap")!;
    let describedByAtFocus: string | null = null;
    input.addEventListener("focus", () => {
      describedByAtFocus = input.getAttribute("aria-describedby");
    });

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save limit")!;
    await act(async () => save.click());

    expect(document.activeElement).toBe(input);
    expect(describedByAtFocus).toBe("email-daily-cap-error");
    expect(document.getElementById("email-daily-cap-error")?.textContent).toBe(
      "Enter a whole number of emails per day (0 or more).",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
