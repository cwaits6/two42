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
  });
}

// The default items follow the schema, so only the emoji entry needs removing.
function slashMenuItems(editor: CuratedEditor) {
  const emojiTitle = editor.dictionary.slash_menu.emoji.title;
  return getDefaultReactSlashMenuItems(editor).filter((item) => item.title !== emojiTitle);
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
      onChange={() => onChange?.(editor.document)}
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
