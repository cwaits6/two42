import { createClient } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import Link from "next/link";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";

export const metadata = { title: `Lectures | ${siteConfig.name}` };

// ── Types ─────────────────────────────────────────────────────────────────────

type LectureWithSeries = {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  lecture_date: string | null;
  week_number: number | null;
  scripture_reference: string | null;
  summary: string | null;
  series_id: string | null;
  lecture_series: { id: string; name: string; teacher: string | null } | null;
};

type LectureSeries = {
  id: string;
  name: string;
  teacher: string | null;
  is_archived: boolean;
  created_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?\s]+)/
  );
  return match ? match[1] : null;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function LecturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const libraryHref = groupPath(group.id, "/lectures");
  const { view } = await searchParams;
  const isAllView = view === "all";
  const supabase = await createClient();

  // All lectures joined with their series, most recent first.
  // Push null-dated lectures to the end so they never surface as "Most recent".
  const { data: lecturesData } = await supabase
    .from("lectures")
    .select("*, lecture_series(id, name, teacher)")
    .order("lecture_date", { ascending: false, nullsFirst: false });

  const allLectures = (lecturesData ?? []) as LectureWithSeries[];

  // All series — current = not archived, past = archived
  const { data: seriesData } = await supabase
    .from("lecture_series")
    .select("id, name, teacher, is_archived, created_at")
    .order("created_at", { ascending: false });

  const allSeries = (seriesData ?? []) as LectureSeries[];
  const activeSeries = allSeries.filter((s) => !s.is_archived);
  const pastSeries = allSeries.filter((s) => s.is_archived);

  const activeSeriesIds = new Set(activeSeries.map((s) => s.id));
  const allActiveLectures = allLectures.filter(
    (l) => l.series_id && activeSeriesIds.has(l.series_id)
  );
  const standaloneLectures = allLectures.filter((l) => !l.series_id);

  // Featured: most recent lecture across active series, fallback to standalone
  const featured: LectureWithSeries | null =
    allActiveLectures[0] ?? standaloneLectures[0] ?? null;

  // Global week map: assign Week N to lectures within each series by date asc
  const globalWeekMap = new Map<string, number>();
  for (const series of allSeries) {
    const lecturesInSeries = allLectures
      .filter((l) => l.series_id === series.id)
      .sort((a, b) => {
        if (a.lecture_date && b.lecture_date)
          return new Date(a.lecture_date).getTime() - new Date(b.lecture_date).getTime();
        return 0;
      });
    lecturesInSeries.forEach((l, i) => globalWeekMap.set(l.id, i + 1));
  }

  const isEmpty = allLectures.length === 0;

  return (
    <div>
      {/* ── Section 1: Hero Banner ── */}
      <section className="relative overflow-hidden bg-background">
        <div className="relative px-6 md:px-14 py-16 md:py-24">
          {/* Headline */}
          <h1 className="font-display text-5xl md:text-6xl font-medium tracking-tight leading-none mb-5">
            Lecture Library
          </h1>

          {/* Subtext */}
          <p className="font-sans text-base md:text-lg text-muted-foreground max-w-xl leading-relaxed mb-10">
            Every Sunday&apos;s teaching, searchable and available to watch
            anytime.
          </p>

          {/* Empty state */}
          {isEmpty && (
            <p className="font-sans text-muted-foreground text-lg mt-4">
              No lectures yet — check back soon.
            </p>
          )}

          {/* Featured lecture card */}
          {featured && (
            <FeaturedCard
              libraryHref={libraryHref}
              lecture={featured}
              weekNumber={globalWeekMap.get(featured.id) ?? null}
            />
          )}
        </div>
      </section>

      {/* ── View toggle ── */}
      {!isEmpty && (
        <div className="border-t border-border bg-background px-6 md:px-14 py-4 flex items-center gap-2">
          <Link
            href={libraryHref}
            className={`font-sans text-sm font-semibold px-4 py-2 rounded-full transition-colors ${
              !isAllView
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            By Series
          </Link>
          <Link
            href={`${libraryHref}?view=all`}
            className={`font-sans text-sm font-semibold px-4 py-2 rounded-full transition-colors ${
              isAllView
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Lectures
          </Link>
        </div>
      )}

      {/* ── All Lectures (flat chronological) ── */}
      {isAllView && (
        <section className="bg-card border-t border-border">
          <div className="px-6 md:px-14 py-14">
            <div className="flex flex-col">
              {allLectures.map((lecture) => (
                <AllLectureRow
                  key={lecture.id}
                  libraryHref={libraryHref}
                  lecture={lecture}
                  weekNumber={globalWeekMap.get(lecture.id) ?? null}
                />
              ))}
              {allLectures.length === 0 && (
                <p className="font-sans text-muted-foreground">No lectures yet.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Section 2: Per active series ── */}
      {!isAllView && (<>
      {(activeSeries ?? []).map((series: LectureSeries) => {
        const seriesLectures = allActiveLectures.filter(
          (l) => l.series_id === series.id
        );
        // Exclude the globally featured lecture from each series list
        if (seriesLectures.length === 0) return null;

        // Auto week numbers: sorted by date asc → Week 1 = earliest
        const chronological = [...seriesLectures].sort((a, b) => {
          if (a.lecture_date && b.lecture_date)
            return new Date(a.lecture_date).getTime() - new Date(b.lecture_date).getTime();
          return 0;
        });
        const weekMap = new Map(chronological.map((l, i) => [l.id, i + 1]));

        // Display order: most recent first (desc), featured excluded
        const rows = [...seriesLectures]
          .sort((a, b) => {
            if (a.lecture_date && b.lecture_date)
              return new Date(b.lecture_date).getTime() - new Date(a.lecture_date).getTime();
            return 0;
          })
          .filter((l) => !featured || l.id !== featured.id);

        return (
          <section key={series.id} className="bg-card border-t border-border">
            <div className="px-6 md:px-14 py-14">
              {/* Series header */}
              <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <p className="font-sans text-base text-muted-foreground tracking-[0.15em] uppercase font-semibold mb-1">
                    CURRENT SERIES · {seriesLectures.length} parts
                  </p>
                  <h2 className="font-display text-3xl font-medium text-foreground tracking-tight">
                    {series.name}
                    {series.teacher && (
                      <span className="text-muted-foreground italic font-normal">
                        {" "}· {series.teacher}
                      </span>
                    )}
                  </h2>
                </div>
                <Link
                  href={`${libraryHref}/series/${series.id}`}
                  className="font-sans text-sm font-semibold text-brand-primary hover:opacity-80 transition-opacity"
                >
                  View full series →
                </Link>
              </div>

              {/* Lecture rows */}
              {rows.length > 0 && (
                <div>
                  {rows.map((lecture, index) => (
                    <LectureRow
                      key={lecture.id}
                      libraryHref={libraryHref}
                      lecture={lecture}
                      weekNumber={weekMap.get(lecture.id) ?? index + 1}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        );
      })}

      {/* ── Section 3: Past series grid ── */}
      {pastSeries && pastSeries.length > 0 && (
        <section className="bg-background border-t border-border">
          <div className="px-6 md:px-14 py-14">
            <div className="mb-8">
              <h2 className="font-display text-3xl font-medium text-foreground tracking-tight">
                Past Series
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {(pastSeries as LectureSeries[]).map((s, index) => (
                <PastSeriesCard key={s.id} libraryHref={libraryHref} series={s} index={index} />
              ))}
            </div>
          </div>
        </section>
      )}
      </>)}
    </div>
  );
}

// ── FeaturedCard ──────────────────────────────────────────────────────────────

function FeaturedCard({
  libraryHref,
  lecture,
  weekNumber,
}: {
  libraryHref: string;
  lecture: LectureWithSeries;
  weekNumber: number | null;
}) {
  const youtubeId = getYouTubeId(lecture.video_url);
  const thumbnail =
    lecture.thumbnail_url ||
    (youtubeId
      ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`
      : null);

  const series = lecture.lecture_series;

  return (
    <div className="grid md:grid-cols-[1.3fr_1fr] gap-7 bg-card rounded-2xl border border-border p-5">
      {/* Left: Thumbnail → detail page */}
      <Link
        href={`${libraryHref}/${lecture.id}`}
        className="group relative aspect-video rounded-xl overflow-hidden block"
      >
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- Lecture thumbnails can be arbitrary stored URLs.
          <img
            src={thumbnail}
            alt={lecture.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, var(--color-brand-primary) 0%, var(--color-brand-navy) 100%)",
            }}
          >
            <span className="font-display italic text-4xl text-white/10 text-center absolute inset-0 flex items-center justify-center px-10">
              {lecture.title}
            </span>
          </div>
        )}

        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-brand-accent flex items-center justify-center shadow-xl group-hover:scale-105 transition-transform">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M8 5.14v14l11-7-11-7z" fill="var(--color-brand-navy)" />
            </svg>
          </div>
        </div>

        {/* Most recent badge */}
        <span className="font-sans text-base tracking-widest text-brand-accent font-bold uppercase absolute bottom-3 left-3">
          MOST RECENT
        </span>
      </Link>

      {/* Right: Metadata */}
      <div className="flex flex-col justify-center py-2">
        {(series || weekNumber !== null) && (
          <div className="flex items-center gap-3 mb-3">
            {series && (
              <span className="font-sans text-base text-muted-foreground tracking-[0.15em] uppercase font-semibold">
                {series.name}
              </span>
            )}
            {weekNumber !== null && (
              <span className="font-sans text-base text-brand-accent tracking-[0.15em] uppercase font-bold">
                Week {String(weekNumber).padStart(2, "0")}
              </span>
            )}
          </div>
        )}

        <Link
          href={`${libraryHref}/${lecture.id}`}
          className="group"
        >
          <h2 className="font-display text-4xl font-medium text-foreground leading-tight tracking-tight mb-2 group-hover:text-brand-primary transition-colors">
            {lecture.title}
          </h2>
        </Link>

        {lecture.description && (
          <p className="font-display italic text-lg text-muted-foreground mb-4 leading-snug">
            {lecture.description}
          </p>
        )}

        {lecture.summary ? (
          <div className="mt-2">
            <p className="font-sans text-base text-brand-accent tracking-[0.15em] uppercase font-bold mb-2">
              Class Summary
            </p>
            <p className="font-sans text-lg text-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
              {lecture.summary}
            </p>
            <Link
              href={`${libraryHref}/${lecture.id}`}
              className="font-sans text-sm font-semibold text-brand-primary hover:opacity-80 transition-opacity mt-2 inline-block"
            >
              Read full summary →
            </Link>
          </div>
        ) : (
          <Link
            href={`${libraryHref}/${lecture.id}`}
            className="font-sans text-sm font-semibold text-brand-primary hover:opacity-80 transition-opacity mt-2 inline-block"
          >
            View lecture details →
          </Link>
        )}
      </div>
    </div>
  );
}

// ── LectureRow ────────────────────────────────────────────────────────────────

function LectureRow({
  libraryHref,
  lecture,
  weekNumber,
}: {
  libraryHref: string;
  lecture: LectureWithSeries;
  weekNumber: number;
}) {
  return (
    <Link
      href={`${libraryHref}/${lecture.id}`}
      className="group grid grid-cols-[72px_1fr_auto_auto] items-center gap-6 border-t border-border py-5 -mx-2 px-2 hover:bg-background transition-colors"
    >
      {/* Col 1: Auto week number */}
      <span className="font-sans text-base text-brand-accent tracking-[0.15em] uppercase font-bold">
        {`Week ${String(weekNumber).padStart(2, "0")}`}
      </span>

      {/* Col 2: Title + description */}
      <div>
        <p className="font-display text-xl font-medium text-foreground tracking-tight group-hover:text-brand-primary transition-colors">
          {lecture.title}
        </p>
        {lecture.description && (
          <p className="font-sans italic text-lg text-muted-foreground mt-0.5">
            {lecture.description}
          </p>
        )}
      </div>

      {/* Col 3: Date */}
      <span className="font-mono text-base text-muted-foreground hidden md:block">
        {lecture.lecture_date ? formatDate(lecture.lecture_date) : ""}
      </span>

      {/* Col 4: Play indicator */}
      <span
        className="w-10 h-10 rounded-full bg-brand-warm flex items-center justify-center group-hover:bg-brand-accent transition-colors"
        aria-hidden="true"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M8 5.14v14l11-7-11-7z" fill="var(--color-brand-primary)" />
        </svg>
      </span>
    </Link>
  );
}

// ── AllLectureRow (flat chronological view) ───────────────────────────────────

function AllLectureRow({
  libraryHref,
  lecture,
  weekNumber,
}: {
  libraryHref: string;
  lecture: LectureWithSeries;
  weekNumber: number | null;
}) {
  const seriesName = lecture.lecture_series?.name ?? null;

  return (
    <Link
      href={`${libraryHref}/${lecture.id}`}
      className="group grid grid-cols-[80px_1fr_auto] items-center gap-6 border-t border-border py-5 -mx-2 px-2 hover:bg-background transition-colors"
    >
      {/* Col 1: Date */}
      <span className="font-mono text-base text-muted-foreground">
        {lecture.lecture_date ? formatDate(lecture.lecture_date) : "—"}
      </span>

      {/* Col 2: Title + series */}
      <div>
        <p className="font-display text-xl font-medium text-foreground tracking-tight group-hover:text-brand-primary transition-colors">
          {lecture.title}
        </p>
        {(seriesName || weekNumber !== null) && (
          <div className="flex items-center gap-2 mt-0.5">
            {seriesName && (
              <span className="font-sans text-base text-muted-foreground tracking-wide">
                {seriesName}
              </span>
            )}
            {weekNumber !== null && (
              <span className="font-sans text-base text-brand-accent tracking-[0.12em] uppercase font-bold">
                Week {String(weekNumber).padStart(2, "0")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Col 3: Play indicator */}
      <span
        className="w-10 h-10 rounded-full bg-brand-warm flex items-center justify-center group-hover:bg-brand-accent transition-colors"
        aria-hidden="true"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M8 5.14v14l11-7-11-7z" fill="var(--color-brand-primary)" />
        </svg>
      </span>
    </Link>
  );
}

// ── PastSeriesCard ────────────────────────────────────────────────────────────

const PAST_SERIES_COLORS = [
  { bar: "bg-brand-primary", text: "text-brand-primary" },
  { bar: "bg-brand-accent", text: "text-brand-accent" },
  { bar: "bg-foreground", text: "text-foreground" },
];

function PastSeriesCard({
  libraryHref,
  series,
  index,
}: {
  libraryHref: string;
  series: LectureSeries;
  index: number;
}) {
  const color = PAST_SERIES_COLORS[index % 3];

  return (
    <Link
      href={`${libraryHref}/series/${series.id}`}
      className="group bg-card rounded-2xl border border-border p-6 relative overflow-hidden block hover:border-foreground/30 transition-colors"
    >
      {/* Top color bar */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${color.bar}`} />

      {series.teacher && (
        <p className="font-sans text-base text-muted-foreground tracking-[0.15em] uppercase font-semibold mb-2 mt-1">
          {series.teacher}
        </p>
      )}

      <h3 className="font-display text-xl font-medium text-foreground mb-4 group-hover:text-brand-primary transition-colors">
        {series.name}
      </h3>

      <span
        className={`font-sans text-sm font-semibold ${color.text}`}
      >
        Browse series →
      </span>
    </Link>
  );
}
