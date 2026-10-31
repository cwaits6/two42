"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { CreateGroupAction } from "@/components/groups/CreateGroupAction";
import { useGroupCreation } from "@/components/groups/GroupProvider";
import { creationActionFor } from "@/lib/groups/creation";

const COPY = {
  create: "Find a group, create one, or ask a leader to add you.",
  request: "Find a group, request one, or ask a leader to add you.",
  none: "Find a group or ask a leader to add you.",
};

export function NoGroupCard({ discoveryOn }: { discoveryOn: boolean }) {
  const { policy, isOrgAdmin } = useGroupCreation();
  const action = creationActionFor(policy, isOrgAdmin);

  return (
    <PageContainer size="reading">
      <PageHeader title="You are not in a group yet" subtitle={COPY[action?.kind ?? "none"]} />
      <div className="flex flex-col items-start gap-3">
        {discoveryOn && (
          <Button size="lg" nativeButton={false} render={<Link href="/find-a-group" />}>
            Find a group
          </Button>
        )}
        <CreateGroupAction className="flex flex-col items-start" />
      </div>
    </PageContainer>
  );
}
