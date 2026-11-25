// The church's connection to its records and its person links. No client role
// has any privilege on either table, so this module owns a service client and
// never accepts one: every read and write filters on an orgId the caller took
// from requireOrgAdmin(), and that filter is the tenant boundary here.
//
// Imports next/headers through @/lib/supabase/server; never import it from a
// "use client" module.
import { createServiceClient } from "@/lib/supabase/server";
import { openKey } from "./crypto";
import { providerFor } from "./providers";
import type { RecordsCredentials, RecordsProvider } from "./types";

export interface ConnectionSummary {
  provider: string;
  baseUrl: string;
  /** The key's last characters, so an admin can tell which key is in use without it being shown. */
  keyHint: string;
  connectedAt: string;
}

export interface PersonLink {
  profileId: string;
  personId: string;
  linkedAt: string;
}

export class RecordsStoreError extends Error {}

export async function readConnection(orgId: string): Promise<ConnectionSummary | null> {
  const service = await createServiceClient();
  const { data, error } = await service
    .from("records_connections")
    .select("provider, base_url, key_hint, connected_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new RecordsStoreError("records connection read failed", { cause: error });
  return (
    data && { provider: data.provider, baseUrl: data.base_url, keyHint: data.key_hint, connectedAt: data.connected_at }
  );
}

/**
 * The provider, address and opened key, or null when the church has no
 * connection. Throws when the key can't be opened or the stored provider is
 * one this build doesn't know.
 */
export async function loadCredentials(
  orgId: string,
  secret: Buffer,
): Promise<{ provider: RecordsProvider; creds: RecordsCredentials; connectionId: string } | null> {
  const service = await createServiceClient();
  const { data, error } = await service
    .from("records_connections")
    .select("provider, base_url, key_ciphertext, connection_id")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new RecordsStoreError("records credentials read failed", { cause: error });
  if (!data) return null;
  const provider = providerFor(data.provider);
  if (!provider) throw new RecordsStoreError("records connection has an unknown provider");
  return {
    provider,
    creds: { baseUrl: data.base_url, key: openKey(secret, orgId, provider.id, data.key_ciphertext) },
    connectionId: data.connection_id,
  };
}

/**
 * Saves or replaces the connection in one transaction. Replacing it with
 * another provider or address gives it a new connection id, which removes the
 * links through the cascade, because a person id means nothing in other
 * records; a new key for the same records keeps them.
 */
export async function saveConnection(
  orgId: string,
  row: { provider: string; baseUrl: string; keyCiphertext: string; keyHint: string; connectedBy: string },
): Promise<void> {
  const service = await createServiceClient();
  const { error } = await service.rpc("records_save_connection", {
    _org_id: orgId,
    _provider: row.provider,
    _base_url: row.baseUrl,
    _key_ciphertext: row.keyCiphertext,
    _key_hint: row.keyHint,
    _connected_by: row.connectedBy,
  });
  if (error) throw new RecordsStoreError("records connection write failed", { cause: error });
}

/** Removes the connection and, through the cascade, every link. Profiles are untouched. */
export async function deleteConnection(orgId: string): Promise<boolean> {
  const service = await createServiceClient();
  const { error, count } = await service
    .from("records_connections")
    .delete({ count: "exact" })
    .eq("org_id", orgId);
  if (error) throw new RecordsStoreError("records connection delete failed", { cause: error });
  return (count ?? 0) > 0;
}

export async function readLinks(orgId: string): Promise<PersonLink[]> {
  const service = await createServiceClient();
  const { data, error } = await service
    .from("records_person_links")
    .select("profile_id, external_person_id, linked_at")
    .eq("org_id", orgId);
  if (error) throw new RecordsStoreError("records links read failed", { cause: error });
  return (data ?? []).map((row) => ({
    profileId: row.profile_id,
    personId: row.external_person_id,
    linkedAt: row.linked_at,
  }));
}

export type InsertLinksResult = "inserted" | "conflict" | "connection_changed";

/**
 * Inserts all the links or none, under the connection the caller checked them
 * against. A profile or person already linked is a conflict. A connection
 * replaced since the check no longer has that id, so its foreign key refuses
 * the links rather than filing them under records they weren't checked in;
 * the composite foreign key also refuses a profile from another church.
 */
export async function insertLinks(
  orgId: string,
  connectionId: string,
  linkedBy: string,
  links: readonly { profileId: string; personId: string }[],
): Promise<InsertLinksResult> {
  const service = await createServiceClient();
  const { error } = await service.from("records_person_links").insert(
    links.map((link) => ({
      org_id: orgId,
      connection_id: connectionId,
      profile_id: link.profileId,
      external_person_id: link.personId,
      linked_by: linkedBy,
    })),
  );
  if (error?.code === "23505") return "conflict";
  if (error?.code === "23503" && error.message.includes("records_person_links_connection_fkey")) {
    return "connection_changed";
  }
  if (error) throw new RecordsStoreError("records links insert failed", { cause: error });
  return "inserted";
}

export async function deleteLink(orgId: string, profileId: string): Promise<boolean> {
  const service = await createServiceClient();
  const { error, count } = await service
    .from("records_person_links")
    .delete({ count: "exact" })
    .eq("org_id", orgId)
    .eq("profile_id", profileId);
  if (error) throw new RecordsStoreError("records link delete failed", { cause: error });
  return (count ?? 0) > 0;
}
