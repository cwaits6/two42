import { describe, expect, it } from "vitest";
import { COMMENT_TEXT_MAX, commentText, parseNewComment } from "./comments";

describe("parseNewComment", () => {
  it("takes trimmed text and both choices", () => {
    expect(parseNewComment({ body: "  Praying.  ", only_asker: true, hide_name: false })).toEqual({
      body: "Praying.",
      only_asker: true,
      hide_name: false,
    });
  });

  it.each([
    ["no text", { body: "   ", only_asker: false, hide_name: false }],
    ["text over the cap", { body: "a".repeat(COMMENT_TEXT_MAX + 1), only_asker: false, hide_name: false }],
    ["a missing choice", { body: "Praying.", only_asker: false }],
    ["a choice that is not a boolean", { body: "Praying.", only_asker: "no", hide_name: false }],
  ])("refuses %s", (_, input) => {
    expect(parseNewComment(input)).toBeNull();
  });

  it("counts characters as the person sees them", () => {
    expect(commentText("🙏".repeat(COMMENT_TEXT_MAX))).not.toBeNull();
    expect(commentText("🙏".repeat(COMMENT_TEXT_MAX + 1))).toBeNull();
  });
});
