import type { CuratedPartialBlock, HeadingLevel } from "./schema";

// Shapes a stored document may carry from the unrestricted editor. Only the
// fields the normaliser reads are typed; everything else is ignored.
type StoredStyles = Record<string, unknown>;
type StoredText = { type?: unknown; text?: unknown; styles?: unknown; content?: unknown; href?: unknown };
type StoredBlock = {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
};

type CuratedStyles = { bold?: true; italic?: true };
type CuratedText = { type: "text"; text: string; styles: CuratedStyles };
type CuratedLink = { type: "link"; href: string; content: CuratedText[] };
type CuratedInline = CuratedText | CuratedLink;

const KEPT_STYLES = ["bold", "italic"] as const;
const TEXT_BLOCK_TYPES = ["paragraph", "bulletListItem", "numberedListItem", "quote"] as const;
type TextBlockType = (typeof TEXT_BLOCK_TYPES)[number];

function isTextBlockType(type: unknown): type is TextBlockType {
  return TEXT_BLOCK_TYPES.includes(type as TextBlockType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keptStyles(styles: unknown): CuratedStyles {
  const out: CuratedStyles = {};
  if (!isRecord(styles)) return out;
  for (const style of KEPT_STYLES) {
    if ((styles as StoredStyles)[style] === true) out[style] = true;
  }
  return out;
}

function textOf(item: StoredText): CuratedText | null {
  if (typeof item.text !== "string") return null;
  return { type: "text", text: item.text, styles: keptStyles(item.styles) };
}

function textsOf(items: unknown): CuratedText[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const text = textOf(item);
    return text ? [text] : [];
  });
}

function inlineOf(item: unknown): CuratedInline[] {
  if (!isRecord(item)) return [];
  if (item.type === "link" && typeof item.href === "string") {
    const content = textsOf(item.content);
    return content.length ? [{ type: "link", href: item.href, content }] : [];
  }
  const text = textOf(item);
  if (text) return [text];
  // An inline type with no text of its own (a mention, an equation) keeps
  // whatever nested text it carried so the sentence stays readable.
  return textsOf(item.content);
}

function inlineContent(content: unknown): CuratedInline[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content, styles: {} }] : [];
  }
  if (Array.isArray(content)) return content.flatMap(inlineOf);
  if (isRecord(content) && Array.isArray(content.rows)) {
    // A table flattens to its cell text, one space between cells.
    return content.rows.flatMap((row) => {
      if (!isRecord(row) || !Array.isArray(row.cells)) return [];
      return row.cells.flatMap((cell) => {
        const cellContent = isRecord(cell) && "content" in cell ? cell.content : cell;
        const inline = inlineContent(cellContent);
        return inline.length ? [...inline, { type: "text" as const, text: " ", styles: {} }] : [];
      });
    });
  }
  return [];
}

function headingLevel(level: unknown): HeadingLevel {
  return typeof level === "number" && level >= 3 ? 3 : 2;
}

function inlineText(content: CuratedInline[]): string {
  return content
    .map((item) => (item.type === "text" ? item.text : item.content.map((t) => t.text).join("")))
    .join("");
}

function normalizeBlock(block: StoredBlock): CuratedPartialBlock | null {
  const id = typeof block.id === "string" ? block.id : undefined;
  const children = normalizeBlocks(block.children);
  const content = inlineContent(block.content);
  const props = isRecord(block.props) ? block.props : {};

  if (block.type === "heading") {
    return { id, type: "heading", props: { level: headingLevel(props.level) }, content, children };
  }
  if (isTextBlockType(block.type)) {
    return { id, type: block.type, content, children };
  }

  // A dropped block type (media, code, table, check list, divider, ...)
  // degrades to a paragraph holding whatever text it had. Media blocks keep
  // their caption or file name; a block with no text and no children is
  // dropped rather than left as a blank line.
  const fallback = content.length
    ? content
    : [props.caption, props.name].find((v): v is string => typeof v === "string" && v.trim() !== "");
  const paragraphContent = Array.isArray(fallback)
    ? fallback
    : fallback
      ? [{ type: "text" as const, text: fallback, styles: {} }]
      : [];
  if (inlineText(paragraphContent).trim() === "" && children.length === 0) return null;
  return { id, type: "paragraph", content: paragraphContent, children };
}

/**
 * Reduces a stored BlockNote document to the curated schema: kept blocks keep
 * their text, bold, italic and links; headings clamp to levels 2 and 3; every
 * other block type becomes a paragraph. Idempotent, so a document may pass
 * through it more than once on its way to the editor or the renderer.
 */
export function normalizeBlocks(input: unknown): CuratedPartialBlock[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((block) => {
    if (!isRecord(block)) return [];
    const normalized = normalizeBlock(block);
    return normalized ? [normalized] : [];
  });
}

/**
 * Parses a stored body. Returns null when the text is not a JSON array (an
 * empty column, or a legacy HTML body); otherwise the normalised blocks,
 * which may be an empty array.
 */
export function parseStoredBlocks(raw: string | null | undefined): CuratedPartialBlock[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return normalizeBlocks(parsed);
}
