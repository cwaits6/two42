"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreateGroupAction } from "@/components/groups/CreateGroupAction";
import { useGroupCreation } from "@/components/groups/GroupProvider";
import { creationActionFor } from "@/lib/groups/creation";

const COPY = {
  create: "You are not in a group yet. Find a group, create one, or ask a leader to add you.",
  request: "You are not in a group yet. Find a group, request one, or ask a leader to add you.",
  none: "You are not in a group yet. Find a group or ask a leader to add you.",
};

export function NoGroupCard({ discoveryOn }: { discoveryOn: boolean }) {
  const { policy, isOrgAdmin } = useGroupCreation();
  const action = creationActionFor(policy, isOrgAdmin);

  return (
    <div className="container mx-auto px-4 py-20 max-w-lg text-center">
      <Card className="p-8 border-border">
        <CardContent className="pt-6">
          <h1 className="font-serif text-3xl text-brand-primary mb-4">No group yet</h1>
          <p className="text-lg text-muted-foreground">{COPY[action?.kind ?? "none"]}</p>
          <div className="mt-6 flex flex-col items-center gap-3">
            {discoveryOn && (
              <Button
                size="lg"
                nativeButton={false}
                render={<Link href="/find-a-group" />}
              >
                Find a group
              </Button>
            )}
            <CreateGroupAction className="flex flex-col items-center" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
