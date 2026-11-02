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
  occupation: null,
  employer: null,
  family_id: null,
  is_unlisted: false,
  hide_email: false,
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

async function mount(overrides: Partial<Profile> = {}, props: { isAdmin?: boolean; editingOther?: boolean } = {}) {
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

  it("saves with only a name and email, showing neither a phone nor the email", async () => {
    const form = await mount({ birth_month: null, birth_day: null, hide_email: true });
    await form.submit();

    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ phone_mobile: null, hide_email: true }));
  });

  it("writes hide_email and no retired hide setting or anniversary", async () => {
    const form = await mount();
    await form.submit();

    const payload = update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).filter((key) => key.startsWith("hide_"))).toEqual(["hide_email"]);
    expect(payload).not.toHaveProperty("anniversary");
  });

  it("offers no hide setting but the email one, with the notice above the fields", async () => {
    await mount({ phone_home: "+15125550134", occupation: "Teacher", city: "Austin" });

    const hideBoxes = [...document.querySelectorAll('input[type="checkbox"], button[role="checkbox"]')]
      .map((box) => box.id)
      .filter((id) => id.startsWith("hide_"));
    expect(hideBoxes).toEqual(["hide_email"]);
    expect(document.body.textContent).toContain(
      "Everything you add here shows in the directory. Leave out anything you don't want shown.",
    );
  });

  it("shows the notice to someone editing another household member, not to an admin", async () => {
    await mount({}, { editingOther: true });
    expect(document.body.textContent).toContain("Everything you add here shows in the directory.");
    await act(async () => root.unmount());
    document.body.innerHTML = "";

    await mount({}, { isAdmin: true });
    expect(document.body.textContent).not.toContain("Everything you add here shows in the directory.");
  });

  it("makes an admin enter an email", async () => {
    const form = await mount({ email: "" }, { isAdmin: true });
    await form.submit();

    expect(form.message("email")).toBe("Enter an email address.");
    expect(update).not.toHaveBeenCalled();
  });

  it("doesn't ask a member for an email, which isn't theirs to edit here", async () => {
    const form = await mount({ email: "" });
    await form.submit();

    expect(update).toHaveBeenCalledOnce();
  });

  it("resets a retired flag only for a number that replaced the hidden one", async () => {
    const form = await mount({ phone_mobile: "+15125550100", phone_work: "+15125550111" });
    await form.type("phone_mobile", "(512) 555-0199");
    await form.submit();

    const written = update.mock.calls[0][0];
    expect(written.hide_phone_mobile).toBe(false);
    expect(written).not.toHaveProperty("hide_phone_work");
  });

  it("saves when every field is valid", async () => {
    const form = await mount();
    await form.submit();

    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(update).toHaveBeenCalledOnce();
  });
});
