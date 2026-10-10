import { createClient } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { notFound } from "next/navigation";
import Link from "next/link";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";

type SeriesDetail = {
  id: string;
  name: string;
  teacher: string | null;
  is_archived: boolean;
  created_at: string;
};

type LectureRow = {
  id: string;
  title: string;
  description: string | null;
  lecture_date: string | null;
};

function formatShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatMonthYear(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("lecture_series")
    .select("name")
    .eq("id", id)
    .single();
  return {
    title: data ? `${data.name} | ${siteConfig.name}` : `Series | ${siteConfig.name}`,
  };
}

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireActiveGroup(groupId);
  const libraryHref = groupPath(group.id, "/lectures");
  const supabase = await createClient();

  const [{ data: seriesData }, { data: lecturesData }] = await Promise.all([
    supabase.from("lecture_series").select("*").eq("id", id).single(),
    supabase
      .from("lectures")
      .select("id, title, description, lecture_date")
      .eq("series_id", id)
      .order("lecture_date", { ascending: true }),
  ]);

  if (!seriesData) notFound();
  const series = seriesData as SeriesDetail;
  const lecturesAsc = (lecturesData ?? []) as LectureRow[];

  // Build display list: newest first, but week numbers from asc index
  const withWeeks = lecturesAsc.map((l, i) => ({ ...l, weekNumber: i + 1 }));
  const display = [...withWeeks].reverse();

  // Date range
  const datedLectures = lecturesAsc.filter((l) => l.lecture_date);
  const firstDate = datedLectures[0]?.lecture_date ?? null;
  const lastDate = datedLectures[datedLectures.length - 1]?.lecture_date ?? null;
  let dateRange: string | null = null;
  if (firstDate) {
    const startLabel = formatMonthYear(firstDate);
    if (series.is_archived) {
      const endLabel = lastDate ? formatMonthYear(lastDate) : null;
      dateRange = endLabel && endLabel !== startLabel ? `${startLabel} – ${endLabel}` : startLabel;
    } else {
      dateRange = `${startLabel} – present`;
    }
  }

  return (
    <div>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-background">
        <div className="relative px-6 md:px-14 py-12 md:py-16">
          {/* Back link */}
          <Link
            href={libraryHref}
            className="font-sans text-base text-muted-foreground uppercase tracking-[0.2em] hover:text-foreground transition-colors inline-flex items-center gap-2 mb-10"
          >
            ← The Lecture Library
          </Link>

          {/* Eyebrow */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-7 h-px bg-brand-accent" />
            <span className="text-brand-accent text-base font-semibold font-sans tracking-[0.2em] uppercase">
              {series.is_archived ? "Past Series" : "Current Series"}
            </span>
          </div>

          {/* Series name */}
          <h1 className="font-display text-5xl md:text-7xl font-medium tracking-tight leading-none mb-4">
            {series.name}
          </h1>

          {/* Teacher */}
          {series.teacher && (
            <p className="font-display italic text-xl md:text-2xl text-muted-foreground mb-6">
              taught by {series.teacher}
            </p>
          )}

          {/* Meta */}
          <div className="flex items-center gap-4 flex-wrap font-sans text-base text-muted-foreground">
            <span>{lecturesAsc.length} {lecturesAsc.length === 1 ? "lecture" : "lectures"}</span>
            {dateRange && (
              <>
                <span className="opacity-40">·</span>
                <span className="font-mono">{dateRange}</span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Lectures list ── */}
      <section className="bg-card border-t border-border">
        <div className="px-6 md:px-14 py-14">
          <div className="mb-8">
            <p className="font-sans text-base text-muted-foreground tracking-[0.15em] uppercase font-semibold mb-1">
              Every lecture
            </p>
            <h2 className="font-display text-3xl font-medium text-foreground tracking-tight">
              Newest first
            </h2>
          </div>

          {display.length === 0 ? (
            <p className="font-display italic text-lg text-muted-foreground">
              No lectures in this series yet.
            </p>
          ) : (
            <div>
              {display.map((lecture) => (
                <SeriesLectureRow key={lecture.id} libraryHref={libraryHref} lecture={lecture} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SeriesLectureRow({
  libraryHref,
  lecture,
}: {
  libraryHref: string;
  lecture: LectureRow & { weekNumber: number };
}) {
  return (
    <Link
      href={`${libraryHref}/${lecture.id}`}
      className="grid grid-cols-[80px_1fr_auto] items-center gap-6 border-t border-border py-5 hover:bg-background -mx-2 px-2 transition-colors"
    >
      <span className="font-sans text-base text-brand-accent tracking-[0.15em] uppercase font-bold">
        Week {String(lecture.weekNumber).padStart(2, "0")}
      </span>
      <div>
        <p className="font-display text-xl font-medium text-foreground tracking-tight">
          {lecture.title}
        </p>
        {lecture.description && (
          <p className="font-sans italic text-lg text-muted-foreground mt-0.5">
            {lecture.description}
          </p>
        )}
      </div>
      <span className="font-mono text-base text-muted-foreground">
        {lecture.lecture_date ? formatShort(lecture.lecture_date) : ""}
      </span>
    </Link>
  );
}
