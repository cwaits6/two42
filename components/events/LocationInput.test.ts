// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationInput } from "./LocationInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const prediction = (main: string, secondary: string, address: string) => ({
  text: { text: `${main}, ${secondary}` },
  mainText: { text: main },
  secondaryText: { text: secondary },
  toPlace: () => ({
    formattedAddress: address,
    fetchFields: vi.fn(async () => undefined),
  }),
});

const fetchSuggestions = vi.fn();
const changes: string[] = [];
let mounted: { root: Root; container: HTMLElement } | null = null;

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return createElement(LocationInput, {
    id: "location",
    name: "location",
    value,
    onChange: (next: string) => {
      changes.push(next);
      setValue(next);
    },
  });
}

function mount(initial = "") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Harness, { initial })));
  mounted = { root, container };
  return container.querySelector("input") as HTMLInputElement;
}

function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

function press(input: HTMLInputElement, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    input.dispatchEvent(event);
  });
  return event;
}

const options = () => [...document.querySelectorAll('[role="option"]')];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  changes.length = 0;
  fetchSuggestions.mockReset();
  fetchSuggestions.mockResolvedValue({
    suggestions: [
      { placePrediction: prediction("123 North Main Street", "Cumming, GA, USA", "123 N Main St, Cumming, GA 30041, USA") },
      { placePrediction: prediction("123 West Main Street", "Dallas, TX, USA", "123 W Main St, Dallas, TX 75201, USA") },
    ],
  });
  window.google = {
    maps: {
      importLibrary: async () => ({
        AutocompleteSessionToken: class {},
        AutocompleteSuggestion: { fetchAutocompleteSuggestions: fetchSuggestions },
      }),
    },
  };
});

afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  delete window.google;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LocationInput", () => {
  it("shows a saved location in the field", () => {
    expect(mount("Room 242").value).toBe("Room 242");
  });

  it("keeps typed text that nobody picked a suggestion for", async () => {
    const input = mount();
    type(input, "Room 242");
    await settle();
    expect(changes.at(-1)).toBe("Room 242");
    expect(input.value).toBe("Room 242");
  });

  it("lists suggestions and fills in the full address of the one picked", async () => {
    const input = mount();
    type(input, "123 Main");
    await settle();
    expect(options().map((o) => o.textContent)).toEqual([
      "123 North Main StreetCumming, GA, USA",
      "123 West Main StreetDallas, TX, USA",
    ]);

    await act(async () => {
      (options()[0] as HTMLElement).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(input.value).toBe("123 N Main St, Cumming, GA 30041, USA");
    expect(options()).toHaveLength(0);
  });

  it("does not ask Google until there are three characters", async () => {
    const input = mount();
    type(input, "12");
    await settle();
    expect(fetchSuggestions).not.toHaveBeenCalled();
  });

  it("asks once for a burst of typing", async () => {
    const input = mount();
    type(input, "123");
    type(input, "123 M");
    type(input, "123 Ma");
    await settle();
    expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchSuggestions.mock.calls[0][0].input).toBe("123 Ma");
  });

  it("ignores suggestions that arrive after the text has changed", async () => {
    let answer!: (value: unknown) => void;
    fetchSuggestions.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const input = mount();
    type(input, "123 Main");
    await settle();
    type(input, "12");
    await act(async () => {
      answer({ suggestions: [{ placePrediction: prediction("Stale", "Nowhere", "Stale") }] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(options()).toHaveLength(0);
  });

  it("stays closed when the answer arrives after leaving the field", async () => {
    let answer!: (value: unknown) => void;
    fetchSuggestions.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const input = mount();
    type(input, "123 Main");
    await settle();
    act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await act(async () => {
      answer({ suggestions: [{ placePrediction: prediction("Late", "Nowhere", "Late") }] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(options()).toHaveLength(0);
  });

  it("still fills in the full address when the field loses focus right after a pick", async () => {
    const input = mount();
    type(input, "123 Main");
    await settle();
    await act(async () => {
      (options()[0] as HTMLElement).click();
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(input.value).toBe("123 N Main St, Cumming, GA 30041, USA");
  });

  it("keeps the field usable when Google refuses the request", async () => {
    fetchSuggestions.mockRejectedValue(new Error("Requests from referer are blocked"));
    const input = mount();
    type(input, "123 Main");
    await settle();
    expect(options()).toHaveLength(0);
    expect(input.value).toBe("123 Main");
  });

  it("keeps the field usable when the Maps script never loads", async () => {
    delete window.google;
    const input = mount();
    type(input, "123 Main");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(options()).toHaveLength(0);
    expect(input.value).toBe("123 Main");
  });

  it("picks with the arrow keys and Enter", async () => {
    const input = mount();
    type(input, "123 Main");
    await settle();
    press(input, "ArrowDown");
    press(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[1].id);

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(input.value).toBe("123 W Main St, Dallas, TX 75201, USA");
  });

  it("leaves Enter to submit the form when no suggestion is highlighted", async () => {
    const input = mount();
    type(input, "123 Main");
    await settle();
    expect(press(input, "Enter").defaultPrevented).toBe(false);
    expect(input.value).toBe("123 Main");
  });

  it("closes the list on Escape and keeps the typed text", async () => {
    const input = mount();
    type(input, "123 Main");
    await settle();
    press(input, "Escape");
    expect(options()).toHaveLength(0);
    expect(input.value).toBe("123 Main");
  });
});
