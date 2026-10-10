import type { RsvpStatus } from "@/lib/types";

export interface Attendee {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  status: RsvpStatus;
}

interface AttendeeStripProps {
  attendees: Attendee[];
}

const PALETTE = [
  "var(--color-brand-primary)",
  "var(--color-brand-accent)",
  "var(--color-avatar-sage)",
  "var(--color-avatar-tan)",
  "var(--color-brand-primary-light)",
];

function initials(first: string | null, last: string | null): string {
  const f = first?.[0] ?? "";
  const l = last?.[0] ?? "";
  return (f + l).toUpperCase() || "?";
}

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function fullName(a: Attendee): string {
  return [a.first_name, a.last_name].filter(Boolean).join(" ") || "Member";
}

export function AttendeeStrip({ attendees }: AttendeeStripProps) {
  const going = attendees.filter((a) => a.status === "yes");
  const maybe = attendees.filter((a) => a.status === "maybe");
  // Going first, then maybe
  const ordered = [...going, ...maybe];
  if (ordered.length === 0) return null;

  // ~40px per row × 5 rows = ~200px max before scrolling
  const ROW_HEIGHT = 40;
  const MAX_VISIBLE_ROWS = 5;
  const maxHeight = ROW_HEIGHT * MAX_VISIBLE_ROWS;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-serif text-[20px] font-medium text-foreground tracking-tight">
          Who&apos;s coming
        </h2>
        <span className="font-sans text-xs text-muted-foreground font-medium">
          {going.length > 0 && (
            <strong className="text-brand-primary">{going.length} going</strong>
          )}
          {going.length > 0 && maybe.length > 0 && " · "}
          {maybe.length > 0 && `${maybe.length} maybe`}
        </span>
      </div>
      <ul
        className="overflow-y-auto pr-1 -mr-1 space-y-1.5"
        style={{ maxHeight }}
      >
        {ordered.map((a) => {
          const name = fullName(a);
          const isMaybe = a.status === "maybe";
          return (
            <li key={a.id} className="flex items-center gap-3">
              <div
                className="relative w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-white font-sans text-[11px] font-bold shrink-0"
                style={{
                  background: colorFor(a.id),
                  opacity: isMaybe ? 0.55 : 1,
                }}
              >
                {a.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.avatar_url}
                    alt={name}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  initials(a.first_name, a.last_name)
                )}
              </div>
              <span className="font-sans text-sm text-foreground truncate flex-1">
                {name}
              </span>
              {isMaybe && (
                <span className="font-sans text-[11px] uppercase tracking-wider text-muted-foreground shrink-0">
                  maybe
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
