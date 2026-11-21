// The church's Rock connection and person links. No client role has any
// privilege on either table, so this module owns a service client and never
// accepts one: every read and write filters on an orgId the caller took from
// requireOrgAdmin(), and that filter is the tenant boundary here.
//
// Imports next/headers through @/lib/supabase/server; never import it from a
// "use client" module.
import { createServiceClient } from "@/lib/supabase/server";
import type { RockCredentials } from "./client";
import { openRestKey } from "./crypto";

export interface ConnectionSummary {
  baseUrl: string;
  /** The key's last characters, so an admin can tell which key is in use without it being shown. */
  keyHint: string;
  connectedAt: string;
}

export interface PersonLink {
  profileId: string;
  rockPersonId: number;
  linkedAt: string;
}

export class RockStoreError extends Error {}

export async function readConnection(orgId: string): Promise<ConnectionSummary | null> {
  const service = await createServiceClient();
  const { data, error } = await service
    .from("rock_connections")
    .select("base_url, key_hint, connected_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new RockStoreError("rock connection read failed", { cause: error });
  return data && { baseUrl: data.base_url, keyHint: data.key_hint, connectedAt: data.connected_at };
}

/** The address and opened key, or null when the church has no connection. Throws when the key can't be opened. */
export async function loadCredentials(orgId: string, secret: Buffer): Promise<RockCredentials | null> {
  const service = await createServiceClient();
  const { data, error } = await service
    .from("rock_connections")
    .select("base_url, key_ciphertext")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new RockStoreError("rock credentials read failed", { cause: error });
  if (!data) return null;
  return { baseUrl: data.base_url, restKey: openRestKey(secret, orgId, data.key_ciphertext) };
}

/**
 * Saves or replaces the connection. Replacing it with another Rock address
 * removes the links, because a person id means nothing in another Rock.
 */
export async function saveConnection(
  orgId: string,
  row: { baseUrl: string; keyCiphertext: string; keyHint: string; connectedBy: string },
): Promise<void> {
  const service = await createServiceClient();
  const { data: existing, error: readError } = await service
    .from("rock_connections")
    .select("base_url")
    .eq("org_id", orgId)
    .maybeSingle();
  if (readError) throw new RockStoreError("rock connection read failed", { cause: readError });
  if (existing && existing.base_url !== row.baseUrl) {
    const { error } = await service.from("rock_person_links").delete().eq("org_id", orgId);
    if (error) throw new RockStoreError("rock links clear failed", { cause: error });
  }
  const { error } = await service.from("rock_connections").upsert(
    {
      org_id: orgId,
      base_url: row.baseUrl,
      key_ciphertext: row.keyCiphertext,
      key_hint: row.keyHint,
      connected_by: row.connectedBy,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "org_id" },
  );
  if (error) throw new RockStoreError("rock connection write failed", { cause: error });
}

/** Removes the connection and, through the cascade, every link. Profiles are untouched. */
export async function deleteConnection(orgId: string): Promise<boolean> {
  const service = await createServiceClient();
  const { error, count } = await service
    .from("rock_connections")
    .delete({ count: "exact" })
    .eq("org_id", orgId);
  if (error) throw new RockStoreError("rock connection delete failed", { cause: error });
  return (count ?? 0) > 0;
}

export async function readLinks(orgId: string): Promise<PersonLink[]> {
  const service = await createServiceClient();
  const { data, error } = await service
    .from("rock_person_links")
    .select("profile_id, rock_person_id, linked_at")
    .eq("org_id", orgId);
  if (error) throw new RockStoreError("rock links read failed", { cause: error });
  return (data ?? []).map((row) => ({
    profileId: row.profile_id,
    rockPersonId: row.rock_person_id,
    linkedAt: row.linked_at,
  }));
}

export type InsertLinksResult = "inserted" | "conflict";

/**
 * Inserts all the links or none. A profile or Rock person already linked is a
 * conflict; the composite foreign key refuses a profile from another church.
 */
export async function insertLinks(
  orgId: string,
  linkedBy: string,
  links: readonly { profileId: string; rockPersonId: number }[],
): Promise<InsertLinksResult> {
  const service = await createServiceClient();
  const { error } = await service.from("rock_person_links").insert(
    links.map((link) => ({
      org_id: orgId,
      profile_id: link.profileId,
      rock_person_id: link.rockPersonId,
      linked_by: linkedBy,
    })),
  );
  if (error?.code === "23505") return "conflict";
  if (error) throw new RockStoreError("rock links insert failed", { cause: error });
  return "inserted";
}

export async function deleteLink(orgId: string, profileId: string): Promise<boolean> {
  const service = await createServiceClient();
  const { error, count } = await service
    .from("rock_person_links")
    .delete({ count: "exact" })
    .eq("org_id", orgId)
    .eq("profile_id", profileId);
  if (error) throw new RockStoreError("rock link delete failed", { cause: error });
  return (count ?? 0) > 0;
}
