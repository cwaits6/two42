// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const update = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (values: unknown) => {
        update(values);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));
vi.mock("@/lib/uploadImage", () => ({ mintSignedUrl: vi.fn(), uploadImage: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ProfileForm } = await import("./ProfileForm");

const profile: Profile = {
  id: "p1",
  first_name: "Ada",
  last_name: "Lovelace",
  preferred_name: null,
  role: "member",
  avatar_url: null,
  email: "ada@example.com",
  phone: null,
  phone_mobile: null,
  phone_home: null,
  phone_work: null,
  bio: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  birth_month: 12,
  birth_day: 10,
  birth_year: null,
  anniversary: null,
  occupation: null,
  employer: null,
  family_id: null,
  is_unlisted: false,
  hide_phone_mobile: false,
  hide_phone_home: false,
  hide_phone_work: false,
  hide_email: false,
  hide_address: false,
  hide_birthday: false,
  hide_anniversary: false,
  hide_occupation: false,
  hide_birth_year: false,
  relationship: "primary",
  email_announcements: true,
  setup_completed: true,
  approved_at: null,
  approved_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

let root: Root;

beforeEach(() => update.mockClear());

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

async function mount(overrides: Partial<Profile> = {}, props: { isAdmin?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(ProfileForm, { profile: { ...profile, ...overrides }, families: [], ...props })),
  );
  const field = (id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`No field #${id}`);
    return el;
  };
  return {
    field,
    message: (id: string) => {
      const describedBy = field(id).getAttribute("aria-describedby");
      return describedBy ? document.getElementById(describedBy)?.textContent : undefined;
    },
    async submit() {
      await act(async () => container.querySelector("form")!.requestSubmit());
    },
    async type(id: string, value: string) {
      const input = field(id) as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setValue.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
  };
}

describe("ProfileForm inline errors", () => {
  it("marks every invalid field beside itself and focuses the first one", async () => {
    const form = await mount({ first_name: "", postal_code: "12" });
    await form.submit();

    expect(form.field("first_name").getAttribute("aria-invalid")).toBe("true");
    expect(form.message("first_name")).toBe("Enter a first name.");
    expect(form.field("postal_code").getAttribute("aria-invalid")).toBe("true");
    expect(form.message("postal_code")).toBe("Enter a 5-digit ZIP code, or ZIP+4.");
    expect(document.activeElement).toBe(form.field("first_name"));
    expect(update).not.toHaveBeenCalled();
  });

  it("saves without a birthday", async () => {
    const form = await mount({ birth_month: null, birth_day: null });
    await form.submit();

    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ birth_month: null, birth_day: null, birth_year: null }),
    );
  });

  it("marks the day when a birthday has only its month", async () => {
    const form = await mount({ birth_month: 5, birth_day: null });
    await form.submit();

    expect(form.field("birth_day").getAttribute("aria-invalid")).toBe("true");
    expect(form.message("birth_day")).toBe("Enter the day of the birthday.");
    expect(document.activeElement).toBe(form.field("birth_day"));
    expect(update).not.toHaveBeenCalled();
  });

  it("marks a malformed email and an out-of-range birth year", async () => {
    const form = await mount({ email: "jane@", birth_year: 1850 }, { isAdmin: true });
    await form.submit();

    expect(form.field("email").getAttribute("aria-invalid")).toBe("true");
    expect(form.message("email")).toBe("Enter an email address like name@example.com.");
    expect(form.field("birth_year").getAttribute("aria-invalid")).toBe("true");
    expect(form.message("birth_year")).toBe(
      `Enter a year from 1900 to ${new Date().getFullYear()}, or leave it blank.`,
    );
    expect(document.activeElement).toBe(form.field("email"));
    expect(update).not.toHaveBeenCalled();
  });

  it("marks an email with an empty domain segment", async () => {
    const form = await mount({ email: "name@example..com" }, { isAdmin: true });
    await form.submit();

    expect(form.field("email").getAttribute("aria-invalid")).toBe("true");
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps a field's message when it is left without a change", async () => {
    const form = await mount({ first_name: "" });
    await form.submit();
    await act(async () => {
      form.field("first_name").focus();
      form.field("first_name").blur();
    });

    expect(form.field("first_name").getAttribute("aria-invalid")).toBe("true");
    expect(form.message("first_name")).toBe("Enter a first name.");
  });

  it("clears a field's message once it is edited", async () => {
    const form = await mount({ first_name: "", postal_code: "12" });
    await form.submit();
    await form.type("first_name", "Ada");

    expect(form.field("first_name").hasAttribute("aria-invalid")).toBe(false);
    expect(form.message("first_name")).toBeUndefined();
    expect(form.field("postal_code").getAttribute("aria-invalid")).toBe("true");
  });

  it("saves when every field is valid", async () => {
    const form = await mount();
    await form.submit();

    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(update).toHaveBeenCalledOnce();
  });
});
