import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ current: null as { id: string } | null }));
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => user.current }));
vi.mock("@/lib/integrations/records/live", () => ({ readLiveDirectory: read }));

const { GET, dynamic } = await import("./route");

describe("GET /api/directory/live", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    read.mockResolvedValue({ mode: "off" });
  });

  it("refuses a signed-out request without reading anything", async () => {
    user.current = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it("answers for the signed-in person and is never cached", async () => {
    user.current = { id: "00000000-0000-0000-0000-00000000a001" };
    const res = await GET();
    expect(read).toHaveBeenCalledWith("00000000-0000-0000-0000-00000000a001");
    expect(await res.json()).toEqual({ mode: "off" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(dynamic).toBe("force-dynamic");
  });
});
