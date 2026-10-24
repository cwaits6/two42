import {
  BlockNoteSchema,
  createBulletListItemBlockSpec,
  createHeadingBlockSpec,
  createNumberedListItemBlockSpec,
  createParagraphBlockSpec,
  createQuoteBlockSpec,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";

export const HEADING_LEVELS = [2, 3] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

// The one schema the editor and the server renderer share. Anything a stored
// document carries that is not here must go through `normalizeBlocks` first,
// because BlockNote throws on a block type or style it does not know.
export const curatedSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: createParagraphBlockSpec(),
    // The page owns its H1, so the editor offers levels 2 and 3 only; the
    // keyboard shortcuts and `##` input rules follow the same list.
    heading: createHeadingBlockSpec({
      levels: HEADING_LEVELS,
      defaultLevel: 2,
      allowToggleHeadings: false,
    }),
    bulletListItem: createBulletListItemBlockSpec(),
    numberedListItem: createNumberedListItemBlockSpec(),
    quote: createQuoteBlockSpec(),
  },
  inlineContentSpecs: {
    text: defaultInlineContentSpecs.text,
    link: defaultInlineContentSpecs.link,
  },
  styleSpecs: {
    bold: defaultStyleSpecs.bold,
    italic: defaultStyleSpecs.italic,
  },
});

export type CuratedSchema = typeof curatedSchema;
export type CuratedBlock = CuratedSchema["Block"];
export type CuratedPartialBlock = CuratedSchema["PartialBlock"];
export type CuratedBlockType = keyof CuratedSchema["blockSchema"];
