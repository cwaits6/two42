// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FamilyUnit, Profile } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/uploadImage", () => ({ mintSignedUrl: vi.fn(), uploadImage: vi.fn() }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { HouseholdClient } = await import("./HouseholdClient");
const { householdFieldErrors } = await import("@/app/api/household/householdUpdates");

const ME = { id: "me", first_name: "Ada", last_name: "Okafor", relationship: "primary" } as Profile;
const FAMILY = {
  id: "f1",
  family_name: "Okafor",
  state: "TX",
  postal_code: "78701",
  anniversary_month: 10,
  anniversary_day: 3,
  anniversary_year: 2009,
} as FamilyUnit;

let root: Root;
const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

async function mount(family = FAMILY, householdProfiles: Profile[] = []) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(HouseholdClient, {
        currentProfile: ME,
        family,
        initialFamilyMembers: [],
        householdProfiles,
        onEditSelf: () => {},
      }),
    );
  });
}

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const message = (id: string) => {
  const describedBy = field(id).getAttribute("aria-describedby");
  return describedBy ? document.getElementById(describedBy)?.textContent : undefined;
};
async function type(id: string, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(field(id), value);
    field(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function chooseNoDate() {
  await act(async () => field("anniversary_month").click());
  const noDate = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === "No date");
  await act(async () => (noDate as HTMLElement).click());
}
const save = () => act(async () => document.querySelector("form")!.requestSubmit());
const savedBody = () =>
  JSON.parse((fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1].body as string);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("saving household details", () => {
  it("marks an invalid state and ZIP on their fields, focuses the first, and sends nothing", async () => {
    await mount();
    await type("state", "ZZ");
    await type("postal_code", "12");
    await save();

    expect(field("state").getAttribute("aria-invalid")).toBe("true");
    expect(message("state")).toBe("Enter a 2-letter state, like TX.");
    expect(field("postal_code").getAttribute("aria-invalid")).toBe("true");
    expect(message("postal_code")).toBe("Enter a 5-digit ZIP code, or ZIP+4.");
    expect(document.activeElement).toBe(field("state"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("marks a blank household name, and clears the message once it is edited", async () => {
    await mount();
    await type("family_name", " ");
    await save();
    expect(message("family_name")).toBe("Enter a household name.");
    expect(document.activeElement).toBe(field("family_name"));

    await type("family_name", "Okafor");
    expect(field("family_name").hasAttribute("aria-invalid")).toBe(false);
  });

  it("marks an invalid home phone on its field and sends nothing", async () => {
    await mount();
    await type("phone_home", "12");
    await save();

    expect(field("phone_home").getAttribute("aria-invalid")).toBe("true");
    expect(message("phone_home")).toBe("Enter a valid phone number.");
    expect(document.activeElement).toBe(field("phone_home"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't judge or send a home phone hidden behind a spouse's number", async () => {
    const spouse = { id: "sp", first_name: "Obi", last_name: "Okafor", relationship: "spouse" } as Profile;
    await mount({ ...FAMILY, phone_home: "555-0105", phone_profile_id: "sp" }, [spouse]);
    expect(field("phone_home")).toBeNull();
    await save();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(savedBody()).not.toHaveProperty("phone_home");
  });

  it("marks fields in the order the shared rule lists them, so focus lands on the first on screen", async () => {
    await mount();
    await type("family_name", " ");
    await type("state", "ZZ");
    await type("postal_code", "12");
    await type("phone_home", "12");
    await type("anniversary_day", "");
    await type("anniversary_year", "1800");
    await save();

    const marked = [...document.querySelectorAll('[aria-invalid="true"]')].map((el) => el.id);
    expect(marked).toEqual(
      Object.keys(
        householdFieldErrors({
          family_name: " ",
          state: "ZZ",
          postal_code: "12",
          phone_home: "12",
          anniversary_month: "10",
          anniversary_day: "",
          anniversary_year: "1800",
        }),
      ),
    );
    expect(marked).toHaveLength(6);
    expect(document.activeElement).toBe(field("family_name"));
  });

  it("still marks a month with no day", async () => {
    await mount();
    await type("anniversary_day", "");
    await save();

    expect(message("anniversary_day")).toBe("Enter the day of the anniversary.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes a date's message away with the date for No date", async () => {
    await mount();
    await type("anniversary_day", "");
    await save();
    expect(field("anniversary_day").getAttribute("aria-invalid")).toBe("true");

    await chooseNoDate();
    expect(field("anniversary_day").hasAttribute("aria-invalid")).toBe(false);
    expect(document.body.textContent).not.toContain("Enter the day of the anniversary.");
  });

  it("moves focus back to the first invalid field when a second save finds the same one", async () => {
    await mount();
    await type("state", "ZZ");
    await save();
    await act(async () => field("postal_code").focus());
    await save();

    expect(document.activeElement).toBe(field("state"));
  });

  it("clears the anniversary for No date", async () => {
    await mount();
    await chooseNoDate();
    await save();

    expect(savedBody()).toMatchObject({ anniversary_month: "", anniversary_day: "", anniversary_year: "" });
    expect(toast.success).toHaveBeenCalledWith("Household saved.");
  });

  it("says the save failed when the server refuses it or can't be reached", async () => {
    await mount();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await save();
    expect(toast.error).toHaveBeenLastCalledWith("Couldn't save the household. Try again.");

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await save();
    expect(toast.error).toHaveBeenLastCalledWith(
      "Couldn't save the household. Check your connection and try again.",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
