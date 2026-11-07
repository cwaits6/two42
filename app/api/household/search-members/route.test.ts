// A failed search answers with fixed copy, whichever of its two reads fails;
// the database's own text, which names tables, columns and policies, stays out.

import { beforeEach, describe, it, vi } from "vitest";
import { expectSchemaHidden, fakeQueryClient, SCHEMA_REVEALING_ERROR, type QueryAnswer } from "@/lib/supabase/testing";

const db: { answers: Record<string, QueryAnswer[]> } = { answers: {} };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeQueryClient(db.answers),
}));
vi.mock("@/lib/storageRead", () => ({
  mintSignedUrls: async (urls: unknown[]) => urls.map(() => null),
}));

const { GET } = await import("./route");

const failed = { data: null, error: SCHEMA_REVEALING_ERROR };
const primary = { data: { role: "member", family_id: "fam-1", setup_completed: true, relationship: "primary" }, error: null };
const search = () => GET(new Request("http://localhost/api/household/search-members?q=ru"));

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.restoreAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("GET /api/household/search-members when the database refuses", () => {
  it("answers 500 with fixed copy when the profiles read fails", async () => {
    db.answers = { profiles: [primary, failed] };
    await expectSchemaHidden(await search(), log, {
      status: 500,
      error: "Couldn't search for members. Try again.",
      what: "household/search-members profiles read error",
      route: "/api/household/search-members",
    });
  });

  it("answers 500 with fixed copy when the addresses read fails", async () => {
    db.answers = {
      profiles: [primary, { data: [{ id: "p-2", first_name: "Ruth", avatar_url: null }], error: null }],
      profiles_directory: [failed],
    };
    await expectSchemaHidden(await search(), log, {
      status: 500,
      error: "Couldn't search for members. Try again.",
      what: "household/search-members addresses read error",
      route: "/api/household/search-members",
    });
  });
});
