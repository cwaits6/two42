// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/ui/dialog", () => {
  const passthrough = (tag: string) =>
    function Part({ children }: { children?: ReactNode }) {
      return createElement(tag, null, children);
    };
  return {
    // Honours `open`, as the real dialog does: a closed dialog has no fields.
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? createElement("div", null, children) : null,
    DialogContent: passthrough("div"),
    DialogHeader: passthrough("div"),
    DialogTitle: passthrough("h2"),
    DialogFooter: passthrough("div"),
  };
});

const { OrganizationsList } = await import("./OrganizationsList");

let root: Root;
let container: HTMLElement;
const fetchSpy = vi.fn<typeof fetch>();

beforeEach(async () => {
  toast.error.mockReset();
  toast.success.mockReset();
  refresh.mockReset();
  push.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(OrganizationsList, { initialOrgs: [] })));
  await click("Add organization");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

async function type(id: string, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(field(id), value);
    field(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The last button with this label: the dialog's own, where the page has one too. */
async function click(label: string) {
  const buttons = [...container.querySelectorAll("button")].filter((b) => b.textContent === label);
  await act(async () => buttons[buttons.length - 1].click());
}

const submit = () => click("Add organization");

/** What the field's aria-describedby pointed at when focus landed on it. */
function describedByAtFocus(id: string): () => string | null {
  let seen: string | null = null;
  field(id).addEventListener("focus", () => {
    seen = field(id).getAttribute("aria-describedby");
  });
  return () => seen;
}

describe("Add organization dialog", () => {
  it("marks both empty fields, focuses the first, and sends nothing", async () => {
    const nameDescribedBy = describedByAtFocus("org-name");

    await submit();

    expect(field("org-name").getAttribute("aria-invalid")).toBe("true");
    expect(field("org-owner-email").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("org-name-error")?.textContent).toBe("Enter the organization's name.");
    expect(document.getElementById("org-owner-email-error")?.textContent).toBe(
      "Enter the first admin's email.",
    );
    expect(document.activeElement).toBe(field("org-name"));
    expect(nameDescribedBy()).toBe("org-name-error");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("clears a field's message once it is edited", async () => {
    await submit();

    await type("org-name", "Grace Chapel");

    expect(field("org-name").hasAttribute("aria-invalid")).toBe(false);
    expect(document.getElementById("org-name-error")).toBeNull();
    expect(document.getElementById("org-owner-email-error")).not.toBeNull();
  });

  it("marks the first admin's email when the server refuses it", async () => {
    const refusal = "That email already belongs to another organization.";
    fetchSpy.mockResolvedValue(Response.json({ error: refusal }, { status: 409 }));
    await type("org-name", "Grace Chapel");
    await type("org-owner-email", "admin@gracechapel.org");
    const emailDescribedBy = describedByAtFocus("org-owner-email");

    await submit();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(document.getElementById("org-owner-email-error")?.textContent).toBe(refusal);
    expect(field("org-owner-email").getAttribute("aria-invalid")).toBe("true");
    expect(field("org-name").hasAttribute("aria-invalid")).toBe(false);
    expect(document.activeElement).toBe(field("org-owner-email"));
    expect(emailDescribedBy()).toBe("org-owner-email-error");
  });

  it("still reports a refused email when the dialog closed before the answer", async () => {
    const refusal = "That email already belongs to another organization.";
    let respond!: (response: Response) => void;
    fetchSpy.mockReturnValue(new Promise<Response>((resolve) => (respond = resolve)));
    await type("org-name", "Grace Chapel");
    await type("org-owner-email", "admin@gracechapel.org");
    await submit();

    await click("Cancel");
    expect(container.querySelector("#org-owner-email")).toBeNull();
    await act(async () => respond(Response.json({ error: refusal }, { status: 409 })));

    expect(toast.error).toHaveBeenCalledWith(refusal);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("leaves a reopened dialog alone when the answer to an earlier submit arrives", async () => {
    let respond!: (response: Response) => void;
    fetchSpy.mockReturnValue(new Promise<Response>((resolve) => (respond = resolve)));
    await type("org-name", "Grace Chapel");
    await type("org-owner-email", "admin@gracechapel.org");
    await submit();
    await click("Cancel");

    await click("Add organization");
    await type("org-name", "Hope Fellowship");
    await act(async () =>
      respond(Response.json({ success: true, orgId: "o", inviteSent: true }, { status: 200 })),
    );

    expect(toast.success).toHaveBeenCalledWith(
      "Grace Chapel added. Invite sent to admin@gracechapel.org.",
    );
    expect(refresh).toHaveBeenCalled();
    expect(field("org-name").value).toBe("Hope Fellowship");
  });

  it("does not mark a reopened dialog's email with an earlier submit's refusal", async () => {
    const refusal = "That email already belongs to another organization.";
    let respond!: (response: Response) => void;
    fetchSpy.mockReturnValue(new Promise<Response>((resolve) => (respond = resolve)));
    await type("org-name", "Grace Chapel");
    await type("org-owner-email", "admin@gracechapel.org");
    await submit();
    await click("Cancel");

    await click("Add organization");
    await act(async () => respond(Response.json({ error: refusal }, { status: 409 })));

    expect(toast.error).toHaveBeenCalledWith(refusal);
    expect(document.getElementById("org-owner-email-error")).toBeNull();
    expect(field("org-owner-email").hasAttribute("aria-invalid")).toBe(false);
  });

  it("returns focus to the first invalid field on a second failed submit", async () => {
    await submit();
    field("org-name").blur();
    expect(document.activeElement).not.toBe(field("org-name"));

    await submit();

    expect(document.activeElement).toBe(field("org-name"));
  });

  it("reports a failure that is not about a field in a toast", async () => {
    fetchSpy.mockResolvedValue(Response.json({ error: "boom" }, { status: 500 }));
    await type("org-name", "Grace Chapel");
    await type("org-owner-email", "admin@gracechapel.org");

    await submit();

    expect(toast.error).toHaveBeenCalledWith("Couldn't add the organization. Try again.");
    expect(document.getElementById("org-owner-email-error")).toBeNull();
  });

  it("says the invite was sent, to the address it was sent to", async () => {
    fetchSpy.mockResolvedValue(
      Response.json({ success: true, orgId: "org-9", inviteSent: true }, { status: 200 }),
    );
    await type("org-name", "Grace Chapel");
    await type("org-owner-email", " Admin@GraceChapel.ORG ");

    await submit();

    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toEqual({
      name: "Grace Chapel",
      ownerEmail: "admin@gracechapel.org",
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Grace Chapel added. Invite sent to admin@gracechapel.org.",
    );
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("opens the church page when the church was added but the invite wasn't sent", async () => {
    fetchSpy.mockResolvedValue(
      Response.json({ success: true, orgId: "org-9", inviteSent: false }, { status: 200 }),
    );
    await type("org-name", "Grace Chapel");
    await type("org-owner-email", "admin@gracechapel.org");

    await submit();

    expect(toast.error).toHaveBeenCalledWith("Grace Chapel added. The invite wasn't sent.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/platform/organizations/org-9");
  });

  it("stays on a reopened dialog when an earlier church was added but its invite wasn't sent", async () => {
    let respond!: (response: Response) => void;
    fetchSpy.mockReturnValue(new Promise<Response>((resolve) => (respond = resolve)));
    await type("org-name", "Grace Chapel");
    await type("org-owner-email", "admin@gracechapel.org");
    await submit();
    await click("Cancel");

    await click("Add organization");
    await type("org-name", "Hope Fellowship");
    await act(async () =>
      respond(Response.json({ success: true, orgId: "org-9", inviteSent: false }, { status: 200 })),
    );

    expect(toast.error).toHaveBeenCalledWith("Grace Chapel added. The invite wasn't sent.");
    expect(push).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(field("org-name").value).toBe("Hope Fellowship");
  });

  it("posts once when Add organization is pressed twice before the answer", async () => {
    let respond!: (response: Response) => void;
    fetchSpy.mockReturnValue(new Promise<Response>((resolve) => (respond = resolve)));
    await type("org-name", "Grace Chapel");
    await type("org-owner-email", "admin@gracechapel.org");
    const button = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent === "Add organization",
    ).at(-1)!;

    await act(async () => {
      button.click();
      button.click();
    });
    await act(async () =>
      respond(Response.json({ success: true, orgId: "org-9", inviteSent: true }, { status: 200 })),
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
