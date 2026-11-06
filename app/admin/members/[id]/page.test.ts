import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { loggedLines } from "@/lib/log/testing";

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const VIEWER = "viewer-1";
vi.mock("@/lib/supabase/current-user", () => ({
  getOptionalUser: async () => ({ id: VIEWER, email: undefined }),
}));

const { MemberRole } = vi.hoisted(() => ({ MemberRole: () => null }));
vi.mock("./MemberRole", () => ({ MemberRole }));
vi.mock("@/components/profile/ProfileForm", () => ({ ProfileForm: () => null }));

type CountRead = { count: number | null; error: { message: string } | null; status: number };
const db = vi.hoisted(() => ({
  admins: 1,
  everyone: 5,
  failedCount: null as CountRead | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let counting = false;
      const chain = {
        select: (_columns: string, options?: { count?: string; head?: boolean }) => {
          counting = options?.count === "exact";
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        order: () => chain,
        returns: () => chain,
        single: async () => ({
          data: { id: filters.id, role: "admin", family_id: null, relationship: null, first_name: "Ada", last_name: "Test" },
        }),
        then: (resolve: (value: unknown) => void) => {
          if (table !== "profiles") return resolve({ data: [], error: null });
          if (db.failedCount) return resolve(db.failedCount);
          // A count that loses its role filter counts everyone in the church.
          const count = filters.role === "admin" ? db.admins : db.everyone;
          return resolve({ count: counting ? count : null, error: null, status: 200 });
        },
      };
      return chain;
    },
    rpc: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { email: "ada@example.test" }, error: null }) }),
    }),
  }),
}));

const { default: EditMemberPage } = await import("./page");

function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === type) return element as ReactElement<Record<string, unknown>>;
  return find(element.props.children, type);
}

async function lockReasonFor(memberId: string) {
  const page = await EditMemberPage({ params: Promise.resolve({ id: memberId }) });
  const control = find(page, MemberRole);
  if (!control) throw new Error("The page rendered no role control");
  return control.props.lockReason;
}

const ADD_ANOTHER = "A church needs at least one church admin, so add another before changing your role.";
const ASK_ANOTHER = "Another church admin can change your role.";

beforeEach(() => {
  db.admins = 1;
  db.failedCount = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Edit member's role lock", () => {
  it("locks the only church admin's own role and says to add another", async () => {
    expect(await lockReasonFor(VIEWER)).toBe(ADD_ANOTHER);
  });

  it("locks the viewer's own role when other church admins exist, and points to them", async () => {
    db.admins = 2;
    expect(await lockReasonFor(VIEWER)).toBe(ASK_ANOTHER);
  });

  it("leaves someone else's role open", async () => {
    expect(await lockReasonFor("someone-else")).toBeNull();
  });

  it.each([
    ["the API is down", { count: null, error: { message: "" }, status: 503 }],
    ["the response carries no error and no count", { count: null, error: null, status: 404 }],
  ])("reads an uncounted church as having one church admin when %s", async (_case, read) => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    db.admins = 2;
    db.failedCount = read;

    expect(await lockReasonFor(VIEWER)).toBe(ADD_ANOTHER);
    expect(loggedLines(logged)).toEqual([
      expect.objectContaining({
        what: "Failed to count church admins",
        route: "/admin/members/[id]",
        ids: { status: read.status },
      }),
    ]);
  });
});
