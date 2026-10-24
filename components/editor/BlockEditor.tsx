"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import "./BlockContent.css";
import "./BlockEditor.css";
import { BlockNoteEditor, filterSuggestionItems } from "@blocknote/core";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  DragHandleMenu,
  FormattingToolbar,
  FormattingToolbarController,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useState } from "react";
import { normalizeBlocks } from "./normalizeBlocks";
import { curatedSchema, type CuratedBlock, type CuratedPartialBlock } from "./schema";

type CuratedEditor = ReturnType<typeof createEditor>;

interface BlockEditorProps {
  initialContent?: CuratedPartialBlock[];
  onChange?: (blocks: CuratedBlock[]) => void;
  editable?: boolean;
}

function createEditor(initialContent?: CuratedPartialBlock[]) {
  return BlockNoteEditor.create({
    schema: curatedSchema,
    initialContent: initialContent?.length ? initialContent : undefined,
    // The editor's own HTML and markdown parsers map <h1>, <h4>-<h6> and inline
    // colour/alignment styles onto props the schema still allows, so pasted
    // content is curated here before it is inserted.
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      const data = event.clipboardData;
      if (!data || data.types.includes("Files") || data.types.includes("blocknote/html")) {
        return defaultPasteHandler();
      }
      const html = data.getData("text/html");
      const plain = data.getData("text/plain");
      let parsed: unknown;
      try {
        if (html) parsed = editor.tryParseHTMLToBlocks(html);
        else if (plain) parsed = editor.tryParseMarkdownToBlocks(plain);
        else return defaultPasteHandler();
      } catch {
        return defaultPasteHandler();
      }
      const blocks = normalizeBlocks(parsed);
      if (blocks.length === 0) return true;

      const current = editor.getTextCursorPosition().block;
      const isEmpty = Array.isArray(current.content) && current.content.length === 0 && current.children.length === 0;
      if (isEmpty) editor.replaceBlocks([current], blocks);
      else editor.insertBlocks(blocks, current, "after");
      return true;
    },
  });
}

// The default items follow the schema, so only the emoji entry needs removing.
// The items carry their `key` at runtime but the React item type omits it.
function slashMenuItems(editor: CuratedEditor) {
  return getDefaultReactSlashMenuItems(editor).filter(
    (item) => (item as { key?: string }).key !== "emoji",
  );
}

function CuratedFormattingToolbar() {
  return (
    <FormattingToolbar>
      <BlockTypeSelect key="blockType" />
      <BasicTextStyleButton basicTextStyle="bold" key="bold" />
      <BasicTextStyleButton basicTextStyle="italic" key="italic" />
      <CreateLinkButton key="link" />
    </FormattingToolbar>
  );
}

// The default drag-handle menu offers block colours, which the schema's
// props still allow; this one offers only delete.
function CuratedDragHandleMenu() {
  return (
    <DragHandleMenu>
      <RemoveBlockItem>Delete block</RemoveBlockItem>
    </DragHandleMenu>
  );
}

function CuratedSideMenu() {
  return <SideMenu dragHandleMenu={CuratedDragHandleMenu} />;
}

export default function BlockEditor({
  initialContent,
  onChange,
  editable = true,
}: BlockEditorProps) {
  const [editor] = useState(() => createEditor(initialContent));

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme="light"
      formattingToolbar={false}
      slashMenu={false}
      sideMenu={false}
      emojiPicker={false}
      onChange={() => onChange?.(normalizeBlocks(editor.document) as CuratedBlock[])}
    >
      <FormattingToolbarController formattingToolbar={CuratedFormattingToolbar} />
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => filterSuggestionItems(slashMenuItems(editor), query)}
      />
      <SideMenuController sideMenu={CuratedSideMenu} />
    </BlockNoteView>
  );
}
