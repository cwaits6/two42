import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_PATTERNS, pagePattern, patternOnly, patternUrl } from "./pagePattern";

const ORIGIN = "https://two42.io";
const TAIL = "?next=/x&email=a@b.co#frag";

function pagesUnder(dir: string, route: string[] = []): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      const isRouteGroup = entry.name.startsWith("(");
      return pagesUnder(join(dir, entry.name), isRouteGroup ? route : [...route, entry.name]);
    }
    return entry.name === "page.tsx" ? ["/" + route.join("/")] : [];
  });
}

const derived = pagesUnder(join(process.cwd(), "app")).sort();

function sampleOf(pattern: string) {
  const ids: string[] = [];
  const path = pattern.replace(/\[[^\]]+\]/g, () => {
    const id = `${String(ids.length + 1).repeat(8)}-aaaa-4bbb-8ccc-${String(ids.length + 1).repeat(12)}`;
    ids.push(id);
    return id;
  });
  return { path, ids };
}

describe("PAGE_PATTERNS", () => {
  it("lists exactly the pages under app/", () => {
    expect([...PAGE_PATTERNS].sort()).toEqual(derived);
  });

  it("holds no catch-all segment, which the matcher cannot place", () => {
    expect(derived.filter((p) => p.includes("[..."))).toEqual([]);
  });
});

describe("pagePattern", () => {
  it.each(derived)("reduces an address under %s to the pattern", (pattern) => {
    const { path, ids } = sampleOf(pattern);
    expect(pagePattern(path)).toBe(pattern);

    const sent = patternUrl(ORIGIN + path + TAIL);
    expect(sent).toBe(ORIGIN + pattern);
    for (const id of ids) expect(sent).not.toContain(id);
    expect(sent).not.toMatch(/[?#]/);
  });

  it.each([
    ["/join/Zk3-secret-invite-token", "/join/[token]"],
    ["/join/family/Zk3-secret-household-token", "/join/family/[token]"],
    [
      "/g/11111111-aaaa-4bbb-8ccc-111111111111/calendar/22222222-aaaa-4bbb-8ccc-222222222222",
      "/g/[groupId]/calendar/[id]",
    ],
    ["/admin/members/33333333-aaaa-4bbb-8ccc-333333333333", "/admin/members/[id]"],
    ["/login", "/login"],
    ["/serving/go", "/serving/go"],
    ["/dashboard/", "/dashboard"],
    ["/", "/"],
  ])("maps %s to %s", (path, pattern) => {
    expect(pagePattern(path)).toBe(pattern);
    expect(patternUrl(ORIGIN + path + "?token=abc123&next=/g/9#top")).toBe(ORIGIN + pattern);
  });

  it("prefers a static segment over a dynamic one", () => {
    expect(pagePattern("/g/11111111-aaaa-4bbb-8ccc-111111111111/calendar/new")).toBe(
      "/g/[groupId]/calendar/new",
    );
  });

  it.each([
    "/api/join/Zk3-secret-invite-token",
    "/nope",
    "/g/11111111-aaaa-4bbb-8ccc-111111111111/unknown",
    "/_next/static/x.js",
    "/join/a/b/c",
  ])("sends nothing for %s, which is no page", (path) => {
    expect(pagePattern(path)).toBeNull();
    expect(patternUrl(ORIGIN + path)).toBeNull();
    expect(patternOnly({ type: "pageview", url: ORIGIN + path })).toBeNull();
  });

  it("sends nothing for an address it cannot parse", () => {
    expect(patternUrl("not a url")).toBeNull();
    expect(patternUrl(ORIGIN + "/join/%E0%A4%A")).toBeNull();
  });

  it("keeps an address that is already a pattern, and drops its hash", () => {
    expect(patternUrl(ORIGIN + "/join/[token]#frag")).toBe(ORIGIN + "/join/[token]");
    expect(patternUrl(ORIGIN + "/join/%5Btoken%5D")).toBe(ORIGIN + "/join/[token]");
  });
});

describe("patternOnly", () => {
  it("rewrites the event's address and keeps its other fields", () => {
    expect(
      patternOnly({ type: "pageview", url: ORIGIN + "/join/family/Zk3-secret?email=a@b.co#x" }),
    ).toEqual({ type: "pageview", url: ORIGIN + "/join/family/[token]" });
  });
});
