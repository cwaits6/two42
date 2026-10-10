import { createClient } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { notFound } from "next/navigation";
import Link from "next/link";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";

type LectureDetail = {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  lecture_date: string | null;
  summary: string | null;
  series_id: string | null;
  lecture_series: { id: string; name: string; teacher: string | null } | null;
};

function getYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?\s]+)/
  );
  return match ? match[1] : null;
}

function sanitizeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatLongDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("lectures")
    .select("title")
    .eq("id", id)
    .single();
  return {
    title: data ? `${data.title} | ${siteConfig.name}` : `Lecture | ${siteConfig.name}`,
  };
}

export default async function LectureDetailPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireActiveGroup(groupId);
  const libraryHref = groupPath(group.id, "/lectures");
  const supabase = await createClient();

  const { data: lectureData } = await supabase
    .from("lectures")
    .select("*, lecture_series(id, name, teacher)")
    .eq("id", id)
    .single();

  if (!lectureData) notFound();
  const lecture = lectureData as LectureDetail;

  // Compute week numbers from series sibling order (date asc)
  let weekNumber: number | null = null;
  let siblings: { id: string; title: string; lecture_date: string | null; weekNumber: number }[] = [];
  if (lecture.series_id) {
    const { data: seriesLectures } = await supabase
      .from("lectures")
      .select("id, title, lecture_date")
      .eq("series_id", lecture.series_id)
      .order("lecture_date", { ascending: true });

    if (seriesLectures) {
      const withWeeks = seriesLectures.map((l, i) => ({ ...l, weekNumber: i + 1 }));
      const me = withWeeks.find((l) => l.id === lecture.id);
      weekNumber = me?.weekNumber ?? null;
      siblings = withWeeks.filter((l) => l.id !== lecture.id);
    }
  }

  const series = lecture.lecture_series;
  const safeVideoUrl = sanitizeHttpUrl(lecture.video_url);
  const youtubeId = safeVideoUrl ? getYouTubeId(safeVideoUrl) : null;
  const thumbnail =
    sanitizeHttpUrl(lecture.thumbnail_url) ||
    (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null);

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

          {/* Eyebrow: series + week */}
          {(series || weekNumber !== null) && (
            <div className="flex items-center gap-3 mb-5">
              <div className="w-7 h-px bg-brand-accent" />
              {series && (
                <Link
                  href={`${libraryHref}/series/${series.id}`}
                  className="text-muted-foreground text-base font-semibold font-sans tracking-[0.2em] uppercase hover:text-foreground transition-colors"
                >
                  {series.name}
                </Link>
              )}
              {weekNumber !== null && (
                <span className="text-brand-accent text-base font-bold font-sans tracking-[0.2em] uppercase">
                  Week {String(weekNumber).padStart(2, "0")}
                </span>
              )}
            </div>
          )}

          {/* Title */}
          <h1 className="font-display text-4xl md:text-6xl font-medium tracking-tight leading-none mb-5 max-w-4xl">
            {lecture.title}
          </h1>

          {/* Description */}
          {lecture.description && (
            <p className="font-display italic text-xl md:text-2xl text-muted-foreground max-w-2xl leading-snug mb-6">
              {lecture.description}
            </p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-4 flex-wrap font-sans text-base text-muted-foreground">
            {lecture.lecture_date && (
              <span className="font-mono">{formatLongDate(lecture.lecture_date)}</span>
            )}
            {lecture.lecture_date && series?.teacher && (
              <span className="opacity-40">·</span>
            )}
            {series?.teacher && <span>Taught by {series.teacher}</span>}
          </div>
        </div>
      </section>

      {/* ── Watch block ── */}
      <section className="bg-card border-t border-border">
        <div className="px-6 md:px-14 py-12 grid md:grid-cols-[1.4fr_1fr] gap-10 items-center">
          {safeVideoUrl ? (
          <a
            href={safeVideoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group block relative aspect-video rounded-2xl overflow-hidden border border-border"
          >
            {thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- Lecture thumbnails can be arbitrary stored URLs.
              <img src={thumbnail} alt={lecture.title} className="w-full h-full object-cover" />
            ) : (
              <div
                className="w-full h-full"
                style={{
                  background: "linear-gradient(135deg, var(--color-brand-primary) 0%, var(--color-brand-navy) 100%)",
                }}
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
              <div className="w-20 h-20 rounded-full bg-brand-accent flex items-center justify-center shadow-xl group-hover:scale-105 transition-transform">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M8 5.14v14l11-7-11-7z" fill="var(--color-brand-navy)" />
                </svg>
              </div>
            </div>
          </a>
          ) : (
            <div className="relative aspect-video rounded-2xl overflow-hidden border border-border flex items-center justify-center bg-muted">
              <p className="font-sans text-base text-muted-foreground">
                Recording unavailable.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {safeVideoUrl ? (
              <a
                href={safeVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-brand-primary text-white font-sans text-lg font-bold tracking-[0.1em] uppercase px-6 py-4 rounded-xl inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              >
                Watch the recording →
              </a>
            ) : (
              <span className="bg-muted text-muted-foreground font-sans text-lg font-bold tracking-[0.1em] uppercase px-6 py-4 rounded-xl inline-flex items-center justify-center gap-2 cursor-not-allowed">
                Recording unavailable
              </span>
            )}
            <p className="font-sans text-base text-foreground italic px-2">
              Opens in a new tab. You may be prompted to enter a Zoom passcode.
            </p>
          </div>
        </div>
      </section>

      {/* ── Class summary ── */}
      <section className="bg-background border-t border-border">
        <div className="px-6 md:px-14 py-14 md:py-16 max-w-3xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-7 h-px bg-brand-accent" />
            <span className="text-brand-accent text-base font-bold font-sans tracking-[0.2em] uppercase">
              Class Summary
            </span>
          </div>

          {lecture.summary ? (
            <div className="font-sans text-base md:text-lg text-foreground leading-relaxed whitespace-pre-wrap">
              {lecture.summary}
            </div>
          ) : (
            <p className="font-display italic text-lg text-muted-foreground">
              A summary hasn&apos;t been written yet — check back later this week.
            </p>
          )}
        </div>
      </section>

      {/* ── Also in this series ── */}
      {series && siblings.length > 0 && (
        <section className="bg-card border-t border-border">
          <div className="px-6 md:px-14 py-14">
            <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
              <div>
                <p className="font-sans text-base text-muted-foreground tracking-[0.15em] uppercase font-semibold mb-1">
                  Also in this series
                </p>
                <h2 className="font-display text-3xl font-medium text-foreground tracking-tight">
                  {series.name}
                </h2>
              </div>
              <Link
                href={`${libraryHref}/series/${series.id}`}
                className="font-sans text-sm font-semibold text-brand-primary hover:opacity-80 transition-opacity"
              >
                View full series →
              </Link>
            </div>

            <div>
              {siblings.slice(0, 5).map((sib) => (
                <SiblingRow key={sib.id} libraryHref={libraryHref} sib={sib} weekNumber={sib.weekNumber} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function SiblingRow({
  libraryHref,
  sib,
  weekNumber,
}: {
  libraryHref: string;
  sib: { id: string; title: string; lecture_date: string | null };
  weekNumber: number;
}) {
  return (
    <Link
      href={`${libraryHref}/${sib.id}`}
      className="grid grid-cols-[80px_1fr_auto] items-center gap-6 border-t border-border py-4 hover:bg-background transition-colors -mx-2 px-2 rounded"
    >
      <span className="font-sans text-base text-brand-accent tracking-[0.15em] uppercase font-bold">
        Week {String(weekNumber).padStart(2, "0")}
      </span>
      <span className="font-display text-lg font-medium text-foreground tracking-tight">
        {sib.title}
      </span>
      <span className="font-mono text-base text-muted-foreground">
        {sib.lecture_date
          ? new Date(sib.lecture_date + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          : ""}
      </span>
    </Link>
  );
}
