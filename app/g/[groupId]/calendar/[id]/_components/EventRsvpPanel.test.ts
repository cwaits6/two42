// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountControl,
  stubRsvpClient,
  unmountControls,
  writeFailed,
  writeSaved,
  type RsvpClientStub,
} from "@/components/events/rsvpControlTestHelpers";

let stub: RsvpClientStub;
vi.mock("@/lib/supabase/client", () => ({ createClient: () => stub.client }));

const { EventRsvpPanel } = await import("./EventRsvpPanel");
const { RSVP_SAVE_FAILED } = await import("@/components/events/useRsvp");

const ids = { eventId: "event-1", userId: "user-1" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await unmountControls();
  vi.restoreAllMocks();
});

describe("EventRsvpPanel", () => {
  it("keeps the previous reply and tells the member when the write fails", async () => {
    stub = stubRsvpClient(writeFailed);
    const view = await mountControl(
      createElement(EventRsvpPanel, { ...ids, initialStatus: "yes" }),
    );
    await view.click("Maybe");
    expect(view.pressed()).toEqual(["Going"]);
    expect(view.text()).toContain("You're going.");
    expect(view.text()).toContain(RSVP_SAVE_FAILED);
  });

  it("shows the new reply with no message when the write saves", async () => {
    stub = stubRsvpClient(writeSaved);
    const view = await mountControl(
      createElement(EventRsvpPanel, { ...ids, initialStatus: null }),
    );
    await view.click("Maybe");
    expect(stub.writes).toEqual([
      { kind: "upsert", row: { event_id: "event-1", user_id: "user-1", status: "maybe" } },
    ]);
    expect(view.pressed()).toEqual(["Maybe"]);
    expect(view.text()).toContain("Maybe so far.");
    expect(view.text()).not.toContain(RSVP_SAVE_FAILED);
  });
});
