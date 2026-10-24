import { describe, expect, it } from "vitest";
import { normalizeBlocks, parseStoredBlocks } from "./normalizeBlocks";
import groupASummary from "./fixtures/group-a-summary.json";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });

describe("normalizeBlocks on the stored Group A summary", () => {
  const blocks = normalizeBlocks(groupASummary);

  it("keeps every block, in order, with its id", () => {
    expect(blocks).toHaveLength(groupASummary.length);
    expect(blocks.map((b) => b.id)).toEqual(groupASummary.map((b) => b.id));
  });

  it("renders the leading level-1 heading as level 2", () => {
    expect(blocks[0]).toMatchObject({ type: "heading", props: { level: 2 } });
    expect(blocks[0].content).toEqual([text("Our Class: A Story of Faith, Fellowship, and Growth")]);
  });

  it("keeps paragraphs and numbered list items as they are", () => {
    expect(blocks.map((b) => b.type)).toEqual(groupASummary.map((b) => b.type));
    expect(blocks.filter((b) => b.type === "numberedListItem")).toHaveLength(3);
  });

  it("drops the colour, alignment and toggle props the old editor stored", () => {
    for (const block of blocks) {
      expect(block.props ?? {}).not.toHaveProperty("textColor");
      expect(block.props ?? {}).not.toHaveProperty("backgroundColor");
      expect(block.props ?? {}).not.toHaveProperty("textAlignment");
      expect(block.props ?? {}).not.toHaveProperty("isToggleable");
    }
  });

  it("is idempotent", () => {
    expect(normalizeBlocks(blocks)).toEqual(blocks);
  });
});

describe("normalizeBlocks on dropped block types", () => {
  it("turns a code block into a paragraph holding its code", () => {
    expect(normalizeBlocks([{ type: "codeBlock", props: { language: "js" }, content: "const x = 1;" }])).toEqual([
      { id: undefined, type: "paragraph", content: [text("const x = 1;")], children: [] },
    ]);
  });

  it("keeps a check list item's text and a toggle list item's text as paragraphs", () => {
    const out = normalizeBlocks([
      { type: "checkListItem", props: { checked: true }, content: [text("Bring bread")] },
      { type: "toggleListItem", content: [text("Details")] },
    ]);
    expect(out.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(out[0].content).toEqual([text("Bring bread")]);
  });

  it("keeps a media block's caption, or its file name, and drops one with neither", () => {
    const out = normalizeBlocks([
      { type: "image", props: { url: "https://x/a.png", caption: "Sunday picnic" } },
      { type: "file", props: { url: "https://x/b.pdf", name: "handout.pdf", caption: "" } },
      { type: "video", props: { url: "https://x/c.mp4" } },
      { type: "divider" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].content).toEqual([text("Sunday picnic")]);
    expect(out[1].content).toEqual([text("handout.pdf")]);
  });

  it("flattens a table to its cell text", () => {
    const out = normalizeBlocks([
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [{ cells: [[text("Name")], [text("Role")]] }, { cells: [{ content: [text("Ann")] }, [text("Host")]] }],
        },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("paragraph");
    expect(out[0].content).toEqual(
      [text("Name"), text(" "), text("Role"), text(" "), text("Ann"), text(" "), text("Host"), text(" ")],
    );
  });

  it("keeps the children of a dropped block even when it has no text of its own", () => {
    const out = normalizeBlocks([
      { type: "image", props: { url: "https://x/a.png" }, children: [{ type: "bulletListItem", content: [text("nested")] }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].children).toEqual([{ id: undefined, type: "bulletListItem", content: [text("nested")], children: [] }]);
  });

  it("ignores entries that are not blocks", () => {
    expect(normalizeBlocks([null, 42, "text", [], { type: 7 }])).toEqual([]);
  });
});

describe("normalizeBlocks on inline content", () => {
  it("keeps bold and italic, drops every other style", () => {
    const out = normalizeBlocks([
      {
        type: "paragraph",
        content: [text("a", { bold: true, underline: true, strike: true, code: true, textColor: "red", backgroundColor: "blue", italic: true })],
      },
    ]);
    expect(out[0].content).toEqual([text("a", { bold: true, italic: true })]);
  });

  it("keeps links with their href and filters the styles inside them", () => {
    const out = normalizeBlocks([
      {
        type: "paragraph",
        content: [{ type: "link", href: "https://example.com", content: [text("site", { italic: true, underline: true })] }],
      },
    ]);
    expect(out[0].content).toEqual([{ type: "link", href: "https://example.com", content: [text("site", { italic: true })] }]);
  });

  it("degrades a link with no href to its text, drops one with no text, and keeps the text inside an unknown inline type", () => {
    const out = normalizeBlocks([
      {
        type: "paragraph",
        content: [
          { type: "link", content: [text("orphan")] },
          { type: "link", href: "https://example.com", content: [] },
          { type: "mention", props: { user: "ann" }, content: [text("@Ann")] },
          text("!"),
        ],
      },
    ]);
    expect(out[0].content).toEqual([text("orphan"), text("@Ann"), text("!")]);
  });
});

describe("normalizeBlocks on heading levels", () => {
  it.each([
    [1, 2],
    [2, 2],
    [3, 3],
    [4, 3],
    [6, 3],
    [undefined, 2],
    ["2", 2],
  ])("maps a stored level of %s to %s", (stored, expected) => {
    const out = normalizeBlocks([{ type: "heading", props: { level: stored }, content: [text("h")] }]);
    expect(out[0]).toMatchObject({ type: "heading", props: { level: expected } });
  });
});

describe("parseStoredBlocks", () => {
  it("returns null for an empty body, a legacy HTML body, or a JSON value that is not an array", () => {
    expect(parseStoredBlocks("")).toBeNull();
    expect(parseStoredBlocks(null)).toBeNull();
    expect(parseStoredBlocks(undefined)).toBeNull();
    expect(parseStoredBlocks("<p>Welcome</p>")).toBeNull();
    expect(parseStoredBlocks('{"type":"paragraph"}')).toBeNull();
  });

  it("returns an empty array for an empty document", () => {
    expect(parseStoredBlocks("[]")).toEqual([]);
  });

  it("returns the normalised blocks for a stored document", () => {
    const out = parseStoredBlocks(JSON.stringify(groupASummary));
    expect(out).toEqual(normalizeBlocks(groupASummary));
  });
});
