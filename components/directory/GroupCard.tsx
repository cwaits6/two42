"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatPhone } from "@/lib/sanitize";
import { displayName, initials } from "@/lib/names";
import { groupInitials, type ActiveGroup } from "@/lib/groups/active";
import { DirRow } from "@/components/directory/DirRow";
import type { DirectoryProfile } from "@/lib/types";

interface GroupCardProps {
  group: Pick<ActiveGroup, "id" | "name" | "color">;
  members: DirectoryProfile[];
  onOpenPerson: (profile: DirectoryProfile) => void;
}

/** Group detail: the group's colour and name, then its roster as tappable rows. */
export function GroupCard({ group, members, onOpenPerson }: GroupCardProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div
          className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
          style={{ backgroundColor: group.color }}
        >
          {groupInitials(group.name)}
        </div>
        <div className="min-w-0">
          <h2 className="font-serif text-2xl md:text-3xl font-medium leading-tight text-foreground">
            {group.name}
          </h2>
          <p className="text-base text-muted-foreground">
            {members.length} member{members.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {members.length === 0 ? (
        <p className="text-base text-muted-foreground py-4 text-center">
          No members in this group yet.
        </p>
      ) : (
        <div className="space-y-2.5">
          {members.map((m) => (
            <DirRow
              key={m.id}
              onClick={() => onOpenPerson(m)}
              avatar={
                <Avatar className="h-11 w-11">
                  {m.avatar_url && <AvatarImage src={m.avatar_url} alt={displayName(m)} />}
                  <AvatarFallback className="bg-brand-primary text-white text-sm">
                    {initials(m)}
                  </AvatarFallback>
                </Avatar>
              }
              title={displayName(m)}
              subtitle={m.phone_mobile ? formatPhone(m.phone_mobile) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
