import { afterEach, describe, expect, it, vi } from "vitest";
import { movedNotice } from "@/lib/supperClub/emailOutcome";
import { postMove } from "./MoveDialog";

afterEach(() => vi.unstubAllGlobals());

describe("postMove", () => {
  it("hands the route's email outcome to the notice, so a move nobody heard about is a warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ sent: 0, capped: false, unsent: true })),
    );
    const result = await postMove("/api/supper-club/suppers/d/move", "2031-02-08T18:00:00.000Z");
    expect(result).toEqual({ ok: true, outcome: { sent: 0, capped: false, unsent: true } });
    expect(result.ok && movedNotice("Supper moved.", result.outcome).kind).toBe("warning");
  });

  it("passes a refusal's message through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Choose a date and time." }, { status: 400 })));
    expect(await postMove("/x", "bad")).toEqual({ ok: false, message: "Choose a date and time." });
  });
});
