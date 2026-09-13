import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { siteConfig } from "@/lib/config";
import { AuthShell } from "@/app/(auth)/_components/AuthShell";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const metadata = { title: `Join Your Household | ${siteConfig.name}` };

// Path-based link into the org's own join page. The org comes from the
// invite row itself (see the lookup below), never from the request host, so
// this link is correct no matter what host or path served this page.
export function buildFamilyInviteJoinUrl(
  orgSlug: string,
  token: string,
  email: string,
): string {
  return `/${orgSlug}/join?invite_token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

function ErrorCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto px-4 py-20 max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary">{title}</CardTitle>
          <CardDescription className="text-base">{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  );
}

export default async function FamilyJoinPage({ params }: PageProps) {
  const { token } = await params;

  // Public page — uses service client to bypass RLS for token validation
  const supabase = await createServiceClient();

  // org-anchor: the invite row resolves the org for every step below. This
  // page is reached before login, from any host, so the token is the only
  // thing that can name the org. Embedding organizations(slug) in the same
  // query gives the link below a path-based destination without a second
  // round trip.
  const { data: invite, error: inviteError } = await supabase
    .from("family_invites")
    .select(
      `
      id,
      org_id,
      invite_email,
      accepted_at,
      family_member_id,
      family_members!family_invites_family_member_id_fkey (
        first_name,
        last_name,
        relationship
      ),
      family_units!family_invites_family_id_fkey (
        family_name
      ),
      organizations!family_invites_org_id_fkey (
        slug
      )
    `,
    )
    .eq("token", token)
    .maybeSingle();

  // A genuine lookup failure is distinct from an invalid token: it carries
  // no information about which tokens exist, so unlike the fail-closed case
  // below it can safely say "something went wrong" and point at retrying
  // instead of implying the invite itself is dead.
  if (inviteError) {
    console.error("Family join page: invite lookup failed:", inviteError);
    return (
      <ErrorCard
        title="Something Went Wrong"
        description="We couldn't load this invite right now."
      >
        <p className="text-muted-foreground">
          Please try the link again in a moment. If it still doesn&apos;t
          work, contact your group admin.
        </p>
      </ErrorCard>
    );
  }

  const org = invite?.organizations as unknown as { slug: string } | null;

  if (invite && !org?.slug) {
    // Should be structurally impossible under the org_id FK — log it so an
    // invariant violation is diagnosable if it ever occurs.
    console.error(
      "Family join page: invite row has no resolvable org:",
      invite.id,
      invite.org_id,
    );
  }

  // Invalid token, or (never expected under the org_id FK) a row with no
  // resolvable org — fail closed with an inline message. The message is the
  // same for both causes on purpose: distinguishing them would leak which
  // tokens exist.
  if (!invite || !org?.slug) {
    return (
      <ErrorCard
        title="Invite Not Found"
        description="This invite link is invalid or has expired."
      >
        <p className="text-muted-foreground">
          Please check the link or contact your group admin for a new
          invite.
        </p>
      </ErrorCard>
    );
  }

  // Already accepted → redirect with message
  if (invite.accepted_at) {
    return (
      <div className="container mx-auto px-4 py-20 max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl text-brand-primary">
              Invite Already Used
            </CardTitle>
            <CardDescription className="text-base">
              This invite link has already been claimed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              If you already created your account, you can{" "}
              <Link href="/login" className="text-brand-primary underline">
                log in here
              </Link>
              .
            </p>
            <p className="text-muted-foreground">
              If you need help, please contact your group admin.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const familyMember = invite.family_members as unknown as {
    first_name: string;
    last_name: string | null;
    relationship: string;
  } | null;
  const familyUnit = invite.family_units as unknown as {
    family_name: string;
  } | null;

  const memberName = familyMember
    ? [familyMember.first_name, familyMember.last_name]
        .filter(Boolean)
        .join(" ")
    : "you";

  // Pass invite_token so the access-request form can store it, and pre-fill
  // email.
  const joinUrl = buildFamilyInviteJoinUrl(org.slug, token, invite.invite_email);

  return (
    <AuthShell
      eyebrow={`${familyMember?.relationship ?? "Family"} invite`}
      title="You've been invited to join"
      em={siteConfig.name}
      kicker={
        familyUnit?.family_name
          ? `You've been added to the ${familyUnit.family_name} household. Create your own account to appear in the member directory and connect with the group.`
          : "Create your own account to appear in the member directory and connect with the group."
      }
      altPrompt="Already have an account?"
      altLabel="Log in →"
      altHref="/login"
    >
      <div className="space-y-6">
        <div className="rounded-lg bg-muted/50 border p-4 space-y-1">
          <p className="text-lg text-muted-foreground">Invited as</p>
          <p className="font-semibold text-lg">{memberName}</p>
          {familyUnit?.family_name && (
            <p className="text-lg text-muted-foreground">
              {familyUnit.family_name}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-lg text-muted-foreground">
            Your invite was sent to{" "}
            <span className="font-medium text-foreground">
              {invite.invite_email}
            </span>
            . Use that email address when you sign up.
          </p>
          <p className="text-lg text-muted-foreground">
            After you request access, an admin will review and approve your
            account. This usually takes less than a day.
          </p>
        </div>

        <Link href={joinUrl} className="block">
          <Button
            size="lg"
            className="w-full bg-brand-primary hover:bg-brand-primary/90 text-white flex items-center justify-center gap-2"
          >
            Request Access
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </AuthShell>
  );
}
