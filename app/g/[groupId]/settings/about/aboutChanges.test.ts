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

  it("treats a reorder as a change with nothing removed", () => {
    expect(aboutChanges(saved, { ...saved, leaders: [leaderB, leaderA] }, null)).toEqual({
      leaders: { list: [leaderB, leaderA], removed: [] },
    });
  });

  it("names who was removed from the list", () => {
    expect(aboutChanges(saved, { ...saved, leaders: [leaderB] }, null)).toEqual({
      leaders: { list: [leaderB], removed: [A] },
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
      leaders: { list: [{ profile_id: A, title: "  ", bio: " " }], removed: [] },
    });
    expect(parsed?.leaders?.list).toEqual([{ profile_id: A, title: "", bio: "" }]);
  });

  it.each([
    ["a non-object body", []],
    ["a summary that is not text", { summary: 1 }],
    ["a color that fails the hex check", { color: "url(x)" }],
    ["a color too pale for text", { color: "#7d7d7d" }],
    ["a video call link that is not https", { videoCall: { url: "http://x", time: "" } }],
    ["a malformed leader id", { leaders: { list: [{ profile_id: "x", title: "", bio: "" }], removed: [] } }],
    ["a malformed removed id", { leaders: { list: [], removed: ["x"] } }],
    ["a leader listed twice", { leaders: { list: [leaderA, leaderA], removed: [] } }],
    ["a leader both listed and removed", { leaders: { list: [leaderA], removed: [A] } }],
  ])("refuses %s", (_name, body) => {
    expect(parseAboutChanges(body)).toBeNull();
  });
});
