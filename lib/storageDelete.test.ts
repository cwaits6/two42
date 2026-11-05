import { beforeEach, describe, expect, it, vi } from "vitest";

const remove = vi.fn();
const from = vi.fn((bucket: string) => {
  void bucket;
  return { remove };
});
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({ storage: { from } }),
}));
vi.spyOn(console, "log").mockImplementation(() => {});

const { removeAvatarObjects } = await import("./storageDelete");

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
  });

  it("reports every key still stored when storage fails, without throwing", async () => {
    remove.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await removeAvatarObjects(ORG, [`${PERSON}/avatar.jpg`])).toEqual([`${PERSON}/avatar.jpg`]);
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
