"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DirRow } from "@/components/directory/DirRow";
import { displayName, initials } from "@/lib/names";
import { formatPhone } from "@/lib/sanitize";
import type { DirectoryProfile } from "@/lib/types";

interface AddMemberPanelProps {
  groupName: string;
  /** Everyone the viewer can read who is not yet in the group. */
  candidates: DirectoryProfile[];
  /** The profile id of an add in flight, so its button is disabled. */
  busyId: string | null;
  onAdd: (profile: DirectoryProfile) => void;
  onDone: () => void;
}

function matches(p: DirectoryProfile, q: string): boolean {
  return [p.first_name, p.last_name, p.preferred_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/** Add mode: the people the directory shows the leader, minus the roster. */
export function AddMemberPanel({ groupName, candidates, busyId, onAdd, onDone }: AddMemberPanelProps) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? candidates.filter((p) => matches(p, q)) : candidates;
  }, [candidates, query]);

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search people to add"
            aria-label="Search people to add"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-13 rounded-xl pl-12 text-base"
          />
        </div>
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-base text-muted-foreground">
          {query.trim()
            ? "No one matches your search."
            : `Everyone you can see is already in ${groupName}.`}
        </p>
      ) : (
        <div className="space-y-2.5">
          {visible.map((p) => (
            <DirRow
              key={p.id}
              avatar={
                <Avatar className="h-12 w-12">
                  {p.avatar_url && <AvatarImage src={p.avatar_url} alt={displayName(p)} />}
                  <AvatarFallback className="bg-brand-primary text-white">{initials(p)}</AvatarFallback>
                </Avatar>
              }
              title={displayName(p)}
              subtitle={p.phone_mobile ? formatPhone(p.phone_mobile) : undefined}
              actions={
                <Button
                  variant="outline"
                  disabled={busyId === p.id}
                  onClick={() => onAdd(p)}
                  aria-label={`Add ${displayName(p)} to ${groupName}`}
                >
                  <Plus aria-hidden="true" />
                  Add
                </Button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
