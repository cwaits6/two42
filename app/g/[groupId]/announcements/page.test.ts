import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

let result: { data: unknown[] | null; error: { code: string; message: string } | null };

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
  requireActiveGroup: async (id: string) => ({ id, name: "Grace", role: "leader" }),
}));
vi.mock("@/components/states/ErrorState", () => ({ ErrorState: () => null }));
vi.mock("@/components/announcements/AnnouncementCard", () => ({ AnnouncementCard: () => null }));

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

async function renderedTypes() {
  const element = await AnnouncementsPage({ params: Promise.resolve({ groupId: "g1" }) });
  return flatten(element).map((e) => e.type);
}

beforeEach(() => {
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

  it("lists the announcements the read returned", async () => {
    result = { data: [{ id: "a1" }, { id: "a2" }], error: null };
    const types = await renderedTypes();
    expect(types.filter((t) => t === AnnouncementCard)).toHaveLength(2);
    expect(types).not.toContain(EmptyState);
    expect(types).not.toContain(ErrorState);
  });
});
