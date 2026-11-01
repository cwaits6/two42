import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

let result: { data: unknown[] | null; error: { code: string; message: string } | null };
let role: "leader" | "member" = "leader";

function query() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    lte: () => chain,
    order: () => Promise.resolve(result),
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

beforeEach(() => {
  role = "leader";
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

  it("offers a leader the action to add an announcement when there are some", async () => {
    result = { data: [{ id: "a1" }], error: null };
    expect(await headerAction()).toBeTruthy();
  });

  it("offers a member no action in the header", async () => {
    role = "member";
    result = { data: [{ id: "a1" }], error: null };
    expect(await headerAction()).toBeFalsy();
  });

  it("lists the announcements the read returned", async () => {
    result = { data: [{ id: "a1" }, { id: "a2" }], error: null };
    const types = await renderedTypes();
    expect(types.filter((t) => t === AnnouncementCard)).toHaveLength(2);
    expect(types).not.toContain(EmptyState);
    expect(types).not.toContain(ErrorState);
  });
});
