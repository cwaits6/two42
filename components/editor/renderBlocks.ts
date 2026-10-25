import { BlockNoteEditor } from "@blocknote/core";
import { normalizeBlocks } from "./normalizeBlocks";
import { curatedSchema, type CuratedPartialBlock } from "./schema";

// Renders in the browser against the real DOM. The server-side renderer pulls
// in jsdom, which fails to load in the deployed function runtime; callers
// sanitize the returned HTML before injecting it.
export function renderBlocksToFullHTML(blocks: CuratedPartialBlock[]): string {
  // Stored documents may predate the curated schema, and the renderer throws
  // on any block type or style outside it.
  return BlockNoteEditor.create({ schema: curatedSchema }).blocksToFullHTML(
    normalizeBlocks(blocks),
  );
}
