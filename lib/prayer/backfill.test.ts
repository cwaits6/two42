import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fakeService } from "@/lib/account/fakeServiceTestHelpers";
import type { Database } from "@/lib/supabase/database.types";
import { decryptBody, planRow } from "./crypto";
import { writePlan, type BackfillRow } from "./backfill";
import { testKeys } from "./testKeys";

const ORG = "11111111-1111-1111-1111-111111111111";
const REQ = "33333333-3333-3333-3333-333333333333";
const ADA = "55555555-5555-5555-5555-555555555555";
const READ_AT = "2026-01-01T00:00:00.000000+00:00";
const keys = testKeys();

function setup(extra: Partial<BackfillRow> = {}) {
  const read: BackfillRow = {
    id: REQ,
    org_id: ORG,
    body: "Pray for Ada.",
    body_ciphertext: null,
    is_anonymous: true,
    author_id: ADA,
    author_hash: null,
    updated_at: READ_AT,
    ...extra,
  };
  const stored: Record<string, unknown> = { ...read };
  const { client } = fakeService({ prayer_requests: [stored] });
  const plan = planRow(read, keys);
  if (plan.action !== "write") throw new Error("expected a write");
  return { read, stored, plan, client: client as unknown as SupabaseClient<Database> };
}

describe("writePlan", () => {
  it("writes a row that is as it was read", async () => {
    const { read, stored, plan, client } = setup();
    expect(await writePlan(client, read, plan)).toBe("written");
    expect(stored).toMatchObject({ body: null, author_id: null, updated_at: READ_AT });
    expect(decryptBody(keys, ORG, REQ, stored.body_ciphertext as string)).toBe("Pray for Ada.");
  });

  it("leaves a row the app edited after the plan, keeping the member's edit", async () => {
    const { read, stored, plan, client } = setup();
    Object.assign(stored, { body: "Edited meanwhile.", updated_at: "2026-01-02T00:00:00.000000+00:00" });
    expect(await writePlan(client, read, plan)).toBe("changed meanwhile");
    expect(stored).toMatchObject({ body: "Edited meanwhile.", author_id: ADA, body_ciphertext: null });
  });

  it("leaves a row whose author form changed after the plan", async () => {
    const { read, stored, plan, client } = setup();
    Object.assign(stored, { is_anonymous: false });
    expect(await writePlan(client, read, plan)).toBe("changed meanwhile");
    expect(stored.body).toBe("Pray for Ada.");
  });
});
