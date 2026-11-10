import { beforeEach, describe, expect, it, vi } from "vitest";

const remove = vi.fn();
const from = vi.fn((bucket: string) => {
  void bucket;
  return { remove };
});
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({ storage: { from } }),
}));
const logged = vi.spyOn(console, "log").mockImplementation(() => {});

const { removeAvatarObjects } = await import("./storageDelete");
const { loggedLines } = await import("@/lib/log/testing");

const ORG = "a0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const PERSON = "c0000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.clearAllMocks();
  remove.mockImplementation(async (keys: string[]) => ({
    data: keys.map((name) => ({ name })),
    error: null,
  }));
});

describe("removeAvatarObjects", () => {
  it("removes this org's key and a key from before org partitioning", async () => {
    const keys = [`${ORG}/profiles/${PERSON}/avatar.jpg`, `${PERSON}/avatar.jpg`, `families/${PERSON}/photo.jpg`];
    expect(await removeAvatarObjects(ORG, keys)).toEqual([]);
    expect(from).toHaveBeenCalledWith("avatars");
    expect(remove).toHaveBeenCalledWith(keys);
  });

  it("refuses a key under another org and reports it as still stored", async () => {
    const theirs = `${OTHER}/profiles/${PERSON}/avatar.jpg`;
    const ours = `${ORG}/profiles/${PERSON}/avatar.jpg`;
    expect(await removeAvatarObjects(ORG, [theirs, ours])).toEqual([theirs]);
    expect(remove).toHaveBeenCalledWith([ours]);
    expect(loggedLines(logged)).toEqual([
      expect.objectContaining({
        what: "removeAvatarObjects: refused a key outside org",
        step: "profiles",
        ids: { org: ORG, keyOrg: OTHER, entity: PERSON },
      }),
    ]);
  });

  it("reports every key still stored when storage fails, without throwing", async () => {
    remove.mockResolvedValue({ data: null, error: { message: "down", status: 503 } });
    expect(await removeAvatarObjects(ORG, [`${PERSON}/avatar.jpg`])).toEqual([`${PERSON}/avatar.jpg`]);
    expect(loggedLines(logged).map(({ what, code }) => ({ what, code }))).toEqual([
      { what: "removeAvatarObjects: remove failed", code: "503" },
      { what: "removeAvatarObjects: still stored in org", code: undefined },
    ]);
  });

  it("logs each key left behind by its kind and row id, so its folder can be found", async () => {
    remove.mockResolvedValue({ data: [], error: null });
    const keys = [`${ORG}/family-members/${PERSON}/avatar.jpg`, `${PERSON}/avatar.jpg`];
    await removeAvatarObjects(ORG, keys);
    const lines = loggedLines(logged);
    expect(lines.map(({ step, ids }) => ({ step, ids }))).toEqual([
      { step: "family_members", ids: { org: ORG, keyOrg: ORG, entity: PERSON } },
      { step: undefined, ids: { org: ORG, entity: PERSON } },
    ]);
    expect(JSON.stringify(lines)).not.toContain("avatar.jpg");
  });

  it("reports a key storage says nothing about", async () => {
    remove.mockResolvedValue({ data: [], error: null });
    expect(await removeAvatarObjects(ORG, [`${PERSON}/avatar.jpg`])).toEqual([`${PERSON}/avatar.jpg`]);
  });

  it("calls storage for nothing when there is nothing to remove", async () => {
    expect(await removeAvatarObjects(ORG, [])).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
});
