import { describe, expect, it } from "vitest";
import {
  aboutChanges,
  colorError,
  hasChanges,
  parseAboutChanges,
  videoCallUrlError,
  type AboutFields,
} from "./aboutChanges";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const leaderA = { profile_id: A, title: "Coordinator", bio: "" };
const leaderB = { profile_id: B, title: "", bio: "Hi" };
const saved: AboutFields = {
  color: "#B85C38",
  videoCallUrl: "https://example.test/call",
  videoCallTime: "Thursdays at 7pm",
  leaders: [leaderA, leaderB],
};

describe("aboutChanges", () => {
  it("is empty when nothing changed, so the page is not dirty", () => {
    expect(hasChanges(aboutChanges(saved, { ...saved, leaders: [...saved.leaders] }, null))).toBe(false);
  });

  it("carries only the sections that changed", () => {
    expect(aboutChanges(saved, { ...saved, color: "#2A211A" }, null)).toEqual({ color: "#2A211A" });
    expect(aboutChanges(saved, saved, "[]")).toEqual({ summary: "[]" });
    expect(aboutChanges(saved, { ...saved, videoCallTime: " Fridays " }, null)).toEqual({
      videoCall: { url: saved.videoCallUrl, time: "Fridays" },
    });
  });

  it("does not count whitespace around a video call field as a change", () => {
    expect(aboutChanges(saved, { ...saved, videoCallTime: `${saved.videoCallTime} ` }, null)).toEqual({});
  });

  it("sends a reorder as the order alone, so no one's title or bio is rewritten", () => {
    expect(aboutChanges(saved, { ...saved, leaders: [leaderB, leaderA] }, null)).toEqual({
      leaders: { added: [], edited: [], removed: [], order: [B, A] },
    });
  });

  it("sends an edit as that entry's changed fields alone, leaving the order alone", () => {
    expect(aboutChanges(saved, { ...saved, leaders: [leaderA, { ...leaderB, bio: "Hello" }] }, null)).toEqual({
      leaders: { added: [], edited: [{ profile_id: B, bio: "Hello" }], removed: [] },
    });
  });

  it("sends a cleared field as blank", () => {
    expect(aboutChanges(saved, { ...saved, leaders: [{ ...leaderA, title: "" }, leaderB] }, null)).toEqual({
      leaders: { added: [], edited: [{ profile_id: A, title: "" }], removed: [] },
    });
  });

  it("names who was removed, without touching anyone else or the order", () => {
    expect(aboutChanges(saved, { ...saved, leaders: [leaderB] }, null)).toEqual({
      leaders: { added: [], edited: [], removed: [A] },
    });
  });

  it("sends someone new with the order that places them", () => {
    const leaderC = { profile_id: C, title: "", bio: "" };
    expect(aboutChanges(saved, { ...saved, leaders: [leaderA, leaderB, leaderC] }, null)).toEqual({
      leaders: { added: [leaderC], edited: [], removed: [], order: [A, B, C] },
    });
  });

  it("treats removing someone and adding them back unchanged as no change", () => {
    expect(aboutChanges(saved, { ...saved, leaders: [leaderA, { ...leaderB }] }, null)).toEqual({});
  });
});

describe("field errors", () => {
  it("accepts only a color that can carry legible text", () => {
    expect(colorError("#B85C38")).toBeUndefined();
    expect(colorError("#7d7d7d")).toBeDefined();
    expect(colorError("red")).toBeDefined();
  });

  it("accepts only an https video call link, or none", () => {
    expect(videoCallUrlError("")).toBeUndefined();
    expect(videoCallUrlError(" https://example.test ")).toBeUndefined();
    expect(videoCallUrlError("http://example.test")).toBeDefined();
    expect(videoCallUrlError("javascript:alert(1)")).toBeDefined();
  });
});

describe("parseAboutChanges", () => {
  it("round-trips what aboutChanges builds", () => {
    const changes = aboutChanges(
      saved,
      { color: "#2A211A", videoCallUrl: "", videoCallTime: "", leaders: [leaderB] },
      "[]",
    );
    expect(parseAboutChanges(JSON.parse(JSON.stringify(changes)))).toEqual(changes);
  });

  it("keeps an empty title empty rather than filling one in", () => {
    const parsed = parseAboutChanges({
      leaders: { added: [], edited: [{ profile_id: A, title: "  ", bio: " " }], removed: [] },
    });
    expect(parsed?.leaders?.edited).toEqual([{ profile_id: A, title: "", bio: "" }]);
  });

  it("keeps an edit to the fields it names", () => {
    const parsed = parseAboutChanges({
      leaders: { added: [], edited: [{ profile_id: A, bio: " Hello " }], removed: [] },
    });
    expect(parsed?.leaders?.edited).toEqual([{ profile_id: A, bio: "Hello" }]);
  });

  it.each([
    ["a non-object body", []],
    ["a summary that is not text", { summary: 1 }],
    ["a color that fails the hex check", { color: "url(x)" }],
    ["a color too pale for text", { color: "#7d7d7d" }],
    ["a video call link that is not https", { videoCall: { url: "http://x", time: "" } }],
    ["a malformed leader id", { leaders: { added: [], edited: [{ profile_id: "x", title: "", bio: "" }], removed: [] } }],
    ["a malformed removed id", { leaders: { added: [], edited: [], removed: ["x"] } }],
    ["a malformed order id", { leaders: { added: [], edited: [], removed: [], order: ["x"] } }],
    ["an order naming someone twice", { leaders: { added: [], edited: [], removed: [], order: [A, A] } }],
    ["an edit whose title is not text", { leaders: { added: [], edited: [{ profile_id: A, title: 1 }], removed: [] } }],
    ["someone added without a bio", { leaders: { added: [{ profile_id: A, title: "" }], edited: [], removed: [], order: [A] } }],
    ["a leader edited twice", { leaders: { added: [], edited: [leaderA, leaderA], removed: [] } }],
    ["a leader both added and edited", { leaders: { added: [leaderA], edited: [leaderA], removed: [], order: [A] } }],
    ["a leader both edited and removed", { leaders: { added: [], edited: [leaderA], removed: [A] } }],
    ["an order naming someone removed", { leaders: { added: [], edited: [], removed: [A], order: [A] } }],
    ["someone added with no place in the order", { leaders: { added: [leaderA], edited: [], removed: [] } }],
    ["a list instead of changes", { leaders: { list: [leaderA], removed: [] } }],
  ])("refuses %s", (_name, body) => {
    expect(parseAboutChanges(body)).toBeNull();
  });
});
