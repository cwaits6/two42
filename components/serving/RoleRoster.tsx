import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { personInitials, personName } from "@/lib/serving/display";

export interface RosterMember {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  is_leader: boolean;
}

/**
 * Read-only roster of a team — who's on it. Shown to every member so they
 * can see (e.g.) who is on the prayer team. Unlisted profiles are already
 * filtered out upstream by RLS.
 */
export function RoleRoster({ members }: { members: RosterMember[] }) {
  if (members.length === 0) {
    return <p className="text-base text-muted-foreground">No one is on this team yet.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {members.map((m) => (
        <li
          key={m.id}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-3 text-base"
        >
          <Avatar size="sm">
            {m.avatar_url && <AvatarImage src={m.avatar_url} alt="" />}
            <AvatarFallback className="bg-brand-warm text-xs font-semibold text-brand-primary-text">
              {personInitials(m)}
            </AvatarFallback>
          </Avatar>
          <span className="text-foreground">{personName(m)}</span>
          {m.is_leader && (
            <span className="text-sm font-semibold text-brand-accent-text">Team lead</span>
          )}
        </li>
      ))}
    </ul>
  );
}
