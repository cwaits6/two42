import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let result: { data: unknown[] | null; error: { code: string; message: string } | null };
let leaderResult: { data: unknown[] | null; error: { code: string; message: string } | null };
let leaderReads: number;
let leaderFilter: string | undefined;
let role: "leader" | "member" = "leader";

function query() {
  let publishedOnly = false;
  const chain = {
    select: () => chain,
    eq: () => chain,
    or: (filter: string) => {
      leaderFilter = filter;
      return chain;
    },
    lte: () => {
      publishedOnly = true;
      return chain;
    },
    order: () => {
      if (publishedOnly) return Promise.resolve(result);
      leaderReads += 1;
      return Promise.resolve(leaderResult);
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => query() }),
}));
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: async (id: string) => ({ id, name: "Grace", role }),
}));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/New_York" }));
vi.mock("@/components/states/ErrorState", () => ({ ErrorState: () => null }));
vi.mock("@/components/announcements/AnnouncementCard", () => ({ AnnouncementCard: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));

const { PageHeader } = await import("@/components/layout/PageHeader");
const { ErrorState } = await import("@/components/states/ErrorState");
const { EmptyState } = await import("@/components/states/EmptyState");
const { AnnouncementCard } = await import("@/components/announcements/AnnouncementCard");
const { default: AnnouncementsPage } = await import("./page");

function flatten(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    node.forEach((n) => flatten(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as ReactElement<{ children?: ReactNode }>;
  out.push(element);
  flatten(element.props.children, out);
  return out;
}

async function rendered() {
  const element = await AnnouncementsPage({ params: Promise.resolve({ groupId: "g1" }) });
  return flatten(element);
}

async function renderedTypes() {
  return (await rendered()).map((e) => e.type);
}

async function emptyStateAction() {
  const empty = (await rendered()).find((e) => e.type === EmptyState) as
    | ReactElement<{ action?: ReactNode }>
    | undefined;
  return empty?.props.action;
}

async function headerAction() {
  const header = (await rendered()).find((e) => e.type === PageHeader) as
    | ReactElement<{ actions?: ReactNode }>
    | undefined;
  return header?.props.actions;
}

const DRAFT = {
  id: "d1",
  title: "Picnic plans",
  is_published: false,
  published_at: null,
  created_at: "2026-01-01T12:00:00Z",
};
const SCHEDULED = {
  id: "s1",
  title: "Next year",
  is_published: true,
  published_at: "2999-01-01T12:00:00Z",
  created_at: "2026-01-01T12:00:00Z",
};
const PUBLISHED = {
  id: "p1",
  title: "Old news",
  is_published: true,
  published_at: "2026-01-01T12:00:00Z",
  created_at: "2026-01-01T12:00:00Z",
};

beforeEach(() => {
  role = "leader";
  leaderResult = { data: [], error: null };
  leaderReads = 0;
  leaderFilter = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AnnouncementsPage", () => {
  it("shows ErrorState, not the empty state, when the read fails", async () => {
    result = { data: null, error: { code: "57014", message: "canceling statement" } };
    const types = await renderedTypes();
    expect(types).toContain(ErrorState);
    expect(types).not.toContain(EmptyState);
  });

  it("shows the empty state when the read succeeds with no announcements", async () => {
    result = { data: [], error: null };
    const types = await renderedTypes();
    expect(types).toContain(EmptyState);
    expect(types).not.toContain(ErrorState);
  });

  it("offers a leader the action to add an announcement", async () => {
    result = { data: [], error: null };
    expect(await emptyStateAction()).toBeTruthy();
  });

  it("offers a member no action on the empty state", async () => {
    role = "member";
    result = { data: [], error: null };
    expect(await emptyStateAction()).toBeFalsy();
  });

  async function addButtons() {
    const html = renderToStaticMarkup(
      await AnnouncementsPage({ params: Promise.resolve({ groupId: "g1" }) }),
    );
    return html.split("Add announcement").length - 1;
  }

  it("shows a leader with no announcements and no drafts one add action, in the empty state", async () => {
    result = { data: [], error: null };
    expect(await addButtons()).toBe(1);
    expect(await emptyStateAction()).toBeTruthy();
    expect(await headerAction()).toBeFalsy();
  });

  it("keeps the add action in the header, once, when a leader has only drafts", async () => {
    result = { data: [], error: null };
    leaderResult = { data: [DRAFT, SCHEDULED], error: null };
    expect(await addButtons()).toBe(1);
    expect(await headerAction()).toBeTruthy();
  });

  it("keeps the add action in the header, once, when there are announcements", async () => {
    result = { data: [PUBLISHED], error: null };
    expect(await addButtons()).toBe(1);
    expect(await headerAction()).toBeTruthy();
  });

  it("shows a member the empty message and no add action", async () => {
    role = "member";
    result = { data: [], error: null };
    const html = renderToStaticMarkup(
      await AnnouncementsPage({ params: Promise.resolve({ groupId: "g1" }) }),
    );
    expect(html).toContain("No announcements yet.");
    expect(html).not.toContain("Add announcement");
  });

  it("keeps the add action in the header when the announcements read fails", async () => {
    result = { data: null, error: { code: "57014", message: "canceling statement" } };
    expect(await headerAction()).toBeTruthy();
  });

  it("offers a leader the action to add an announcement when there are some", async () => {
    result = { data: [{ id: "a1" }], error: null };
    expect(await headerAction()).toBeTruthy();
  });

  it("offers a member no action in the header", async () => {
    role = "member";
    result = { data: [{ id: "a1" }], error: null };
    expect(await headerAction()).toBeFalsy();
  });

  it("links each card to its editor for a leader", async () => {
    result = { data: [{ id: "a1" }], error: null };
    const card = (await rendered()).find((e) => e.type === AnnouncementCard) as ReactElement<{
      editHref?: string;
    }>;
    expect(card.props.editHref).toBe("/g/g1/announcements/a1/edit");
  });

  it("gives a member's card no editor link, and never reads unpublished rows for them", async () => {
    role = "member";
    result = { data: [{ id: "a1" }], error: null };
    leaderResult = { data: [DRAFT], error: null };
    const card = (await rendered()).find((e) => e.type === AnnouncementCard) as ReactElement<{
      editHref?: string;
    }>;
    expect(card.props.editHref).toBeUndefined();
    expect(leaderReads).toBe(0);
  });

  it("shows a leader their drafts and scheduled announcements, not the published ones twice", async () => {
    result = { data: [PUBLISHED], error: null };
    leaderResult = { data: [DRAFT, SCHEDULED], error: null };
    const html = renderToStaticMarkup(
      await AnnouncementsPage({ params: Promise.resolve({ groupId: "g1" }) }),
    );
    expect(leaderFilter).toMatch(/^is_published\.eq\.false,published_at\.gt\.\d{4}-/);
    expect(html).toContain("Drafts and scheduled");
    expect(html).toContain('href="/g/g1/announcements/d1/edit"');
    expect(html).toContain('href="/g/g1/announcements/s1/edit"');
    expect(html).not.toContain('href="/g/g1/announcements/p1/edit"');
  });

  it("does not call the list empty when a leader has only a draft", async () => {
    result = { data: [], error: null };
    leaderResult = { data: [DRAFT], error: null };
    expect(await renderedTypes()).not.toContain(EmptyState);
  });

  it("keeps the published list and the add action when a leader's read of unpublished rows fails", async () => {
    result = { data: [{ id: "a1" }], error: null };
    leaderResult = { data: null, error: { code: "57014", message: "canceling statement" } };
    const elements = await rendered();
    const failures = elements.filter((e) => e.type === ErrorState) as ReactElement<{ thing: string }>[];
    expect(failures.map((e) => e.props.thing)).toEqual(["drafts and scheduled announcements"]);
    expect(elements.filter((e) => e.type === AnnouncementCard)).toHaveLength(1);
    expect(await headerAction()).toBeTruthy();
  });

  it("does not call the list empty when a leader's read of unpublished rows fails", async () => {
    result = { data: [], error: null };
    leaderResult = { data: null, error: { code: "57014", message: "canceling statement" } };
    const types = await renderedTypes();
    expect(types).toContain(ErrorState);
    expect(types).not.toContain(EmptyState);
  });

  it("lists the announcements the read returned", async () => {
    result = { data: [{ id: "a1" }, { id: "a2" }], error: null };
    const types = await renderedTypes();
    expect(types.filter((t) => t === AnnouncementCard)).toHaveLength(2);
    expect(types).not.toContain(EmptyState);
    expect(types).not.toContain(ErrorState);
  });
});
