import { describe, expect, it } from "vitest";
import { HEADING_LEVELS, KEPT_STYLES, TEXT_BLOCK_TYPES } from "./curated";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { normalizeBlocks } from "./normalizeBlocks";
import { renderBlocksToFullHTML } from "./renderBlocks";
import { curatedSchema, type CuratedPartialBlock } from "./schema";
import groupASummary from "./fixtures/group-a-summary.json";

// A server action receives whatever the network sends; the cast stands in for
// that untyped payload so the renderer's own normalisation is what is tested.
const asPayload = (blocks: unknown[]) => blocks as CuratedPartialBlock[];

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });

describe("the curated schema and the normaliser agree", () => {
  it("keeps exactly the normaliser's block types", () => {
    expect(Object.keys(curatedSchema.blockSchema).sort()).toEqual(["heading", ...TEXT_BLOCK_TYPES].sort());
  });

  it("keeps exactly the normaliser's styles", () => {
    expect(Object.keys(curatedSchema.styleSchema).sort()).toEqual([...KEPT_STYLES].sort());
  });

  it("offers exactly the heading levels the normaliser clamps to", () => {
    expect(curatedSchema.blockSchema.heading.propSchema.level.values).toEqual(HEADING_LEVELS);
  });
});

describe("renderBlocksToFullHTML on the stored Group A summary", () => {
  it("renders the leading level-1 heading as an h2 and nothing as an h1", async () => {
    const html = await renderBlocksToFullHTML(asPayload(groupASummary));
    expect(html).toMatch(/<h2[^>]*>Our Class: A Story of Faith, Fellowship, and Growth<\/h2>/);
    expect(html).not.toMatch(/<h1\b/);
    expect(html.match(/data-content-type="numberedListItem"/g)).toHaveLength(3);
  });
});

describe("renderBlocksToFullHTML on legacy content", () => {
  const legacy = [
    { type: "heading", props: { level: 1, textColor: "red", textAlignment: "center" }, content: [text("Welcome")] },
    { type: "heading", props: { level: 4 }, content: [text("Deep heading")] },
    {
      type: "paragraph",
      props: { backgroundColor: "yellow" },
      content: [
        text("Plain, "),
        text("bold", { bold: true }),
        text(", "),
        text("underlined", { underline: true, textColor: "blue" }),
        text(" and "),
        { type: "link", href: "https://example.com/", content: [text("a link", { italic: true })] },
      ],
    },
    { type: "quote", content: [text("Be kind")] },
    { type: "codeBlock", props: { language: "js" }, content: "const answer = 42;" },
    { type: "checkListItem", props: { checked: true }, content: [text("Bring bread")] },
    { type: "image", props: { url: "https://example.com/a.png", caption: "Sunday picnic" } },
    {
      type: "table",
      content: { type: "tableContent", rows: [{ cells: [[text("Name")], [text("Role")]] }] },
    },
    { type: "bulletListItem", content: [text("First point")] },
  ];

  it("resolves instead of throwing", async () => {
    await expect(renderBlocksToFullHTML(asPayload(legacy))).resolves.toEqual(expect.any(String));
  });

  it("renders headings as h2 and h3 only", async () => {
    const html = await renderBlocksToFullHTML(asPayload(legacy));
    expect(html).toMatch(/<h2[^>]*>Welcome<\/h2>/);
    expect(html).toMatch(/<h3[^>]*>Deep heading<\/h3>/);
    expect(html).not.toMatch(/<h[1456]\b/);
  });

  it("keeps bold, italic and links and drops the other styles", async () => {
    const html = await renderBlocksToFullHTML(asPayload(legacy));
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/<a [^>]*href="https:\/\/example.com\/"[^>]*>(<em>)?a link/);
    expect(html).toContain("underlined");
    expect(html).not.toMatch(/<u\b/);
    expect(html).not.toMatch(/data-text-color|data-background-color|data-text-alignment/);
  });

  it("renders dropped block types as plain paragraphs holding their text", async () => {
    const html = await renderBlocksToFullHTML(asPayload(legacy));
    for (const kept of ["const answer = 42;", "Bring bread", "Sunday picnic", "Name", "Role"]) {
      expect(html).toContain(kept);
    }
    expect(html).not.toMatch(/<pre\b|<code\b|<table\b|<img\b|<input\b|<figure\b/);
    expect(html).toMatch(/<blockquote[^>]*>Be kind<\/blockquote>/);
    expect(html).toMatch(/data-content-type="bulletListItem"><p[^>]*>First point/);
  });
});

describe("pasted HTML parsed by the editor's own parser", () => {
  it("is curated to a level-2 heading and a paragraph without colour or alignment", async () => {
    const editor = ServerBlockNoteEditor.create({ schema: curatedSchema });
    const parsed = await editor.tryParseHTMLToBlocks(
      '<h1>Big</h1><p style="color:red;text-align:center">x</p>',
    );
    const [heading, paragraph] = normalizeBlocks(parsed);
    expect(heading).toMatchObject({ type: "heading", props: { level: 2 } });
    expect(paragraph.type).toBe("paragraph");
    expect(paragraph.props ?? {}).not.toHaveProperty("textColor");
    expect(paragraph.props ?? {}).not.toHaveProperty("textAlignment");
  });
});
