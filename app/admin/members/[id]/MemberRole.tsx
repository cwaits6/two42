"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UserRole } from "@/lib/types";
import { ROLE_OPTIONS } from "../memberRoles";
import { RoleChangeDialog, type RoleChange } from "../RoleChangeDialog";

interface MemberRoleProps {
  member: { id: string; name: string; role: UserRole };
  /** Why the role can't be changed here, or null when it can. */
  lockReason: string | null;
}

/** A person's role, changed only after the confirmation. A pending person is approved by choosing one. */
export function MemberRole({ member, lockReason }: MemberRoleProps) {
  const [change, setChange] = useState<RoleChange | null>(null);
  const router = useRouter();

  return (
    <div className="mb-8 rounded-2xl border border-border bg-card px-5 py-4">
      <Label htmlFor="member-role" className="text-base">
        Role
      </Label>
      <Select
        items={ROLE_OPTIONS}
        value={member.role === "pending" ? null : member.role}
        disabled={lockReason !== null}
        onValueChange={(next) => {
          if (next && next !== member.role) setChange({ member, role: next });
        }}
      >
        <SelectTrigger
          id="member-role"
          aria-describedby={lockReason ? "member-role-hint" : undefined}
          className="mt-2 w-full text-base sm:max-w-xs"
        >
          <SelectValue placeholder="Choose a role" />
        </SelectTrigger>
        <SelectContent>
          {ROLE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-base">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {lockReason && (
        <p id="member-role-hint" className="mt-2 text-base text-muted-foreground">
          {lockReason}
        </p>
      )}
      {/* The page re-reads the role, so the control follows what was saved. */}
      <RoleChangeDialog change={change} onClose={() => setChange(null)} onSaved={() => router.refresh()} />
    </div>
  );
}
