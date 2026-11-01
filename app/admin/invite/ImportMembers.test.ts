import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const { ImportMembers } = await import("./ImportMembers");

describe("ImportMembers", () => {
  const html = renderToStaticMarkup(createElement(ImportMembers));

  it("makes the drop zone a native button, which Tab reaches and Enter or Space activates", () => {
    expect(html).toMatch(/<button type="button"[^>]*>[\s\S]*Choose a CSV file/);
  });

  it("keeps the file input itself out of the tab order", () => {
    expect(html).toMatch(/<input[^>]*type="file"[^>]*tabindex="-1"/i);
  });

  it("names no third-party product", () => {
    expect(html).not.toContain("Instant Church Directory");
  });
});
