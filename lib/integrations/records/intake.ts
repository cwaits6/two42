// Sending new people to the church's records: the church's setting with its
// write key, and each person's consent and send. No client role may read or
// write these tables, so this module owns a service client and never accepts
// one: every read and write filters on an orgId the caller already validated
// (requireOrgAdmin(), the setup link's row, or the person's own RLS-scoped
// profile), and that filter is the tenant boundary here.
//
// Imports next/headers through @/lib/supabase/server; never import it from a
// "use client" module.
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { orgDisplayName } from "@/lib/branding";
import { logError, logWarn } from "@/lib/log";
import { openKey } from "./crypto";
import { recordsIntegrationEnabled } from "./enabled";
import { RecordsError, type RecordsFailure } from "./errors";
import { providerFor } from "./providers";
import { RecordsStoreError } from "./store";
import type { RecordsCredentials, RecordsIntake, RecordsNewPerson, RecordsProvider } from "./types";
import type { Database } from "@/lib/supabase/database.types";

type IntakeState = Database["public"]["Enums"]["records_intake_state"];
type IntakeRequestUpdate = Database["public"]["Tables"]["records_intake_requests"]["Update"];

/**
 * The write key's sealing label: one of its own, so a write key copied into
 * the read key's column, or the reverse, fails to open.
 */
export function intakeKeyLabel(providerId: string): string {
  return `${providerId}-intake`;
}

export interface IntakeSettings {
  connectionId: string;
  keyHint: string;
  destinationId: string;
  destinationName: string;
  enabledAt: string;
}

