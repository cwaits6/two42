"use server";

import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { normalizeBlocks } from "./normalizeBlocks";
import { curatedSchema, type CuratedPartialBlock } from "./schema";

// `ServerBlockNoteEditor` renders blocks to HTML using jsdom, which depends on
// Node built-ins and therefore cannot be bundled into a client component. This
// server action keeps that work on the server; callers sanitize the returned
// HTML on the client before injecting it.
export async function renderBlocksToFullHTML(
  blocks: CuratedPartialBlock[],
): Promise<string> {
  // A server action is a public endpoint, so the payload is normalised here
  // too: the renderer throws on any block type or style outside the schema.
  return ServerBlockNoteEditor.create({ schema: curatedSchema }).blocksToFullHTML(
    normalizeBlocks(blocks),
  );
}
