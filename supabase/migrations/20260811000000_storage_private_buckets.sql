-- Storage read posture (CWA-59 / #333): flip both buckets to private, closing
-- the /object/public/* path that served reads without consulting RLS. This is
-- the deliberate revisit of ADR-3 (docs/security/tenancy-model.md "Storage
-- tenancy"): CWA-57 closed cross-org write/delete but left read secrecy
-- resting on unguessable UUID paths — any leaked, forwarded, or cached object
-- URL stayed readable cross-tenant forever. Reads now go through signed URLs
-- (`createSignedUrl(s)` in lib/uploadImage.ts / lib/storageRead.ts), whose
-- minting is gated by the SELECT policies on storage.objects.
--
-- No policy changes accompany the flip on purpose: the org-scoped SELECT
-- policies from 20260803000000 ("Public can view avatars", "Public can view
-- event images") already carry the org predicate. They were dormant for the
-- actual read path while the buckets were public (the /object/public/*
-- endpoint bypasses RLS entirely) and become load-bearing here — an org-B
-- principal's attempt to mint a signed URL for an org-A key finds no visible
-- row and fails.
--
-- Sequencing: scripts/rekey-storage-objects.mjs (#334 / CWA-60) must run
-- against production BEFORE this migration deploys. A legacy un-prefixed key
-- fails the org floor's [1] = org_id check for every anon/authenticated
-- (RLS-constrained) principal, so once reads are RLS-gated an un-rekeyed
-- object becomes unreadable to the entire application surface, not just
-- unwritable. Service-role callers bypass RLS — which is exactly how the
-- rekey operator can still reach and move such keys.

-- Fail closed on unexpected bucket state: a bare UPDATE would silently
-- no-op if either bucket row were missing or renamed, deploying a "private
-- buckets" migration that privatized nothing.
do $$
declare
  bucket_count integer;
begin
  select count(*) into bucket_count
    from storage.buckets
    where id in ('avatars', 'event-images');
  if bucket_count <> 2 then
    raise exception
      'storage_private_buckets: expected exactly 2 target bucket rows (avatars, event-images), found %',
      bucket_count;
  end if;
end
$$;

update storage.buckets set public = false where id in ('avatars', 'event-images');
