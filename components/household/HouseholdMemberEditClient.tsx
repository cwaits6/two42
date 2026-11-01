"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import type { Profile, FamilyUnit, FamilyMemberRelationship } from "@/lib/types";

const RELATIONSHIPS: { value: FamilyMemberRelationship; label: string }[] = [
  { value: "primary", label: "Primary" },
  { value: "spouse", label: "Spouse" },
  { value: "child", label: "Child" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
];

interface Props {
  profile: Profile;
  onSaved: () => void;
}

export function HouseholdMemberEditClient({ profile, onSaved }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [relationship, setRelationship] = useState<FamilyMemberRelationship>(profile.relationship);
  const [savingRelationship, setSavingRelationship] = useState(false);

  async function handleRelationshipChange(value: FamilyMemberRelationship) {
    setRelationship(value);
    setSavingRelationship(true);

    const { error } = await supabase
      .from("profiles")
      .update({ relationship: value })
      .eq("id", profile.id);

    setSavingRelationship(false);

    if (error) {
      toast.error(failureMessage("change the relationship"));
      setRelationship(profile.relationship); // revert
    } else {
      toast.success("Relationship saved.");
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {/* Relationship — editable separately since ProfileForm doesn't expose it */}
      <Card>
        <CardHeader>
          <CardTitle>
            <h3 className="text-xl">Relationship</h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="relationship" className="text-base">
              Relationship to household
            </Label>
            <Select
              items={RELATIONSHIPS}
              value={relationship}
              onValueChange={(v) => handleRelationshipChange(v as FamilyMemberRelationship)}
              disabled={savingRelationship}
            >
              <SelectTrigger id="relationship" className="w-full py-5 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONSHIPS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {savingRelationship && (
              <p role="status" className="text-base text-muted-foreground">
                Saving…
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <ProfileForm
        profile={profile}
        families={[] as FamilyUnit[]}
        isAdmin={false}
        relaxValidation={true}
        onSaved={onSaved}
      />
    </div>
  );
}
