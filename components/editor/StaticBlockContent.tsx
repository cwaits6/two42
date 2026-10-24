"use client";

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { renderBlocksToFullHTML } from "./renderBlocks";
import type { CuratedPartialBlock } from "./schema";
import "./BlockContent.css";
import "./StaticBlockContent.css";

interface StaticBlockContentProps {
  blocks: CuratedPartialBlock[];
}

export function StaticBlockContent({ blocks }: StaticBlockContentProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    renderBlocksToFullHTML(blocks)
      .then((raw) => {
        if (!cancelled) setHtml(DOMPurify.sanitize(raw));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [blocks]);

  if (error) {
    return <p className="text-base text-muted-foreground">Unable to display this content.</p>;
  }

  if (html === null) {
    return <div className="h-64 rounded-lg border border-input bg-muted/30 animate-pulse" />;
  }

  return <div className="bn-static" dangerouslySetInnerHTML={{ __html: html }} />;
}