export async function readIntakeSettings(orgId: string): Promise<IntakeSettings | null> {
  const service = await createServiceClient();
  const { data, error } = await service
    .from("records_intake_settings")
    .select("connection_id, key_hint, destination_id, destination_name, enabled_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new RecordsStoreError("records intake settings read failed", { cause: error });
  return (
    data && {
      connectionId: data.connection_id,
      keyHint: data.key_hint,
      destinationId: data.destination_id,
      destinationName: data.destination_name,
      enabledAt: data.enabled_at,
    }
  );
}

export interface IntakeCredentials {
  connectionId: string;
  provider: RecordsProvider;
  intake: RecordsIntake;
  creds: RecordsCredentials;
  destinationId: string;
}

/**
 * The opened write key and where it sends, or null while sending is off, the
 * provider can't send, or `settingId` is given and sending was turned off and
 * on again since that setting. Throws when the key can't be opened.
 */
export async function loadIntakeCredentials(
  orgId: string,
  secret: Buffer,
  settingId?: string,
): Promise<IntakeCredentials | null> {
  const service = await createServiceClient();
  const [connection, settings] = await Promise.all([
    service.from("records_connections").select("provider, base_url, connection_id").eq("org_id", orgId).maybeSingle(),
    service
      .from("records_intake_settings")
      .select("setting_id, connection_id, key_ciphertext, destination_id")
      .eq("org_id", orgId)
      .maybeSingle(),
  ]);
  const error = connection.error ?? settings.error;
  if (error) throw new RecordsStoreError("records intake credentials read failed", { cause: error });
  if (!connection.data || !settings.data || settings.data.connection_id !== connection.data.connection_id) return null;
  if (settingId !== undefined && settings.data.setting_id !== settingId) return null;
  const provider = providerFor(connection.data.provider);
  const intake = provider?.intake;
  if (!provider || !intake) return null;
  return {
    connectionId: connection.data.connection_id,
    provider,
    intake,
    creds: {
      baseUrl: connection.data.base_url,
      key: openKey(secret, orgId, intakeKeyLabel(provider.id), settings.data.key_ciphertext),
    },
    destinationId: settings.data.destination_id,
  };
}

/** "connection_changed" when the connection was replaced after the caller read it. */
export async function saveIntakeSettings(
  orgId: string,
  row: {
    connectionId: string;
    keyCiphertext: string;
    keyHint: string;
    destinationId: string;
    destinationName: string;
    enabledBy: string;
  },
): Promise<"saved" | "connection_changed"> {
  const service = await createServiceClient();
  const { error } = await service.from("records_intake_settings").upsert(
    {
      org_id: orgId,
      connection_id: row.connectionId,
      key_ciphertext: row.keyCiphertext,
      key_hint: row.keyHint,
      destination_id: row.destinationId,
      destination_name: row.destinationName,
      enabled_by: row.enabledBy,
      enabled_at: new Date().toISOString(),
    },
    { onConflict: "org_id" },
  );
  if (error?.code === "23503" && error.message.includes("records_intake_settings_connection_fkey")) {
    return "connection_changed";
  }
  if (error) throw new RecordsStoreError("records intake settings write failed", { cause: error });
  return "saved";
}

/** Turns sending off: removes the write key, and through its trigger every consent not yet sent. */
export async function deleteIntakeSettings(orgId: string): Promise<void> {
  const service = await createServiceClient();
  const { error } = await service.from("records_intake_settings").delete().eq("org_id", orgId);
  if (error) throw new RecordsStoreError("records intake settings delete failed", { cause: error });
}

/**
 * A claimed send still unfinished after this long is shown as an unknown
 * outcome: the provider may have taken it before the result write failed, so
 * it is never retried.
 */
export const INTAKE_UNKNOWN_AFTER_MS = 10 * 60 * 1000;

export interface IntakeStatus {
  sent: number;
  failed: number;
  /** Claimed sends whose outcome was never recorded. */
  unknown: number;
  /** Why the newest send since sending was turned on or last saved failed, when it did. */
  lastFailure: RecordsFailure | null;
}

export async function readIntakeStatus(orgId: string, since: string): Promise<IntakeStatus> {
  const service = await createServiceClient();
  const count = (state: IntakeState) =>
    service
      .from("records_intake_requests")
      .select("profile_id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("state", state);
  const stuckBefore = new Date(Date.now() - INTAKE_UNKNOWN_AFTER_MS).toISOString();
  const [sent, failed, unknown, last] = await Promise.all([
    count("sent"),
    count("failed"),
    count("sending").lt("claimed_at", stuckBefore),
    service
      .from("records_intake_requests")
      .select("state, failure")
      .eq("org_id", orgId)
      .in("state", ["sent", "failed"])
      .gte("finished_at", since)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const error = sent.error ?? failed.error ?? unknown.error ?? last.error;
  if (error) throw new RecordsStoreError("records intake status read failed", { cause: error });
  return {
    sent: sent.count ?? 0,
    failed: failed.count ?? 0,
    unknown: unknown.count ?? 0,
    lastFailure: last.data?.state === "failed" ? last.data.failure : null,
  };
}

/** Whether the church has sending new people on. */
export async function intakeOnFor(orgId: string): Promise<boolean> {
  return (await readIntakeSettings(orgId)) !== null;
}

/** The church's name as members see it. `orgId` must come from an already-validated anchor. */
export async function churchName(orgId: string): Promise<string> {
  const service = await createServiceClient();
  const { data, error } = await service.from("organizations").select("name, branding").eq("id", orgId).single();
  if (error) throw new RecordsStoreError("church name read failed", { cause: error });
  return orgDisplayName(data.branding, data.name);
}

/**
 * Whether profile setup asks this person: "ask" when sending is on and they
 * are neither linked nor already asked; "consented" when they ticked the box
 * at sign-up; "off" or "done" hides the box.
 */
export async function intakeOffer(orgId: string, profileId: string): Promise<"off" | "ask" | "consented" | "done"> {
  const service = await createServiceClient();
  const [settings, link, request] = await Promise.all([
    service.from("records_intake_settings").select("org_id").eq("org_id", orgId).maybeSingle(),
    service.from("records_person_links").select("profile_id").eq("org_id", orgId).eq("profile_id", profileId).maybeSingle(),
    service.from("records_intake_requests").select("state").eq("org_id", orgId).eq("profile_id", profileId).maybeSingle(),
  ]);
  const error = settings.error ?? link.error ?? request.error;
  if (error) throw new RecordsStoreError("records intake offer read failed", { cause: error });
  if (!settings.data) return "off";
  if (link.data) return "done";
  if (!request.data || request.data.state === "withdrawn") return "ask";
  return request.data.state === "consented" ? "consented" : "done";
}

/**
 * What profile setup offers the signed-in person, or null to show no box. The
 * org is the person's own, read on their request client. Never throws: a
 * failed read hides the box, so nothing is sent.
 */
export async function readIntakeOffer(profileId: string): Promise<{ churchName: string; consented: boolean } | null> {
  if (!recordsIntegrationEnabled()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("profiles").select("org_id").eq("id", profileId).single();
    if (error) throw error;
    const offer = await intakeOffer(data.org_id, profileId);
    if (offer !== "ask" && offer !== "consented") return null;
    return { churchName: await churchName(data.org_id), consented: offer === "consented" };
  } catch (err) {
    logError("Church records new person offer read failed", err, { route: "/profile/setup", ids: { user: profileId } });
    return null;
  }
}

/** Records a person's consent; stores nothing while sending is off or the person is linked. */
export async function recordConsent(orgId: string, profileId: string): Promise<void> {
  const service = await createServiceClient();
  const { error } = await service.rpc("records_intake_consent", { _org_id: orgId, _profile_id: profileId });
  if (error) throw new RecordsStoreError("records intake consent write failed", { cause: error });
}

/**
 * Accepts a consent given at profile setup. The id it returns is what a
 * deferred send presents to claim it; null means there is nothing to send.
 */
export async function acceptConsent(orgId: string, profileId: string): Promise<string | null> {
  const service = await createServiceClient();
  const { data, error } = await service.rpc("records_intake_accept", { _org_id: orgId, _profile_id: profileId });
  if (error) throw new RecordsStoreError("records intake consent accept failed", { cause: error });
  return data ?? null;
}

/**
 * Withdraws a consent not yet claimed, and keeps the withdrawal so nothing
 * earlier can send. "too_late" when a send was already claimed, sent or
 * failed: it can't be stopped, so the withdrawal must not be confirmed.
 */
export async function withdrawConsent(orgId: string, profileId: string): Promise<"withdrawn" | "too_late"> {
  const service = await createServiceClient();
  const { data, error } = await service.rpc("records_intake_withdraw", { _org_id: orgId, _profile_id: profileId });
  if (error) throw new RecordsStoreError("records intake consent withdraw failed", { cause: error });
  return data === "too_late" ? "too_late" : "withdrawn";
}

/**
 * Sends one person, once, for the acceptance acceptConsent() returned. Claims
 * the send first, so a second save, a retry, a withdrawal or a newer setting
 * since the acceptance sends nobody, and anything that stops the send after
 * the claim, the write key included, is recorded as failed and never retried.
 * Never throws, and never logs the person's details or an error's text.
 */
export async function sendNewPerson(
  orgId: string,
  profileId: string,
  acceptId: string,
  person: RecordsNewPerson,
  secret: Buffer,
): Promise<void> {
  const ids = { org: orgId, user: profileId };
  try {
    const service = await createServiceClient();
    const { data: claim, error: claimError } = await service.rpc("records_intake_claim", {
      _org_id: orgId,
      _profile_id: profileId,
      _accept_id: acceptId,
    });
    if (claimError) throw new RecordsStoreError("records intake claim failed", { cause: claimError });
    if (claim !== "claimed") return;

    // The setting the claim matched; the key is loaded only under that same
    // setting, so turning sending off and on after the claim sends nothing.
    const { data: claimed, error: claimedError } = await service
      .from("records_intake_requests")
      .select("setting_id")
      .eq("org_id", orgId)
      .eq("profile_id", profileId)
      .eq("state", "sending")
      .maybeSingle();
    let failure: RecordsFailure | null;
    if (claimedError || !claimed?.setting_id) {
      logError("Church records new person send failed", claimedError ?? undefined, {
        route: "/api/church-records/intake",
        step: "setting",
        ids,
      });
      failure = "unauthorized";
    } else {
      failure = await submitClaimed(orgId, claimed.setting_id, person, secret, ids);
    }
    // Typed here because update() doesn't check its values against the enums.
    const result: IntakeRequestUpdate = { state: failure ? "failed" : "sent", failure, finished_at: new Date().toISOString() };
    const { error } = await service
      .from("records_intake_requests")
      .update(result)
      .eq("org_id", orgId)
      .eq("profile_id", profileId)
      .eq("state", "sending");
    if (error) throw new RecordsStoreError("records intake result write failed", { cause: error });
  } catch (err) {
    logError("Church records new person send failed", err, { route: "/api/church-records/intake", ids });
  }
}

/** Why a claimed send failed, or null once the provider took it. A write key that can't be used is "unauthorized". */
async function submitClaimed(
  orgId: string,
  settingId: string,
  person: RecordsNewPerson,
  secret: Buffer,
  ids: { org: string; user: string },
): Promise<RecordsFailure | null> {
  let loaded: IntakeCredentials | null;
  try {
    loaded = await loadIntakeCredentials(orgId, secret, settingId);
  } catch (err) {
    logError("Church records new person send failed", err, { route: "/api/church-records/intake", step: "key", ids });
    return "unauthorized";
  }
  if (!loaded) {
    logWarn("Church records new person not sent", undefined, { route: "/api/church-records/intake", step: "key", ids });
    return "unauthorized";
  }
  try {
    await loaded.intake.submitNewPerson(loaded.creds, loaded.destinationId, person);
    return null;
  } catch (err) {
    const failure = err instanceof RecordsError ? err.kind : "rejected";
    logWarn("Church records new person not sent", undefined, { route: "/api/church-records/intake", step: failure, ids });
    return failure;
  }
}
