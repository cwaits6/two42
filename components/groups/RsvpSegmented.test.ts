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

const { RsvpSegmented } = await import("./RsvpSegmented");
const { RSVP_SAVE_FAILED } = await import("@/components/events/useRsvp");

const ids = { eventId: "event-1", userId: "user-1" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await unmountControls();
  vi.restoreAllMocks();
});

describe("RsvpSegmented", () => {
  it("keeps the previous reply and tells the member when the write fails", async () => {
    stub = stubRsvpClient(writeFailed);
    const view = await mountControl(
      createElement(RsvpSegmented, { ...ids, currentStatus: "maybe" }),
    );
    await view.click("Going");
    expect(view.pressed()).toEqual(["Maybe"]);
    expect(view.text()).toContain(RSVP_SAVE_FAILED);
  });

  it("shows the new reply with no message when the write saves", async () => {
    stub = stubRsvpClient(writeSaved);
    const view = await mountControl(createElement(RsvpSegmented, { ...ids, currentStatus: null }));
    await view.click("Can't");
    expect(stub.writes).toEqual([
      { kind: "upsert", row: { event_id: "event-1", user_id: "user-1", status: "no" } },
    ]);
    expect(view.pressed()).toEqual(["Can't"]);
    expect(view.text()).not.toContain(RSVP_SAVE_FAILED);
  });
});
