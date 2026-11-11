import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { logError, logWarn } from "@/lib/log";
import { groupPath } from "@/lib/groups/active";
import {
  PASSWORD_AUTH_ERRORS,
  passwordFieldErrors,
} from "@/app/(auth)/_components/passwordRules";
import {
  INVALID_LINK,
  SETUP_LINK_STATUS,
  accountExistsResponse,
  classifySetupRow,
  deadLinkResponse,
  findSetupAccount,
  readSetupToken,
  setUpResponse,
  setupUserId,
} from "../setup-link";
import type { SetupAccountResponse } from "../setup-response";

const invalid = () => NextResponse.json<SetupAccountResponse>(INVALID_LINK, { status: 404 });
const failed = () =>
  NextResponse.json<SetupAccountResponse>({ error: "Couldn't create your account." }, { status: 500 });
const logAccountLookup = (error: unknown) =>
  logError("Setup account: account lookup failed", error, { route: "/api/auth/setup-account" });

/**
 * POST /api/auth/setup-account — { token, password }
 *
 * Creates the account a setup link was sent for, already confirmed, so the
 * form can sign the person in straight away whatever the project's
 * "Confirm email" setting is. The email, name and org come from the link's
 * row, never from the body.
 *
 * Steps run create account → link household → consume link. The link is
 * consumed last so that any earlier failure leaves it live: a retry finds the
 * account under the link's derived id, sets the password just typed, and
 * finishes the remaining steps.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const token = readSetupToken(body);
  if (!token) return invalid();

  const rawPassword = (body as { password?: unknown }).password;
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const passwordError = passwordFieldErrors(password, password).password;
  if (passwordError) {
    return NextResponse.json<SetupAccountResponse>({ field: "password", error: passwordError }, { status: 400 });
  }

  const service = await createServiceClient();

  // org-anchor: signup_token resolves the org; org_id is unknown until this
  // row returns it (docs/security/service-role-inventory.md).
  const { data: row, error: lookupError } = await service
    .from("access_requests")
    .select("id, org_id, name, email, token_expires_at, invite_token, group_id")
    .eq("signup_token", token)
    .eq("status", SETUP_LINK_STATUS)
    .maybeSingle();

  if (lookupError) {
    logError("Setup account: token lookup failed", lookupError, { route: "/api/auth/setup-account" });
    return invalid();
  }
  const link = classifySetupRow(row);
  if (link.state !== "live") {
    return deadLinkResponse(service.auth.admin, token, link.state === "expired", logAccountLookup);
  }

  const orgId = link.row.org_id;
  const requestId = link.row.id;
  const email = link.row.email;
  const userId = setupUserId(token);
  const ids = { user: userId, accessRequest: requestId, org: orgId };

  // `retireReplacement` is for the request that has just set the account up:
  // a repeat invite can replace the token while that request runs, and the
  // replacement would otherwise stay a live link to an account that exists.
  async function consumeLink(retireReplacement = false): Promise<boolean> {
    const { data, error } = await service
      .from("access_requests")
      .update({ signup_token: null })
      .eq("id", requestId)
      .eq("org_id", orgId)
      .eq("signup_token", token)
      .select("id");
    if (error) {
      logError("Setup account: consuming the link failed", error, { route: "/api/auth/setup-account", ids });
      return false;
    }
    // A zero-row update means a concurrent request already consumed it, or
    // the token was replaced.
    if (!retireReplacement || (data && data.length > 0)) return true;

    const { error: retireError } = await service
      .from("access_requests")
      .update({ signup_token: null })
      .eq("id", requestId)
      .eq("org_id", orgId);
    if (retireError) {
      logError("Setup account: retiring a replaced link failed", retireError, {
        route: "/api/auth/setup-account",
        ids,
      });
      return false;
    }
    return true;
  }

  // Links the new profile to the household the link's invite was for. A write
  // error is fatal so a retry can repair it (each write is idempotent); an
  // invite or member that is gone, taken or for another address is skipped.
  async function linkHousehold(inviteToken: string): Promise<boolean> {
    const { data: invite, error: inviteError } = await service
      .from("family_invites")
      .select("id, family_id, family_member_id, invite_email, accepted_at")
      .eq("token", inviteToken)
      .eq("org_id", orgId)
      .maybeSingle();
    if (inviteError) {
      logError("Setup account: household invite lookup failed", inviteError, { route: "/api/auth/setup-account", ids });
      return false;
    }
    if (
      !invite ||
      invite.accepted_at ||
      invite.invite_email?.toLowerCase() !== email.toLowerCase()
    ) {
      logWarn("Setup account: household invite not claimable", undefined, { route: "/api/auth/setup-account", ids });
      return true;
    }

    // The invite names a household and a member. A member moved to another
    // household since the invite was written makes it stale: linking would
    // put the profile in one household and claim a member of another.
    if (invite.family_member_id) {
      const { data: member, error: memberLookupError } = await service
        .from("family_members")
        .select("id, family_id")
        .eq("id", invite.family_member_id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (memberLookupError) {
        logError("Setup account: household member lookup failed", memberLookupError, {
          route: "/api/auth/setup-account",
          ids: { ...ids, invite: invite.id },
        });
        return false;
      }
      if (member && member.family_id !== invite.family_id) {
        logWarn("Setup account: household invite not claimable", undefined, {
          route: "/api/auth/setup-account",
          ids: { ...ids, invite: invite.id },
        });
        return true;
      }
    }

    const { data: linked, error: profileError } = await service
      .from("profiles")
      .update({ family_id: invite.family_id })
      .eq("id", userId)
      .eq("org_id", orgId)
      .select("id");
    if (profileError || !linked || linked.length === 0) {
      logError("Setup account: linking the household failed", profileError, {
        route: "/api/auth/setup-account",
        ids: { ...ids, invite: invite.id },
      });
      return false;
    }

    // Never take over a member another account already claimed.
    const { data: claimed, error: memberError } = await service
      .from("family_members")
      .update({ claimed_profile_id: userId })
      .eq("id", invite.family_member_id)
      .eq("org_id", orgId)
      .eq("family_id", invite.family_id)
      .or(`claimed_profile_id.is.null,claimed_profile_id.eq.${userId}`)
      .select("id");
    if (memberError) {
      logError("Setup account: marking the household member claimed failed", memberError, {
        route: "/api/auth/setup-account",
        ids: { ...ids, invite: invite.id },
      });
      return false;
    }
    if (!claimed || claimed.length === 0) {
      logWarn("Setup account: household member gone or claimed by another account", undefined, {
        route: "/api/auth/setup-account",
        ids: { ...ids, invite: invite.id },
      });
    }

    const { data: accepted, error: acceptError } = await service
      .from("family_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id)
      .eq("org_id", orgId)
      .select("id");
    if (acceptError) {
      logError("Setup account: marking the household invite accepted failed", acceptError, {
        route: "/api/auth/setup-account",
        ids: { ...ids, invite: invite.id },
      });
      return false;
    }
    if (!accepted || accepted.length === 0) {
      logWarn("Setup account: household invite gone before it was accepted", undefined, {
        route: "/api/auth/setup-account",
        ids: { ...ids, invite: invite.id },
      });
    }
    return true;
  }

  let account = await findSetupAccount(service.auth.admin, token);
  if (account.kind === "error") {
    logError("Setup account: account lookup failed", account.error, { route: "/api/auth/setup-account", ids });
    return failed();
  }

  if (account.kind === "none") {
    const { error: createError } = await service.auth.admin.createUser({
      id: userId,
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: link.row.name },
      app_metadata: { org_id: orgId },
    });
    if (createError) {
      // A concurrent submit of the same link may have created it first.
      account = await findSetupAccount(service.auth.admin, token);
      if (account.kind !== "found") {
        if (createError.code === "email_exists") {
          return accountExistsResponse();
        }
        if (createError.code === "weak_password") {
          return NextResponse.json<SetupAccountResponse>(
            { field: "password", error: PASSWORD_AUTH_ERRORS.weak_password },
            { status: 400 },
          );
        }
        logError("Setup account: creating the account failed", createError, { route: "/api/auth/setup-account", ids });
        return failed();
      }
    }
  }

  if (account.kind === "found") {
    // The row's email can only differ if it was edited after setup; the
    // account is not this row's to change.
    if (account.email?.toLowerCase() !== email.toLowerCase()) {
      return (await consumeLink()) ? setUpResponse() : failed();
    }
    const { error: updateError } = await service.auth.admin.updateUserById(userId, { password });
    if (updateError) {
      if (updateError.code === "weak_password") {
        return NextResponse.json<SetupAccountResponse>(
          { field: "password", error: PASSWORD_AUTH_ERRORS.weak_password },
          { status: 400 },
        );
      }
      logError("Setup account: setting the password failed", updateError, { route: "/api/auth/setup-account", ids });
      return failed();
    }
  }

  if (link.row.invite_token && !(await linkHousehold(link.row.invite_token))) {
    return failed();
  }
  if (!(await consumeLink(true))) {
    return failed();
  }

  return NextResponse.json<SetupAccountResponse>({
    redirect: link.row.group_id ? groupPath(link.row.group_id, "/dashboard") : "/dashboard",
  });
}
