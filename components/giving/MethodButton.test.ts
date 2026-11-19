// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create as createQr } from "qrcode";
import { MethodButton } from "@/components/giving/MethodButton";
import { PAYMENT_METHODS, type ResolvedMethod } from "@/lib/giving/methods";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("qrcode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("qrcode")>();
  return { ...actual, create: vi.fn(actual.create) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const venmo: ResolvedMethod = {
  method: "venmo",
  handle: "@gracechurch",
  meta: PAYMENT_METHODS.venmo,
};

let container: HTMLDivElement;
let root: Root;

function pointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(pointer: coarse)" ? coarse : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function render(resolved: ResolvedMethod = venmo) {
  act(() => root.render(createElement(MethodButton, { resolved, fundName: "Meals & Care" })));
}

function payLink() {
  return container.querySelector<HTMLAnchorElement>("a")!;
}

function click(el: HTMLElement) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Venmo on a phone or tablet", () => {
  beforeEach(() => pointer(true));

  it("opens a payment with the fund name and no amount when the amount is blank", () => {
    render();
    expect(container.querySelector("input")?.inputMode).toBe("decimal");
    expect(payLink().getAttribute("href")).toBe(
      "venmo://paycharge?txn=pay&recipients=gracechurch&note=Meals%20%26%20Care"
    );
    expect(payLink().target).toBe("");
    expect(container.querySelector("svg[role=img]")).toBeNull();
  });

  it("puts the typed amount in the link", () => {
    render();
    type(container.querySelector("input")!, "25");
    expect(new URL(payLink().getAttribute("href")!).searchParams.get("amount")).toBe("25.00");
  });

  describe("when the app doesn't open", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function status() {
      return container.querySelector("[role=status]");
    }

    it("offers Copy once the page is still in front", () => {
      render();
      click(payLink());
      expect(status()).toBeNull();
      act(() => vi.advanceTimersByTime(2500));
      expect(status()?.textContent).toContain("Venmo didn't open");
      expect(status()?.querySelector("button")?.textContent).toBe("Copy");
    });

    it("stays quiet when the page leaves for the app", () => {
      render();
      click(payLink());
      act(() => {
        window.dispatchEvent(new Event("blur"));
        vi.advanceTimersByTime(2500);
      });
      expect(status()).toBeNull();
    });
  });

  it.each([
    ["blank", ""],
    ["valid", "25"],
  ])("lets Open Venmo through with a %s amount", (_, amount) => {
    render();
    const input = container.querySelector("input")!;
    type(input, amount);
    expect(click(payLink()).defaultPrevented).toBe(false);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("keeps Venmo closed and shows the error on the field for a bad amount", () => {
    render();
    const input = container.querySelector("input")!;
    type(input, "25.123");
    expect(container.querySelector("a")).toBeNull();
    const open = container.querySelector("button")!;
    expect(open.textContent).toBe("Open Venmo");
    click(open);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Enter dollars and cents, like 25 or 25.50."
    );
  });
});

describe("Venmo on a computer", () => {
  beforeEach(() => pointer(false));

  it("shows the handle, Copy and a QR code, with no amount field", () => {
    render();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("@gracechurch");
    expect(container.querySelector("button")?.textContent).toBe("Copy");
    expect(container.querySelector("svg[role=img] path")?.getAttribute("d")).toMatch(/^M/);
  });

  it("encodes the payment link with the fund name and no amount in the QR code", () => {
    vi.mocked(createQr).mockClear();
    render();
    expect(vi.mocked(createQr).mock.calls.map(([value]) => value)).toEqual([
      "https://venmo.com/gracechurch?txn=pay&note=Meals%20%26%20Care",
    ]);
  });
});

describe("Venmo before the pointer is known", () => {
  it("renders neither the amount field nor the QR code on the server", () => {
    const html = renderToString(
      createElement(MethodButton, { resolved: venmo, fundName: "Meals & Care" })
    );
    expect(html).toContain("@gracechurch");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<a");
  });
});

describe("other methods", () => {
  it("keep their own links", () => {
    pointer(true);
    render({ method: "paypal", handle: "grace", meta: PAYMENT_METHODS.paypal });
    expect(payLink().href).toBe("https://paypal.me/grace");
    expect(container.querySelector("input")).toBeNull();
  });
});
