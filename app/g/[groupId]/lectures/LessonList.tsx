import { Fragment } from "react";
import Link from "next/link";
import { PlayCircle } from "lucide-react";

/** Joins the parts that are present with " · ", so a missing part leaves no stray separator. */
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
          {i > 0 && " · "}
          {part}
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
        <li key={lesson.id}>
          <Link
            href={`${libraryHref}/${lesson.id}`}
            className="group flex min-h-16 items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50"
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
        </li>
      ))}
    </ul>
  );
}
