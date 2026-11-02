import { describe, expect, it } from "vitest";
import { colorError, detailsChanges, videoCallUrlError } from "./detailsChanges";

const saved = {
  color: "#B85C38",
  videoCallUrl: "https://example.test/call",
  videoCallTime: "Thursdays at 7pm",
};

describe("detailsChanges", () => {
  it("is empty when nothing changed", () => {
    expect(detailsChanges(saved, { ...saved })).toEqual({});
  });

  it("carries only the sections that changed", () => {
    expect(detailsChanges(saved, { ...saved, color: "#2A211A" })).toEqual({ color: "#2A211A" });
    expect(detailsChanges(saved, { ...saved, videoCallTime: " Fridays " })).toEqual({
      videoCall: { url: saved.videoCallUrl, time: "Fridays" },
    });
  });

  it("does not count whitespace around a video call field as a change", () => {
    expect(detailsChanges(saved, { ...saved, videoCallTime: `${saved.videoCallTime} ` })).toEqual({});
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
