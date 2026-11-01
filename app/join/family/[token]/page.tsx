import { AuthShell } from "@/app/(auth)/_components/AuthShell";
import { InvalidLink } from "@/app/(auth)/_components/InvalidLink";
import { ErrorState } from "@/components/states/ErrorState";
import { isUuid } from "@/lib/groups/active";
import { pageTitle } from "@/lib/pageTitle";
import { createServiceClient } from "@/lib/supabase/server";
import { CHURCH_ADMIN_INVALID_HELP } from "@/lib/groups/invites";
import { FamilyRequestForm } from "./FamilyRequestForm";

interface PageProps {
  params: Promise<{ token: string }>;
}

const TITLE = "Join your household";
const EYEBROW = "Household invite";

export const generateMetadata = () => pageTitle(TITLE);

export default async function FamilyJoinPage({ params }: PageProps) {
  const { token } = await params;

  // The column is a uuid, so anything else would fail the lookup as a
  // database error rather than find no row.
  if (!isUuid(token)) return <InvalidLink eyebrow={EYEBROW} help={CHURCH_ADMIN_INVALID_HELP} />;

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
        last_name
      ),
      family_units!family_invites_family_id_fkey (
        family_name
      )
    `,
    )
    .eq("token", token)
    .maybeSingle();

  // A lookup failure carries no information about which tokens exist, so it
  // may say so and offer a retry; every dead-link state shares one message.
  if (inviteError) {
    console.error("Family join page: invite lookup failed:", inviteError);
    return (
      <AuthShell eyebrow={EYEBROW} title={TITLE}>
        <ErrorState thing="this invite" />
      </AuthShell>
    );
  }

  // An accepted invite is as dead as a missing one; the request route
  // refuses both alike.
  if (!invite || invite.accepted_at) return <InvalidLink eyebrow={EYEBROW} help={CHURCH_ADMIN_INVALID_HELP} />;

  const familyMember = invite.family_members as unknown as {
    first_name: string;
    last_name: string | null;
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
      eyebrow={EYEBROW}
      title={TITLE}
      kicker={
        familyUnit?.family_name
          ? `You're listed in the ${familyUnit.family_name} household. Ask for your own account to sign in and appear in your church's directory.`
          : "Ask for your own account to sign in and appear in your church's directory."
      }
      altPrompt="Already have an account?"
      altLabel="Sign in"
      altHref="/login"
    >
      <div className="space-y-6">
        <div className="rounded-lg bg-muted/50 border p-4 space-y-1">
          <p className="text-lg text-muted-foreground">Invited as</p>
          <p className="font-semibold text-lg">{memberName}</p>
          {familyUnit?.family_name && (
            <p className="text-lg text-muted-foreground">
              {familyUnit.family_name} household
            </p>
          )}
        </div>

        <p className="text-lg text-muted-foreground">
          A church admin reviews each request, then emails you a link to set up your account.
        </p>

        <FamilyRequestForm token={token} email={invite.invite_email} />
      </div>
    </AuthShell>
  );
}
