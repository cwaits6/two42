import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildAccount } from "./account";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));

const { AccountBlock } = await import("./AccountBlock");

const member = buildAccount({
  profile: { first_name: "Isaac", last_name: "Seedly", preferred_name: null, role: "member" },
  email: "isaac@example.test",
  isOperator: false,
  photoUrl: null,
});
const operator = buildAccount({ profile: null, email: "platform@local.dev", isOperator: true, photoUrl: null });

const render = (props: Parameters<typeof AccountBlock>[0]) =>
  renderToStaticMarkup(createElement(AccountBlock, props));

describe("AccountBlock", () => {
  it("shows a member's initials and name on one button that says who is signed in", () => {
    const html = render({ account: member });
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Account menu. Signed in as Isaac Seedly"');
    expect(html).toContain(">IS<");
    expect(html).toContain(">Isaac Seedly<");
  });

  it("names an operator with no church by their sign-in address", () => {
    const html = render({ account: operator });
    expect(html).toContain('aria-label="Account menu. Signed in as platform@local.dev"');
    expect(html).toContain(">P<");
  });

  it("keeps the name on the button when collapsed to the photo or initials", () => {
    const html = render({ account: member, collapsed: true });
    expect(html).toContain('aria-label="Account menu. Signed in as Isaac Seedly"');
    expect(html).toContain(">IS<");
    expect(html).not.toContain(">Isaac Seedly<");
  });

  it("keeps the menu closed until asked", () => {
    expect(render({ account: member })).not.toContain("Sign out");
  });
});
