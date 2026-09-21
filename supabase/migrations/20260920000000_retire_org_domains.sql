-- Retire host-based org routing. The app serves every request from one
-- canonical host; an anonymous request names its org with a path segment
-- (/[orgSlug]/join, /[orgSlug]/pages/[slug]) and an authenticated one
-- resolves it from profiles.org_id. Nothing reads a host → org mapping any
-- more, so the custom-domain registry, its attachment worker's schedule and
-- outcome log, and the host resolver all go.
--
-- org_email_domains and organizations.custom_email_domain_enabled are a
-- separate mechanism (the From: address gate) and are deliberately untouched.
-- app_request_org_id() still reads x-two42-org — the app now sets that header
-- from the path slug or the env pin, never from the request host.

-- cron.unschedule(text) raises when the job does not exist, and the job is
-- absent on any database where it was already removed by hand.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'attach-org-domains') then
    perform cron.unschedule('attach-org-domains');
  end if;
end
$$;

-- The RPC, tables and type stay for now. Dropping them in the same step that
-- retires the app code and edge function using them risks an old warm
-- instance (Vercel's rollout and Supabase's migration push are not atomic)
-- hitting a missing relation or function mid-deploy. A follow-up cleanup
-- migration drops app_org_slug_for_host(), org_domain_worker_events,
-- org_domains and org_domain_status once this one is confirmed live and
-- nothing older is still serving traffic.
