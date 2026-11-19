import { describe, expect, it } from "vitest";
import { authorHash, encryptBody } from "./crypto";
import { hashedCommentsOf, openComments, type SealedCommentRow } from "./commentThread";
import { testKeys } from "./testKeys";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const ASKER = "a0000000-0000-4000-8000-000000000001";
const WRITER = "a0000000-0000-4000-8000-000000000002";
const MEMBER = "a0000000-0000-4000-8000-000000000003";
const REQUEST = "b0000000-0000-4000-8000-000000000001";
const keys = testKeys();

function comment(id: string, opts: { privately?: boolean; hidden?: boolean; writer?: string; org?: string } = {}) {
  const writer = opts.writer ?? WRITER;
  const org = opts.org ?? ORG;
  return {
    id,
    request_id: REQUEST,
    body_ciphertext: encryptBody(keys, org, id, `text of ${id}`),
    only_asker: opts.privately ?? false,
    hide_name: opts.hidden ?? false,
    writer_id: opts.hidden ? null : writer,
    writer_hash: opts.hidden ? authorHash(keys, org, id, writer) : null,
    created_at: "2026-01-01T00:00:00Z",
  } satisfies SealedCommentRow;
}

const GROUP = comment("c0000000-0000-4000-8000-000000000001");
const PRIVATE = comment("c0000000-0000-4000-8000-000000000002", { privately: true });
const HIDDEN_PRIVATE = comment("c0000000-0000-4000-8000-000000000003", { privately: true, hidden: true });
const rows = [GROUP, PRIVATE, HIDDEN_PRIVATE];

const view = (viewerId: string, opts: { asked?: boolean; isLeader?: boolean } = {}) =>
  openComments(rows, {
    viewerId,
    orgId: ORG,
    keys,
    isLeader: opts.isLeader ?? false,
    requests: new Map([[REQUEST, { mine: opts.asked ?? false }]]),
  });
const ids = (opened: ReturnType<typeof view>) => opened.map((c) => c.view.id);

describe("openComments", () => {
  it("shows a private comment to its writer, named or hidden, and to the person who asked", () => {
    expect(ids(view(WRITER))).toEqual([GROUP.id, PRIVATE.id, HIDDEN_PRIVATE.id]);
    // `mine` on the wall row is how an anonymous request's author is recognised by hash.
    expect(ids(view(ASKER, { asked: true }))).toEqual([GROUP.id, PRIVATE.id, HIDDEN_PRIVATE.id]);
  });

  it("shows another member, a leader or a church admin only the group comment", () => {
    expect(ids(view(MEMBER))).toEqual([GROUP.id]);
    expect(ids(view(MEMBER, { isLeader: true }))).toEqual([GROUP.id]);
  });

  it("recognises the hidden-name writer by hash, and gives no writer id for their comment", () => {
    const hidden = view(WRITER).find((c) => c.view.id === HIDDEN_PRIVATE.id)!;
    expect(hidden.view.mine).toBe(true);
    expect(hidden.writerId).toBeNull();
    expect(JSON.stringify(view(ASKER, { asked: true }).map((c) => c.view))).not.toContain(WRITER);
  });

  it("lets the writer, the person who asked and a leader delete, and no one else", () => {
    const canDelete = (opened: ReturnType<typeof view>) => opened.map((c) => c.view.can_delete);
    expect(canDelete(view(WRITER))).toEqual([true, true, true]);
    expect(canDelete(view(ASKER, { asked: true }))).toEqual([true, true, true]);
    expect(canDelete(view(MEMBER, { isLeader: true }))).toEqual([true]);
    expect(canDelete(view(MEMBER))).toEqual([false]);
  });

  it("opens the text, and drops comments on requests the viewer was not given", () => {
    expect(view(MEMBER)[0].view.body).toBe(`text of ${GROUP.id}`);
    expect(openComments(rows, { viewerId: WRITER, orgId: ORG, keys, isLeader: true, requests: new Map() })).toEqual([]);
  });

  it("throws when text it may show fails to open, but not for a comment it drops", () => {
    const sealedElsewhere = { ...GROUP, body_ciphertext: PRIVATE.body_ciphertext };
    expect(() => openComments([sealedElsewhere], { viewerId: MEMBER, orgId: ORG, keys, isLeader: false, requests: new Map([[REQUEST, { mine: false }]]) })).toThrow();
    const brokenPrivate = { ...PRIVATE, body_ciphertext: "v1.x.y.z" };
    expect(() => openComments([brokenPrivate], { viewerId: MEMBER, orgId: ORG, keys, isLeader: false, requests: new Map([[REQUEST, { mine: false }]]) })).not.toThrow();
  });
});

describe("hashedCommentsOf", () => {
  function fakeClient(data: SealedCommentRow[]) {
    const filters: [string, unknown][] = [];
    const chain = {
      from: () => chain,
      select: () => chain,
      eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
      is: (c: string, v: unknown) => (filters.push([c, v]), chain),
      order: () => chain,
      range: () => chain,
      returns: () => Promise.resolve({ data, error: null }),
    };
    return { client: chain as never, filters };
  }

  it("matches only the person's hidden-name comments, in the church it was given", async () => {
    const theirs = comment("c0000000-0000-4000-8000-000000000010", { hidden: true });
    const someoneElse = comment("c0000000-0000-4000-8000-000000000011", { hidden: true, writer: MEMBER });
    const otherChurch = comment("c0000000-0000-4000-8000-000000000012", { hidden: true, org: OTHER_ORG });
    const { client, filters } = fakeClient([theirs, someoneElse, otherChurch]);
    const { data } = await hashedCommentsOf(client, ORG, WRITER, keys);
    expect(data?.map((c) => c.id)).toEqual([theirs.id]);
    expect(filters).toContainEqual(["org_id", ORG]);
    expect(filters).toContainEqual(["writer_id", null]);
  });
});
