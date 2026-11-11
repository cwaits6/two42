// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvatarCropStepProps } from "@/components/profile/AvatarCropStep";
import type { FamilyUnit, Profile } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const update = vi.fn();
const claimedUpdate = vi.fn();
const written = {
  rows: [{ id: "p1" }] as { id: string }[] | null,
  error: null as { code: string } | null,
  claimedError: null as { code: string } | null,
  // What the household record still holds after the clear: a policy can filter the write out.
  claimedKept: [] as { id: string }[],
  claimedReadError: null as { code: string } | null,
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) =>
      table === "family_members"
        ? {
            update: (values: unknown) => ({
              eq: async (column: string, id: string) => {
                claimedUpdate(values, column, id);
                return { error: written.claimedError };
              },
            }),
            select: () => ({
              eq: (column: string, id: string) => ({
                not: () => ({
                  limit: async () =>
                    column !== "claimed_profile_id" || id !== "p1"
                      ? { data: [], error: null }
                      : written.claimedReadError
                        ? { data: null, error: written.claimedReadError }
                        : { data: written.claimedKept, error: null },
                }),
              }),
            }),
          }
        : {
            update: (values: unknown) => {
              update(values);
              return { eq: () => ({ select: async () => ({ data: written.rows, error: written.error }) }) };
            },
          },
  }),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/uploadImage", () => ({ mintSignedUrl: vi.fn(), uploadImage: vi.fn() }));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("sonner", () => ({ toast }));
// Canvas and image decoding do not run in jsdom; the stand-in hands back a
// different file so a test can tell the cropped square from the picked one.
const cropped = new File(["square"], "avatar.jpg", { type: "image/jpeg" });
vi.mock("@/components/profile/AvatarCropStep", async () => {
  const { createElement: h } = await import("react");
  return {
    AvatarCropStep: ({ onSave, onClosed }: Pick<AvatarCropStepProps, "onSave" | "onClosed">) =>
      h(
        "div",
        { role: "dialog" },
        h("button", { type: "button", onClick: () => onClosed() }, "Cancel"),
        h("button", { type: "button", onClick: () => void onSave(cropped).then(onClosed) }, "Save photo"),
      ),
  };
});

const { ProfileForm } = await import("./ProfileForm");
const { uploadImage } = await import("@/lib/uploadImage");

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
  email_event_reminders: true,
  setup_completed: true,
  approved_at: null,
  approved_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  written.rows = [{ id: "p1" }];
  written.error = null;
  written.claimedError = null;
  written.claimedKept = [];
  written.claimedReadError = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

