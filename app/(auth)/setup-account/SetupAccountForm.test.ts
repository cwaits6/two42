// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupLink } from "@/app/api/auth/setup-response";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getSession = vi.fn(async () => ({ data: { session: null } }));
const signInWithPassword = vi.fn(async () => ({ error: null as { code: string } | null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession, signInWithPassword } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const router = { replace: vi.fn(), refresh: vi.fn() };
let query = "token=abc";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => router,
}));

const { SetupAccountForm } = await import("./SetupAccountForm");
const { SETUP_STATUS } = await import("@/app/api/auth/setup-response");

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  query = "token=abc";
  router.replace.mockReset();
  signInWithPassword.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(fetchImpl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  await act(async () => root.render(createElement(SetupAccountForm)));
}

describe("SetupAccountForm verification", () => {
  it("offers a retry when the request never gets an answer", async () => {
    await render(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(container.textContent).toContain("Couldn't load this signup link");
  });

  it("checks the link again on Try again and shows the form once it answers", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        Response.json({ name: "Ada", email: "ada@example.com" } satisfies SetupLink),
      );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(SetupAccountForm)));

    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    await act(async () => retry!.click());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLInputElement>("#email")?.value).toBe("ada@example.com");
  });

  it("hides the previous link's church while a new link is checked, and ignores its late answer", async () => {
    let answerFirst!: (res: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ name: "Ada", email: "ada@example.com", shareWith: "First Church" }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => (answerFirst = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(SetupAccountForm)));
    expect(container.textContent).toContain("First Church");

    query = "token=def";
    await act(async () => root.render(createElement(SetupAccountForm)));
    expect(container.textContent).not.toContain("First Church");
    expect(container.querySelector("#share_details")).toBeNull();

    query = "token=ghi";
    fetchMock.mockResolvedValueOnce(Response.json({ name: "Bo", email: "bo@example.com", shareWith: "Third Church" }));
    await act(async () => root.render(createElement(SetupAccountForm)));
    await act(async () => answerFirst(Response.json({ name: "Ada", email: "ada@example.com", shareWith: "Second Church" })));
    expect(container.textContent).toContain("Third Church");
    expect(container.textContent).not.toContain("Second Church");
  });

  it("offers a retry when the answer is not readable", async () => {
    await render(async () => new Response("<html>", { status: 200 }));
    expect(container.textContent).toContain("Couldn't load this signup link");
  });

  it("offers a retry when the session check fails on a used link", async () => {
    getSession.mockRejectedValueOnce(new Error("storage unavailable"));
    await render(async () => new Response(null, { status: 404 }));
    expect(container.textContent).toContain("Couldn't load this signup link");
  });

  it.each([404, 410])("shows the one dead-link message for a %i with no session", async (status) => {
    await render(async () => new Response(null, { status }));
    expect(container.textContent).toContain("This link isn't valid anymore");
    expect(container.textContent).toContain(
      "If you already set up your account, sign in. Otherwise ask your church admin for a new link.",
    );
    const signIn = [...container.querySelectorAll("a")].find((a) => a.textContent === "sign in");
    expect(signIn?.getAttribute("href")).toBe("/login");
  });
});

const LINK = Response.json({ name: "Ada", email: "ada@example.com" } satisfies SetupLink);
const PASSWORD = "correct horse battery";

async function submitWith(answer: Response) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(LINK.clone())
    .mockResolvedValueOnce(answer);
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(createElement(SetupAccountForm)));
  for (const id of ["password", "confirmPassword"]) {
    container.querySelector<HTMLInputElement>(`#${id}`)!.value = PASSWORD;
  }
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  return fetchMock;
}

const signInHref = () =>
  [...container.querySelectorAll("a")].find((a) => a.textContent === "Sign in")?.getAttribute("href");

describe("SetupAccountForm used links", () => {
  it("says the account is already set up and offers Sign in", async () => {
    await render(async () => Response.json({ status: SETUP_STATUS.setUp }, { status: 409 }));
    expect(container.textContent).toContain("Your account is already set up");
    expect(signInHref()).toBe("/login");
  });

  it("sends a signed-in viewer of a used link Home", async () => {
    getSession.mockResolvedValueOnce({ data: { session: {} } } as never);
    await render(async () => Response.json({ status: SETUP_STATUS.setUp }, { status: 409 }));
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });
});

describe("SetupAccountForm submit", () => {
  it("creates the account on the server, signs in and lands in the group", async () => {
    const fetchMock = await submitWith(Response.json({ redirect: "/g/group-1/dashboard" }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/setup-account",
      expect.objectContaining({ body: JSON.stringify({ token: "abc", password: PASSWORD }) }),
    );
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "ada@example.com", password: PASSWORD });
    expect(router.replace).toHaveBeenCalledWith("/g/group-1/dashboard");
  });

  it("never follows a redirect off the site", async () => {
    await submitWith(Response.json({ redirect: "https://evil.example/x" }));
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("offers Sign in when another account already uses the email", async () => {
    await submitWith(Response.json({ status: SETUP_STATUS.accountExists }, { status: 409 }));
    expect(container.textContent).toContain("An account already uses this email.");
    expect(signInHref()).toBe("/login");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("shows the already-set-up view when the link was used meanwhile", async () => {
    await submitWith(Response.json({ status: SETUP_STATUS.setUp }, { status: 409 }));
    expect(container.textContent).toContain("Your account is already set up");
  });

  it("keeps the form open for a retry when the server fails", async () => {
    await submitWith(Response.json({ error: "Couldn't create your account." }, { status: 500 }));
    expect(container.textContent).toContain("Couldn't create your account.");
    const button = container.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(button.disabled).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("offers Sign in back to the group when sign-in fails after the account exists", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { code: "unexpected_failure" } });
    await submitWith(Response.json({ redirect: "/g/group-1/dashboard" }));
    expect(container.textContent).toContain("Your account is set up");
    expect(signInHref()).toBe(`/login?redirect=${encodeURIComponent("/g/group-1/dashboard")}`);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("SetupAccountForm sharing details with the church office", () => {
  async function submitShared(link: SetupLink, tick: boolean) {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(link))
      .mockResolvedValueOnce(Response.json({ redirect: "/dashboard" }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(SetupAccountForm)));
    const box = container.querySelector<HTMLInputElement>("#share_details");
    if (tick) await act(async () => box!.click());
    for (const id of ["password", "confirmPassword"]) {
      container.querySelector<HTMLInputElement>(`#${id}`)!.value = PASSWORD;
    }
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    return { box, body: JSON.parse(fetchMock.mock.calls[1][1].body as string) };
  }

  it("shows the box unticked, with the church's name, only when the church asks", async () => {
    await render(async () => Response.json({ name: "Ada", email: "ada@example.com", shareWith: "Sample Church" }));
    const box = container.querySelector<HTMLInputElement>("#share_details");
    expect(box?.checked).toBe(false);
    expect(container.textContent).toContain("Share my details with Sample Church's office");
  });

  it("has no box when the church doesn't send new people", async () => {
    await render(async () => Response.json({ name: "Ada", email: "ada@example.com" }));
    expect(container.querySelector("#share_details")).toBeNull();
  });

  it("sends the person's choice with the password", async () => {
    const link = { name: "Ada", email: "ada@example.com", shareWith: "Sample Church" };
    expect((await submitShared(link, true)).body.share).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    expect((await submitShared(link, false)).body.share).toBe(false);
  });
});
