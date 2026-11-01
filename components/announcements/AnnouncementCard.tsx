import { SanitizedHtml } from "@/components/editor/SanitizedHtml";
import { StaticBlockContent } from "@/components/editor/StaticBlockContent";
import { parseStoredBlocks } from "@/components/editor/normalizeBlocks";
import { formatInZone } from "@/lib/time/zone";
import type { Announcement } from "@/lib/types";

interface AnnouncementCardProps {
  announcement: Announcement;
  /** The church's zone; the date is the day it was published there. */
  timeZone: string;
}

export function AnnouncementCard({ announcement, timeZone }: AnnouncementCardProps) {
  const date = formatInZone(announcement.published_at || announcement.created_at, timeZone, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  // A body that is not a block document is a legacy HTML announcement.
  const blocks = parseStoredBlocks(announcement.content);

  return (
    <article
      id={announcement.id}
      className="scroll-mt-24 rounded-2xl border border-border bg-card p-6 md:p-8"
    >
      <h2 className="font-serif text-2xl font-medium leading-tight text-foreground">
        {announcement.title}
      </h2>
      <p className="mt-1 text-base text-muted-foreground">{date}</p>

      <div className="mt-4 text-base leading-relaxed text-foreground">
        {blocks ? (
          <StaticBlockContent blocks={blocks} />
        ) : (
          <SanitizedHtml
            html={announcement.content}
            className="[&_a]:text-brand-primary-text [&_a]:underline [&_a:hover]:text-foreground [&_strong]:font-semibold"
          />
        )}
      </div>
    </article>
  );
}
