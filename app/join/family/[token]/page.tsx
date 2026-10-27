import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { siteConfig } from "@/lib/config";
import { AuthShell } from "@/app/(auth)/_components/AuthShell";
import { FamilyRequestForm } from "./FamilyRequestForm";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const metadata = { title: `Join Your Household | ${siteConfig.name}` };

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
          <CardTitle className="text-2xl text-brand-primary-text">{title}</CardTitle>
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
  // thing that can name the org; the request form posts the same token to
  // /api/family-invites/request, which resolves it again server-side.
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

  if (!invite) {
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
            <CardTitle className="text-2xl text-brand-primary-text">
              Invite Already Used
            </CardTitle>
            <CardDescription className="text-base">
              This invite link has already been claimed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              If you already created your account, you can{" "}
              <Link href="/login" className="text-brand-primary-text underline">
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

        <p className="text-lg text-muted-foreground">
          After you request access, an admin will review and approve your
          account. This usually takes less than a day.
        </p>

        <FamilyRequestForm token={token} email={invite.invite_email} />
      </div>
    </AuthShell>
  );
}
