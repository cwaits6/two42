import { Fragment } from "react";
import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Joins the parts that are present with " · ", so a missing part leaves no
 * stray separator. A line breaks between parts, never inside one, unless a
 * single part is wider than the whole line.
 */
export function MetaLine({
  parts,
  className = "block text-base text-muted-foreground",
}: {
  parts: React.ReactNode[];
  className?: string;
}) {
  const present = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  if (present.length === 0) return null;
  return (
    <span className={className}>
      {present.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="inline-block max-w-full">
            {part}
            {/* A no-break space, so a wrap inside the part takes its last word along with the dot. */}
            {i < present.length - 1 && "\u00a0·"}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

export type LessonListItem = {
  id: string;
  title: string;
  description?: string | null;
  meta: React.ReactNode[];
  /** Present only for someone who may edit it. */
  editHref?: string;
};

export function LessonList({
  libraryHref,
  lessons,
}: {
  libraryHref: string;
  lessons: LessonListItem[];
}) {
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
      {lessons.map((lesson) => (
        <li key={lesson.id} className="flex items-center">
          <Link
            href={`${libraryHref}/${lesson.id}`}
            className="group flex min-h-16 min-w-0 flex-1 items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-medium text-foreground group-hover:text-brand-primary-text">
                {lesson.title}
              </span>
              {lesson.description && (
                <span className="mt-0.5 block text-base text-muted-foreground line-clamp-2">
                  {lesson.description}
                </span>
              )}
              <MetaLine parts={lesson.meta} />
            </span>
            <PlayCircle className="size-6 shrink-0 text-brand-primary-text" aria-hidden="true" />
          </Link>
          {lesson.editHref && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={lesson.editHref} />}
              aria-label={`Edit ${lesson.title}`}
              className="mr-4"
            >
              Edit
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
