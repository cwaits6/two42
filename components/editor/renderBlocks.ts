import { BlockNoteEditor } from "@blocknote/core";
import { normalizeBlocks } from "./normalizeBlocks";
import { curatedSchema, type CuratedPartialBlock } from "./schema";

const createRenderingEditor = () => BlockNoteEditor.create({ schema: curatedSchema });

// Serializing reads only the schema, so one editor renders every card on a page.
let renderingEditor: ReturnType<typeof createRenderingEditor> | undefined;

// Renders in the browser against the real DOM. The server-side renderer pulls
// in jsdom, which fails to load in the deployed function runtime; callers
// sanitize the returned HTML before injecting it.
export function renderBlocksToFullHTML(blocks: CuratedPartialBlock[]): string {
  renderingEditor ??= createRenderingEditor();
  // Stored documents may predate the curated schema, and the renderer throws
  // on any block type or style outside it.
  return renderingEditor.blocksToFullHTML(normalizeBlocks(blocks));
}
