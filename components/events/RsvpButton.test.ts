// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountControl,
  stubRsvpClient,
  unmountControls,
  writeFailed,
  writeSaved,
  writeTouchedNoRow,
  type RsvpClientStub,
} from "./rsvpControlTestHelpers";

let stub: RsvpClientStub;
vi.mock("@/lib/supabase/client", () => ({ createClient: () => stub.client }));

const { RsvpButton } = await import("./RsvpButton");
const { RSVP_SAVE_FAILED } = await import("./useRsvp");

const ids = { eventId: "event-1", userId: "user-1" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await unmountControls();
  vi.restoreAllMocks();
});

describe("RsvpButton when the write fails", () => {
  it("keeps the previous reply and tells the member", async () => {
    stub = stubRsvpClient(writeFailed);
    const view = await mountControl(createElement(RsvpButton, { ...ids, currentStatus: "maybe" }));
    await view.click("Going");
    expect(view.pressed()).toEqual(["Maybe"]);
    expect(view.text()).toContain(RSVP_SAVE_FAILED);
  });

  it("treats a write that touched no row as a failure", async () => {
    stub = stubRsvpClient(writeTouchedNoRow);
    const view = await mountControl(createElement(RsvpButton, { ...ids, currentStatus: "yes" }));
    await view.click("Going");
    expect(stub.writes).toEqual([{ kind: "delete" }]);
    expect(view.pressed()).toEqual(["Going"]);
    expect(view.text()).toContain(RSVP_SAVE_FAILED);
  });
});

describe("RsvpButton when the write saves", () => {
  it("shows the new reply with no message", async () => {
    stub = stubRsvpClient(writeSaved);
    const view = await mountControl(createElement(RsvpButton, { ...ids, currentStatus: null }));
    await view.click("Going");
    expect(stub.writes).toEqual([
      { kind: "upsert", row: { event_id: "event-1", user_id: "user-1", status: "yes" } },
    ]);
    expect(view.pressed()).toEqual(["Going"]);
    expect(view.text()).not.toContain(RSVP_SAVE_FAILED);
  });

  it("clears the reply again when the current one is chosen", async () => {
    stub = stubRsvpClient(writeSaved);
    const view = await mountControl(createElement(RsvpButton, { ...ids, currentStatus: "yes" }));
    await view.click("Going");
    expect(stub.writes).toEqual([{ kind: "delete" }]);
    expect(view.pressed()).toEqual([]);
  });

  it("drops the message once a retry saves", async () => {
    let result = writeFailed;
    stub = stubRsvpClient(() => result());
    const view = await mountControl(createElement(RsvpButton, { ...ids, currentStatus: null }));
    await view.click("Going");
    expect(view.text()).toContain(RSVP_SAVE_FAILED);
    result = writeSaved;
    await view.click("Going");
    expect(view.pressed()).toEqual(["Going"]);
    expect(view.text()).not.toContain(RSVP_SAVE_FAILED);
  });
});
