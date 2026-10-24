"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";
import { Megaphone } from "lucide-react";
import { StaticBlockContent } from "@/components/editor/StaticBlockContent";
import { parseStoredBlocks } from "@/components/editor/normalizeBlocks";
import type { Announcement } from "@/lib/types";

interface AnnouncementCardProps {
  announcement: Announcement;
}

export function AnnouncementCard({ announcement }: AnnouncementCardProps) {
  const date = new Date(announcement.published_at || announcement.created_at);
  // A body that is not a block document is a legacy HTML announcement.
  const blocks = useMemo(() => parseStoredBlocks(announcement.content), [announcement.content]);

  return (
    <div
      id={announcement.id}
      className="scroll-mt-24 bg-white rounded-2xl border-2 border-border overflow-hidden hover:border-brand-accent/40 hover:shadow-lg transition-all duration-200"
    >
      {/* Top accent */}
      <div
        className="h-1.5 w-full bg-brand-accent"
      />

      <div className="p-6 md:p-8">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "var(--color-brand-bg-light)" }}
          >
            <Megaphone className="h-5 w-5 text-brand-accent" />
          </div>
          <div>
            <h3 className="font-display text-xl font-bold text-slate-800 leading-tight">
              {announcement.title}
            </h3>
            <p className="text-base text-slate-600 font-medium">
              {date.toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        {blocks ? (
          <div className="text-base text-slate-600 leading-relaxed">
            <StaticBlockContent blocks={blocks} />
          </div>
        ) : (
          <div
            className="text-base text-slate-600 leading-relaxed [&_a]:text-brand-accent [&_a]:underline [&_a:hover]:text-brand-accent/90 [&_strong]:font-semibold [&_strong]:text-slate-800"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(announcement.content) }}
          />
        )}
      </div>
    </div>
  );
}
