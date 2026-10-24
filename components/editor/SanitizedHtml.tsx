"use client";

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";

interface SanitizedHtmlProps {
  html: string;
  className?: string;
}

// DOMPurify needs a DOM, so sanitising happens in an effect; during server
// rendering and the first client render only the placeholder is emitted.
export function SanitizedHtml({ html, className }: SanitizedHtmlProps) {
  // The source is kept with its result so a changed prop shows the
  // placeholder rather than the previous markup until the effect runs.
  const [clean, setClean] = useState<{ source: string; markup: string } | null>(null);

  useEffect(() => {
    setClean({ source: html, markup: DOMPurify.sanitize(html) });
  }, [html]);

  if (clean === null || clean.source !== html) {
    return <div className="h-16 rounded-lg bg-muted/30 animate-pulse" />;
  }

  return <div className={className} dangerouslySetInnerHTML={{ __html: clean.markup }} />;
}