async function mount(
  overrides: Partial<Profile> = {},
  props: { isAdmin?: boolean; editingOther?: boolean; family?: FamilyUnit; onSaved?: () => void } = {},
) {
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
    async choose(id: string, option: string) {
      await act(async () => field(id).click());
      const found = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === option);
      if (!found) throw new Error(`No option ${option}`);
      await act(async () => (found as HTMLElement).click());
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

  it("refuses a name over 100 characters on its field, without saving", async () => {
    const form = await mount({ last_name: "a".repeat(101), preferred_name: "b".repeat(101) });
    await form.submit();

    expect(form.message("last_name")).toBe("Use 100 characters or fewer.");
    expect(form.message("preferred_name")).toBe("Use 100 characters or fewer.");
    expect(document.activeElement).toBe(form.field("last_name"));
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

  it("takes the day's message away with the month for No date", async () => {
    const form = await mount({ birth_month: 5, birth_day: null });
    await form.submit();
    await form.choose("birth_month", "No date");

    expect(form.field("birth_day").getAttribute("aria-invalid")).toBeNull();
    expect(form.message("birth_day")).toBeUndefined();
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
      "Everything you add here shows in the directory, except a birth year, which can only go into a phone contact someone saves. Leave out anything you don't want shown.",
    );
  });

  it("shows the notice to someone editing another household member, not to an admin", async () => {
    await mount({}, { editingOther: true });
    expect(document.body.textContent).toContain("Everything you add here shows in the directory, except a birth year, which can only go into a phone contact someone saves.");
    await act(async () => root.unmount());
    document.body.innerHTML = "";

    await mount({}, { isAdmin: true });
    expect(document.body.textContent).not.toContain("Everything you add here shows in the directory, except a birth year, which can only go into a phone contact someone saves.");
  });

  it("words the email setting for whoever the profile belongs to", async () => {
    await mount();
    expect(document.body.textContent).toContain("Hide my email from the directory");
    await act(async () => root.unmount());
    document.body.innerHTML = "";

    await mount({}, { isAdmin: true });
    expect(document.body.textContent).toContain("Hide email from the directory");
    expect(document.body.textContent).not.toContain("Hide my email");
  });

  it("leaves the Email field out for someone editing another household member", async () => {
    await mount({ email: null }, { editingOther: true });
    expect(document.querySelector("#email")).toBeNull();
    expect(document.querySelector("#hide_email")).not.toBeNull();
    await act(async () => root.unmount());
    document.body.innerHTML = "";

    await mount({}, { isAdmin: true });
    expect(document.querySelector("#email")).not.toBeNull();
    await act(async () => root.unmount());
    document.body.innerHTML = "";

    await mount();
    expect(document.querySelector("#email")).not.toBeNull();
  });

  it("shows initials from the preferred name, like the directory", async () => {
    await mount({ first_name: "Augusta", preferred_name: "Gussie", last_name: "Lovelace" });
    expect(document.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe("GL");
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

  it("reloads the frame after a save, and not after a refused one", async () => {
    const form = await mount();
    await form.type("first_name", "");
    await form.submit();
    expect(refresh).not.toHaveBeenCalled();

    await form.type("first_name", "Ada");
    await form.submit();
    expect(refresh).toHaveBeenCalledOnce();
  });

  async function pickPhoto() {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["x"], "face.png", { type: "image/png" })],
    });
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  }
  // Resolves once the crop step has closed, so the upload behind Save has settled.
  async function press(label: "Cancel" | "Save photo") {
    await act(async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
    });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  }

  it("uploads nothing until the crop step saves, and nothing on cancel", async () => {
    await mount();
    await pickPhoto();
    expect(uploadImage).not.toHaveBeenCalled();

    await press("Cancel");
    expect(uploadImage).not.toHaveBeenCalled();

    vi.mocked(uploadImage).mockResolvedValueOnce("org/profiles/p1/avatar.jpg");
    await pickPhoto();
    await press("Save photo");
    expect(uploadImage).toHaveBeenCalledExactlyOnceWith(cropped, "avatar", "profiles/p1/avatar");
  });

  it("reloads the frame after a photo upload, and not after a failed one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await mount();

    vi.mocked(uploadImage).mockRejectedValueOnce(new Error("refused"));
    await pickPhoto();
    await press("Save photo");
    expect(refresh).not.toHaveBeenCalled();

    vi.mocked(uploadImage).mockResolvedValueOnce("org/profiles/p1/avatar.png");
    await pickPhoto();
    await press("Save photo");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says the save failed when no row was written", async () => {
    written.rows = [];
    const onSaved = vi.fn();
    const form = await mount({}, { onSaved });
    await form.submit();

    expect(toast.error).toHaveBeenCalledWith("Couldn't save the profile. Try again.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("says the save failed when the write errors", async () => {
    written.rows = null;
    written.error = { code: "XX000" };
    const onSaved = vi.fn();
    const form = await mount({ birth_month: 12, birth_day: 10 }, { onSaved });
    await form.choose("birth_month", "No date");
    await form.submit();

    expect(toast.error).toHaveBeenCalledWith("Couldn't save the profile. Try again.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("leaves the claimed household record alone when the profile had no birthday to clear", async () => {
    const form = await mount({ birth_month: null, birth_day: null, birth_year: null });
    await form.submit();

    expect(toast.success).toHaveBeenCalledWith("Profile saved.");
    expect(claimedUpdate).not.toHaveBeenCalled();
  });

  it("leaves the claimed household record alone when the birthday is kept", async () => {
    const form = await mount();
    await form.submit();

    expect(toast.success).toHaveBeenCalledWith("Profile saved.");
    expect(claimedUpdate).not.toHaveBeenCalled();
  });

  it("keeps the profile's birthday when the claimed household record's can't be cleared, so a later save retries", async () => {
    written.claimedError = { code: "XX000" };
    const onSaved = vi.fn();
    const form = await mount({ birth_month: 12, birth_day: 10 }, { onSaved });
    await form.choose("birth_month", "No date");
    await form.submit();

    expect(toast.error).toHaveBeenCalledWith("Couldn't save the profile. Try again.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("says the save failed when the claimed household record can't be read back", async () => {
    written.claimedReadError = { code: "XX000" };
    const form = await mount({ birth_month: 12, birth_day: 10 });
    await form.choose("birth_month", "No date");
    await form.submit();

    expect(toast.error).toHaveBeenCalledWith("Couldn't save the profile. Try again.");
    expect(update).not.toHaveBeenCalled();
  });

  it("saves the profile and says the household still lists the birthday when the record's clear wrote nothing", async () => {
    written.claimedKept = [{ id: "fm1" }];
    const onSaved = vi.fn();
    const form = await mount({ birth_month: 12, birth_day: 10 }, { onSaved });
    await form.choose("birth_month", "No date");
    await form.submit();

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ birth_month: null }));
    expect(toast.info).toHaveBeenCalledWith(
      "Profile saved. The household still lists this birthday. A church admin can remove it.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("clears the whole birthday for No date, on the profile and the household record it claimed", async () => {
    const form = await mount({ birth_month: 12, birth_day: 10, birth_year: 1990 });
    await form.choose("birth_month", "No date");

    expect((form.field("birth_day") as HTMLInputElement).value).toBe("");
    expect((form.field("birth_year") as HTMLInputElement).value).toBe("");
    expect(form.field("birth_month").querySelector('[data-slot="select-value"]')?.textContent).toBe("Month");

    await form.submit();
    const cleared = { birth_month: null, birth_day: null, birth_year: null };
    expect(update).toHaveBeenCalledWith(expect.objectContaining(cleared));
    expect(claimedUpdate).toHaveBeenCalledWith(cleared, "claimed_profile_id", "p1");
    expect(claimedUpdate.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
    expect(toast.success).toHaveBeenCalledWith("Profile saved.");
  });
});

describe("ProfileForm copy about the person", () => {
  const household = { family_name: "Lovelace family", address_line1: "1 Main St" } as FamilyUnit;
  const own = [
    "My last name is different from my household's (Lovelace)",
    "My address is different from my household's",
    "Sharing what you do helps people in your groups find help from someone they know.",
  ];

  it("speaks to a person on their own profile", async () => {
    await mount({}, { family: household });
    for (const copy of own) expect(document.body.textContent).toContain(copy);
  });

  it("speaks about the person to a household member editing them", async () => {
    await mount({}, { editingOther: true });
    for (const copy of own) expect(document.body.textContent).not.toContain(copy);
    expect(document.body.textContent).toContain(
      "Sharing what they do helps people in their groups find help from someone they know.",
    );
  });

  it("speaks about the person to a church admin", async () => {
    await mount({}, { isAdmin: true });
    expect(document.body.textContent).toContain(
      "Sharing what they do helps people in their groups find help from someone they know.",
    );
    expect(document.body.textContent).not.toMatch(/\b(you|your|my)\b/i);
  });
});
