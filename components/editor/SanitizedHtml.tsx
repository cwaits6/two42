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
  const [clean, setClean] = useState<string | null>(null);

  useEffect(() => {
    setClean(DOMPurify.sanitize(html));
  }, [html]);

  if (clean === null) {
    return <div className="h-16 rounded-lg bg-muted/30 animate-pulse" />;
  }

  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
