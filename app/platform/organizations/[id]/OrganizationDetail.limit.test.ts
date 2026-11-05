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

const LOADED = { dailyCap: 200, hasOverride: false, usedToday: 3 };

async function render(emailCap: typeof LOADED | null) {
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
        emailCap,
        emailDomain: { loaded: true, row: null },
      }),
    ),
  );
}

const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

async function type(id: string, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(field(id), value);
    field(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("OrganizationDetail daily email limit", () => {
  it("ties the message to the field before focus lands on it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await render(LOADED);
    const input = field("email-daily-cap");
    let describedByAtFocus: string | null = null;
    input.addEventListener("focus", () => {
      describedByAtFocus = input.getAttribute("aria-describedby");
    });

    await type("email-daily-cap", "");
    const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save limit")!;
    await act(async () => save.click());

    expect(document.activeElement).toBe(input);
    expect(describedByAtFocus).toBe("email-daily-cap-error");
    expect(document.getElementById("email-daily-cap-error")?.textContent).toBe(
      "Enter a whole number of emails per day (0 or more).",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a failed read of the limit with no field, fills it after a retry, and keeps unsaved branding", async () => {
    await render(null);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't load the daily email limit.",
    );
    expect(container.querySelector("#email-daily-cap")).toBeNull();
    await type("branding-display-name", "Unsaved name");

    await render(LOADED);

    expect(field("email-daily-cap").value).toBe("200");
    expect(field("branding-display-name").value).toBe("Unsaved name");
  });

  it("keeps unsaved branding and a typed limit when a later read of the limit fails and recovers", async () => {
    await render(LOADED);
    await type("branding-display-name", "Unsaved name");
    await type("email-daily-cap", "350");

    await render(null);
    expect(field("branding-display-name").value).toBe("Unsaved name");
    await render(LOADED);

    expect(field("branding-display-name").value).toBe("Unsaved name");
    expect(field("email-daily-cap").value).toBe("350");
  });
});
