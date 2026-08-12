// Unit tests for the server-context signing helpers (CWA-59 / #333). The
// mocking pattern mirrors lib/members/access.test.ts: stub
// @/lib/supabase/server's createClient and hand back a minimal client whose
// storage API returns canned responses. What matters here is reassembly —
// per-item failures land in the right slots and never throw — because a
// mis-indexed batch would render the wrong person's photo.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { mintSignedUrl, mintSignedUrls } = await import("@/lib/storageRead");

const BASE = "http://127.0.0.1:54321/storage/v1/object/public";
const ORG = "11111111-1111-1111-1111-111111111111";
const keyFor = (name: string) => `${ORG}/profiles/${name}/avatar.jpg`;
const urlFor = (name: string) => `${BASE}/avatars/${keyFor(name)}`;

type SignedEntry = {
  path: string | null;
  signedUrl: string | null;
  error: string | null;
};

function stubStorage(handlers: {
  createSignedUrl?: (
    path: string,
    ttl: number,
  ) => { data: { signedUrl: string } | null; error: { message: string } | null };
  createSignedUrls?: (
    paths: string[],
    ttl: number,
  ) => { data: SignedEntry[] | null; error: { message: string } | null };
}) {
  const calls: { bucket: string; paths: string[]; ttl: number }[] = [];
  createClient.mockResolvedValue({
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number) => {
          calls.push({ bucket, paths: [path], ttl });
          return handlers.createSignedUrl!(path, ttl);
        },
        createSignedUrls: async (paths: string[], ttl: number) => {
          calls.push({ bucket, paths, ttl });
          return handlers.createSignedUrls!(paths, ttl);
        },
      }),
    },
  });
  return calls;
}

beforeEach(() => {
  createClient.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("mintSignedUrl", () => {
  it("passes null and undefined through without constructing a client", async () => {
    expect(await mintSignedUrl(null)).toBeNull();
    expect(await mintSignedUrl(undefined)).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns null for an unparseable URL without constructing a client", async () => {
    expect(await mintSignedUrl("https://example.com/x.jpg")).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("mints a signed URL for a well-formed stored value", async () => {
    const calls = stubStorage({
      createSignedUrl: (path) => ({
        data: { signedUrl: `signed:${path}` },
        error: null,
      }),
    });
    expect(await mintSignedUrl(urlFor("a"))).toBe(`signed:${keyFor("a")}`);
    expect(calls).toEqual([{ bucket: "avatars", paths: [keyFor("a")], ttl: 3600 }]);
  });

  it("returns null instead of throwing on a Storage error", async () => {
    stubStorage({
      createSignedUrl: () => ({ data: null, error: { message: "denied" } }),
    });
    expect(await mintSignedUrl(urlFor("a"))).toBeNull();
  });
});

describe("mintSignedUrls", () => {
  it("returns all-null for empty and unparseable input without a client", async () => {
    expect(await mintSignedUrls([])).toEqual([]);
    expect(await mintSignedUrls([null, undefined, "https://example.com/x"])).toEqual([
      null,
      null,
      null,
    ]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("reassembles by response path into original slots, skipping nulls", async () => {
    stubStorage({
      // Return entries in REVERSED order to prove reassembly keys on the
      // path field, not array position.
      createSignedUrls: (paths) => ({
        data: paths
          .map((p) => ({ path: p, signedUrl: `signed:${p}`, error: null }))
          .reverse(),
        error: null,
      }),
    });
    const result = await mintSignedUrls([
      urlFor("a"),
      null,
      urlFor("b"),
      "https://example.com/foreign.jpg",
    ]);
    expect(result).toEqual([
      `signed:${keyFor("a")}`,
      null,
      `signed:${keyFor("b")}`,
      null,
    ]);
  });

  it("nulls only the failing slot on a per-item error", async () => {
    stubStorage({
      createSignedUrls: (paths) => ({
        data: paths.map((p) => ({
          path: p,
          signedUrl: p === keyFor("bad") ? null : `signed:${p}`,
          error: p === keyFor("bad") ? "Object not found" : null,
        })),
        error: null,
      }),
    });
    expect(
      await mintSignedUrls([urlFor("a"), urlFor("bad"), urlFor("c")]),
    ).toEqual([`signed:${keyFor("a")}`, null, `signed:${keyFor("c")}`]);
  });

  it("nulls the whole bucket batch, without throwing, on a batch error", async () => {
    stubStorage({
      createSignedUrls: () => ({ data: null, error: { message: "boom" } }),
    });
    expect(await mintSignedUrls([urlFor("a"), urlFor("b")])).toEqual([null, null]);
  });
});
