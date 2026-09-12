-- Re-issue three function comments with their planning tags removed.
--
-- Code comments keep the why and drop the tracking tag; a COMMENT ON is
-- catalog metadata that outlives the ticket just the same. The historical
-- migrations that first wrote these strings are not edited — re-issuing the
-- statements here converges every environment, and comment on function is
-- idempotent (it overwrites the description and nothing else). The host
-- resolver's "not yet called from application code" claim was also stale —
-- lib/supabase/host-resolution.ts calls it — so that sentence is replaced
-- rather than merely untagged.

comment on function public.serving_signup_apply(uuid, date, uuid, uuid[]) is
  'Atomic serving signup + attendee insert pair. Tenant anchor: org_id resolved from the member_groups row named by _group_id, never a caller parameter; every other row is asserted to carry it. service_role only — the HMAC signed-link route passes its validated profile id as _actor_id.';

comment on function public.serving_signup_create(uuid, date, uuid[]) is
  'Authenticated serving signup entry point. Actor from auth.uid(); tenant anchor: the group''s org pinned against app_request_org_id(), fail-closed on NULL; the RLS INSERT-policy arms are re-checked before delegating to serving_signup_apply().';

comment on function public.app_org_slug_for_host(text) is
  'Resolves a request host to an org slug for host-based routing. Verified/active gating only — no normalization: the caller (middleware) canonicalizes the host once. Returns NULL (fails closed) for any unmatched, unverified, or suspended-org host. Called by lib/supabase/host-resolution.ts.';
