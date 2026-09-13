"use client";

import { useMemo } from "react";
import { StaticBlockContent } from "@/components/editor/StaticBlockContent";
import type { PartialBlock } from "@blocknote/core";

interface PageRendererProps {
  body: string;
}

export function PageRenderer({ body }: PageRendererProps) {
  const blocks = useMemo<PartialBlock[] | undefined>(() => {
    try {
      const parsed = JSON.parse(body);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }, [body]);

  if (!blocks?.length) {
    return <p className="text-lg text-muted-foreground">This page has no content yet.</p>;
  }

  return <StaticBlockContent blocks={blocks} />;
}
