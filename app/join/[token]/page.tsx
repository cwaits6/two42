import { cache } from "react";
import Link from "next/link";
import { AuthShell } from "@/app/(auth)/_components/AuthShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { orgDisplayName } from "@/lib/branding";
import { siteConfig } from "@/lib/config";
import { groupPath, isUuid } from "@/lib/groups/active";
import { INVITE_INVALID_TEXT, INVITE_OTHER_ORG_TEXT, inviteStatus } from "@/lib/groups/invites";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { InviteSignupForm } from "./InviteSignupForm";
import { JoinGroupButton } from "./JoinGroupButton";
import { SignOutButton } from "./SignOutButton";

interface PageProps {
  params: Promise<{ token: string }>;
}

interface LiveInvite {
  id: string;
  orgId: string;
  groupId: string;
  groupName: string;
  orgName: string;
}

type InviteLookup =
  | { kind: "error" }
  | { kind: "invalid" }
  | { kind: "live"; invite: LiveInvite };

// Memoized so generateMetadata() and the page share one service-role read.
const loadInvite = cache(async (token: string): Promise<InviteLookup> => {
  if (!isUuid(token)) return { kind: "invalid" };

  const service = await createServiceClient();
  // org-anchor: the invite row resolves the org for every read below. This
  // page is reached before login, so the token is the only thing that can
  // name the org; the group and organization embeds ride the row's own
  // composite FKs.
  const { data: row, error } = await service
    .from("group_invites")
    .select(
      "id, org_id, group_id, expires_at, max_uses, revoked_at, groups(name), organizations!group_invites_org_id_fkey(name, branding)",
    )
    .eq("token", token)
    .maybeSingle();
  if (error) {
    console.error("Join page: invite lookup failed:", error);
    return { kind: "error" };
  }
  if (!row) return { kind: "invalid" };

  const { count, error: countError } = await service
    .from("group_invite_uses")
    .select("id", { count: "exact", head: true })
    .eq("invite_id", row.id)
    .eq("org_id", row.org_id);
  if (countError) {
    console.error("Join page: invite use count failed:", countError);
    return { kind: "error" };
  }
  if (inviteStatus(row, count ?? 0, new Date()) !== "active") return { kind: "invalid" };

  const group = row.groups as unknown as { name: string } | null;
  const org = row.organizations as unknown as { name: string; branding: unknown } | null;
  if (!group || !org) return { kind: "invalid" };
  return {
    kind: "live",
    invite: {
      id: row.id,
      orgId: row.org_id,
      groupId: row.group_id,
      groupName: group.name,
      orgName: orgDisplayName(org.branding, org.name),
    },
  };
});

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  const lookup = await loadInvite(token);
  const title = lookup.kind === "live" ? `Join ${lookup.invite.groupName}` : "Join a group";
  return { title: `${title} | ${siteConfig.name}` };
}

function Notice({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="container mx-auto max-w-lg px-4 py-20">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">{title}</CardTitle>
          <CardDescription className="text-base">{description}</CardDescription>
        </CardHeader>
        {children ? <CardContent className="space-y-4">{children}</CardContent> : null}
      </Card>
    </div>
  );
}

export default async function JoinByInvitePage({ params }: PageProps) {
  const { token } = await params;
  const lookup = await loadInvite(token);

  // A lookup failure carries no information about which tokens exist, so it
  // may say so and point at retrying; every dead-link state shares one
  // message instead.
  if (lookup.kind === "error") {
    return (
      <Notice title="Something went wrong" description="We couldn't load this invite right now.">
        <p className="text-base text-muted-foreground">Try the link again in a moment.</p>
      </Notice>
    );
  }
  if (lookup.kind === "invalid") {
    return <Notice title="Invite link not valid" description={INVITE_INVALID_TEXT} />;
  }

  const { invite } = lookup;
  const user = await getOptionalUser();

  if (!user) {
    return (
      <AuthShell
        eyebrow="Group invite"
        title="You're invited to"
        em={invite.groupName}
        kicker={`${invite.groupName} is a group at ${invite.orgName}. Enter your name and email and we'll send you a link to set up your account.`}
        altPrompt="Already have an account?"
        altLabel="Sign in →"
        altHref={`/login?redirect=${encodeURIComponent(`/join/${token}`)}`}
      >
        <InviteSignupForm token={token} groupName={invite.groupName} />
      </AuthShell>
    );
  }

  const supabase = await createClient();
  const [{ data: profile, error: profileError }, { data: membership, error: membershipError }] =
    await Promise.all([
      supabase.from("profiles").select("org_id, role").eq("id", user.id).maybeSingle(),
      supabase
        .from("group_members")
        .select("id")
        .eq("group_id", invite.groupId)
        .eq("profile_id", user.id)
        .maybeSingle(),
    ]);
  if (profileError || membershipError) {
    console.error("Join page: viewer lookup failed:", profileError ?? membershipError);
    return (
      <Notice title="Something went wrong" description="We couldn't load this invite right now.">
        <p className="text-base text-muted-foreground">Try the link again in a moment.</p>
      </Notice>
    );
  }

  if (!profile || profile.role === "pending" || profile.org_id !== invite.orgId) {
    return (
      <Notice title="Not for this account" description={INVITE_OTHER_ORG_TEXT}>
        <p className="text-base text-muted-foreground">
          Sign out, then open the link again to join with a different email address.
        </p>
        <SignOutButton />
      </Notice>
    );
  }

  if (membership) {
    return (
      <Notice title={`You're already in ${invite.groupName}.`} description="Nothing more to do here.">
        <Button
          size="lg"
          className="w-full"
          nativeButton={false}
          render={<Link href={groupPath(invite.groupId, "/dashboard")} />}
        >
          Open group
        </Button>
      </Notice>
    );
  }

  return (
    <Notice
      title={`Join ${invite.groupName}`}
      description={`You've been invited to ${invite.groupName} at ${invite.orgName}.`}
    >
      <JoinGroupButton token={token} groupId={invite.groupId} groupName={invite.groupName} />
    </Notice>
  );
}
