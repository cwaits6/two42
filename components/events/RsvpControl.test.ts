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
} from "./rsvpControlTestHelpers";

let stub: RsvpClientStub;
vi.mock("@/lib/supabase/client", () => ({ createClient: () => stub.client }));

const { RsvpControl } = await import("./RsvpControl");
const { RSVP_SAVE_FAILED } = await import("./useRsvp");

const ids = { eventId: "event-1", occurrenceDate: "2031-11-02", userId: "user-1" };
const save = (status: string, date = ids.occurrenceDate) => ({
  fn: "rsvp_set",
  args: { _event_id: "event-1", _occurrence_date: date, _status: status },
});
const clear = (date = ids.occurrenceDate) => ({
  fn: "rsvp_set",
  args: { _event_id: "event-1", _occurrence_date: date },
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await unmountControls();
  vi.restoreAllMocks();
});

describe("RsvpControl when the write fails", () => {
  it("keeps the previous reply and tells the member", async () => {
    stub = stubRsvpClient(writeFailed);
    const view = await mountControl(createElement(RsvpControl, { ...ids, currentStatus: "maybe" }));
    await view.click("Going");
    expect(view.pressed()).toEqual(["Maybe"]);
    expect(view.text()).toContain(RSVP_SAVE_FAILED);
  });

  it("puts the reply back when clearing it fails", async () => {
    stub = stubRsvpClient(writeFailed);
    const view = await mountControl(createElement(RsvpControl, { ...ids, currentStatus: "yes" }));
    await view.click("Going");
    expect(stub.writes).toEqual([clear()]);
    expect(view.pressed()).toEqual(["Going"]);
    expect(view.text()).toContain(RSVP_SAVE_FAILED);
  });
});

describe("RsvpControl when the write saves", () => {
  it("saves the reply for the date shown", async () => {
    stub = stubRsvpClient(writeSaved);
    const view = await mountControl(createElement(RsvpControl, { ...ids, currentStatus: null }));
    await view.click("Going");
    expect(stub.writes).toEqual([save("yes")]);
    expect(view.pressed()).toEqual(["Going"]);
    expect(view.text()).not.toContain(RSVP_SAVE_FAILED);
  });

  it("clears the reply for that date when the current one is chosen", async () => {
    stub = stubRsvpClient(writeSaved);
    const view = await mountControl(createElement(RsvpControl, { ...ids, currentStatus: "yes" }));
    await view.click("Going");
    expect(stub.writes).toEqual([clear()]);
    expect(view.pressed()).toEqual([]);
  });

  it("drops the message once a retry saves", async () => {
    let result = writeFailed;
    stub = stubRsvpClient(() => result());
    const view = await mountControl(createElement(RsvpControl, { ...ids, currentStatus: null }));
    await view.click("Going");
    expect(view.text()).toContain(RSVP_SAVE_FAILED);
    result = writeSaved;
    await view.click("Going");
    expect(view.pressed()).toEqual(["Going"]);
    expect(view.text()).not.toContain(RSVP_SAVE_FAILED);
  });
});

describe("RsvpControl on two dates of one event", () => {
  it("keeps each date's reply, and a failure, to that date", async () => {
    let result = writeSaved;
    stub = stubRsvpClient(() => result());
    const first = await mountControl(createElement(RsvpControl, { ...ids, currentStatus: "yes" }));
    const second = await mountControl(
      createElement(RsvpControl, { ...ids, occurrenceDate: "2031-11-09", currentStatus: null }),
    );
    await second.click("Can't go");
    result = writeFailed;
    await first.click("Maybe");
    expect(stub.writes).toEqual([save("no", "2031-11-09"), save("maybe")]);
    expect(first.pressed()).toEqual(["Going"]);
    expect(first.text()).toContain(RSVP_SAVE_FAILED);
    expect(second.pressed()).toEqual(["Can't go"]);
    expect(second.text()).not.toContain(RSVP_SAVE_FAILED);
  });
});

describe("RsvpControl", () => {
  it.each(["default", "primary"] as const)("offers the same three replies on the %s tone", async (tone) => {
    stub = stubRsvpClient(writeSaved);
    const view = await mountControl(createElement(RsvpControl, { ...ids, currentStatus: null, tone }));
    expect(view.labels()).toEqual(["Going", "Maybe", "Can't go"]);
    await view.click("Can't go");
    expect(stub.writes).toEqual([save("no")]);
    expect(view.pressed()).toEqual(["Can't go"]);
  });

  it("marks the chosen reply with a check, not color alone", async () => {
    stub = stubRsvpClient(writeSaved);
    const view = await mountControl(createElement(RsvpControl, { ...ids, currentStatus: "maybe" }));
    expect(view.checked()).toEqual(["Maybe"]);
  });
});
