import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { displayName, initials } from "@/lib/names";

export interface RosterMember {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  is_leader: boolean;
}

/**
 * Read-only roster of a serving role — who's in the group. Shown to every
 * member so they can see (e.g.) who the prayer warriors are. Unlisted profiles
 * are already filtered out upstream by RLS.
 */
export function RoleRoster({ members }: { members: RosterMember[] }) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No one assigned yet.</p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-2.5 text-sm"
        >
          <Avatar size="sm">
            {m.avatar_url && <AvatarImage src={m.avatar_url} alt="" />}
            <AvatarFallback className="bg-brand-warm text-xs font-semibold text-brand-primary-text">
              {initials(m)}
            </AvatarFallback>
          </Avatar>
          <span className="text-foreground">{displayName(m)}</span>
          {m.is_leader && (
            <span className="text-xs font-bold uppercase tracking-wide text-brand-accent-text">
              Leader
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
