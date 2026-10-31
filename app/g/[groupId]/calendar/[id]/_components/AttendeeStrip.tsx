import { displayName, initials } from "@/lib/names";
import type { RsvpStatus } from "@/lib/types";

export interface Attendee {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
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

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

const ROW_HEIGHT_PX = 48;
const MAX_VISIBLE_ROWS = 5;

export function AttendeeStrip({ attendees }: AttendeeStripProps) {
  const going = attendees.filter((a) => a.status === "yes");
  const maybe = attendees.filter((a) => a.status === "maybe");
  const ordered = [...going, ...maybe];
  if (ordered.length === 0) return null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-serif text-xl font-medium tracking-tight text-foreground">
          Who&apos;s coming
        </h2>
        <span className="font-sans text-base text-muted-foreground">
          {going.length > 0 && (
            <strong className="font-semibold text-brand-primary-text">{going.length} going</strong>
          )}
          {going.length > 0 && maybe.length > 0 && " · "}
          {maybe.length > 0 && `${maybe.length} maybe`}
        </span>
      </div>
      <ul
        className="-mr-1 space-y-1.5 overflow-y-auto pr-1"
        style={{ maxHeight: ROW_HEIGHT_PX * MAX_VISIBLE_ROWS }}
      >
        {ordered.map((a) => {
          const name = displayName(a);
          const isMaybe = a.status === "maybe";
          return (
            <li key={a.id} className="flex items-center gap-3">
              <div
                className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full font-sans text-sm font-bold text-white"
                style={{ background: colorFor(a.id) }}
                aria-hidden="true"
              >
                {a.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.avatar_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  initials(a)
                )}
              </div>
              <span className="flex-1 truncate font-sans text-base text-foreground">{name}</span>
              {isMaybe && <span className="shrink-0 font-sans text-base text-muted-foreground">Maybe</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
