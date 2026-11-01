import { cache } from "react";
import Link from "next/link";
import { AuthShell } from "@/app/(auth)/_components/AuthShell";
import { InvalidLink } from "@/app/(auth)/_components/InvalidLink";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states/ErrorState";
import { orgDisplayName } from "@/lib/branding";
import { groupPath, isUuid } from "@/lib/groups/active";
import { INVITE_INVALID_HELP, inviteStatus } from "@/lib/groups/invites";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { InviteSignupForm } from "./InviteSignupForm";
import { JoinGroupButton } from "./JoinGroupButton";
import { SignOutButton } from "./SignOutButton";
import { pageTitle } from "@/lib/pageTitle";

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
  return pageTitle(title);
}

const EYEBROW = "Group invite";

/** A lookup failure carries no information about which tokens exist, so it may say so and offer a retry. */
function LoadFailed() {
  return (
    <AuthShell eyebrow={EYEBROW} title="Join a group">
      <ErrorState thing="this invite" />
    </AuthShell>
  );
}

export default async function JoinByInvitePage({ params }: PageProps) {
  const { token } = await params;
  const lookup = await loadInvite(token);

  if (lookup.kind === "error") return <LoadFailed />;
  if (lookup.kind === "invalid") return <InvalidLink eyebrow={EYEBROW} help={INVITE_INVALID_HELP} />;

  const { invite } = lookup;
  const user = await getOptionalUser();

  if (!user) {
    return (
      <AuthShell
        eyebrow={EYEBROW}
        title={`Join ${invite.groupName}`}
        kicker={`${invite.groupName} is a group at ${invite.orgName}. Enter your name and email, and we'll email you a link to set up your account.`}
        altPrompt="Already have an account?"
        altLabel="Sign in"
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
    return <LoadFailed />;
  }

  if (!profile || profile.role === "pending" || profile.org_id !== invite.orgId) {
    return (
      <AuthShell
        eyebrow={EYEBROW}
        title="This link is for a different account"
        kicker="Sign out, then open the link again to join with another email address."
      >
        <SignOutButton />
      </AuthShell>
    );
  }

  if (membership) {
    return (
      <AuthShell eyebrow={EYEBROW} title={`You're already in ${invite.groupName}`}>
        <Button
          size="lg"
          className="w-full font-semibold"
          nativeButton={false}
          render={<Link href={groupPath(invite.groupId, "/dashboard")} />}
        >
          Open group
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow={EYEBROW}
      title={`Join ${invite.groupName}`}
      kicker={`You're invited to ${invite.groupName} at ${invite.orgName}.`}
    >
      <JoinGroupButton token={token} groupId={invite.groupId} groupName={invite.groupName} />
    </AuthShell>
  );
}
