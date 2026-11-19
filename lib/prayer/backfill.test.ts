import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fakeService } from "@/lib/account/fakeServiceTestHelpers";
import type { Database } from "@/lib/supabase/database.types";
import { authorHash, decryptBody, encryptBody, isAuthor, planRow } from "./crypto";
import { commentAsStoredRow, writeCommentPlan, writePlan, type BackfillCommentRow, type BackfillRow } from "./backfill";
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

describe("writeCommentPlan", () => {
  const COMMENT = "44444444-4444-4444-4444-444444444444";
  const oldKeys = testKeys();
  // The current keys, with the old ones as previous: a rotation under way.
  const rotating = {
    body: { current: keys.body.current, previous: oldKeys.body.current },
    author: { current: keys.author.current, previous: oldKeys.author.current },
  };

  function setupComment(hidden: boolean) {
    const read: BackfillCommentRow = {
      id: COMMENT,
      org_id: ORG,
      body_ciphertext: encryptBody(oldKeys, ORG, COMMENT, "Praying with you."),
      hide_name: hidden,
      writer_id: hidden ? null : ADA,
      writer_hash: hidden ? authorHash(oldKeys, ORG, COMMENT, ADA) : null,
    };
    const stored: Record<string, unknown> = { ...read };
    const { client, failures } = fakeService({ prayer_comments: [stored] });
    const plan = planRow(commentAsStoredRow(read), rotating, [ADA]);
    if (plan.action !== "write") throw new Error("expected a write");
    return { read, stored, plan, failures, client: client as unknown as SupabaseClient<Database> };
  }

  it("moves the text and a hidden writer's hash onto the current keys", async () => {
    const { read, stored, plan, client } = setupComment(true);
    expect(plan.steps).toEqual(["reencrypt", "rehash"]);
    expect(await writeCommentPlan(client, read, plan)).toBe("written");
    expect(decryptBody(keys, ORG, COMMENT, stored.body_ciphertext as string)).toBe("Praying with you.");
    expect(isAuthor(keys, ORG, COMMENT, ADA, stored.writer_hash as string)).toBe(true);
    expect(stored.writer_id).toBeNull();
  });

  it("reseals a named comment and keeps its writer", async () => {
    const { read, stored, plan, client } = setupComment(false);
    expect(plan.steps).toEqual(["reencrypt"]);
    expect(await writeCommentPlan(client, read, plan)).toBe("written");
    expect(stored).toMatchObject({ writer_id: ADA, writer_hash: null });
  });

  it("leaves a comment resealed by an overlapping run, and reports a failed write", async () => {
    const first = setupComment(true);
    first.stored.body_ciphertext = "v1.other";
    expect(await writeCommentPlan(first.client, first.read, first.plan)).toBe("changed meanwhile");
    const second = setupComment(true);
    second.failures.push({ table: "prayer_comments", op: "update" });
    expect(await writeCommentPlan(second.client, second.read, second.plan)).toBe("failed");
  });
});
