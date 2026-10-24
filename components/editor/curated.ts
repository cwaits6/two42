// The names of what the curated schema keeps, kept free of any BlockNote import
// so the normaliser can ship to client read paths that never load the editor.
export const HEADING_LEVELS = [2, 3] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export const KEPT_STYLES = ["bold", "italic"] as const;
export type KeptStyle = (typeof KEPT_STYLES)[number];

export const TEXT_BLOCK_TYPES = ["paragraph", "bulletListItem", "numberedListItem", "quote"] as const;
export type TextBlockType = (typeof TEXT_BLOCK_TYPES)[number];
