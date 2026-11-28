-- A person linked to the church's records is never sent, so linking them drops
-- a consent they gave at sign-up that hasn't been sent. A trigger rather than
-- a step in the link write, so no way of creating a link can leave the consent
-- behind. A send already claimed, sent or failed stays as the record of what
-- happened, and a withdrawal stays too.
--
-- SECURITY INVOKER, like records_intake_settings_cleanup(): only the service
-- role writes links, and it can write the requests. The org is the new link
-- row's own, and the composite (profile_id, org_id) keys on both tables mean
-- the profile belongs to that church.
create function public.records_intake_link_cleanup()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  delete from public.records_intake_requests
   where org_id = new.org_id and profile_id = new.profile_id and state = 'consented';
  return null;
end;
$$;

create trigger records_intake_link_cleanup
  after insert or update of profile_id on public.records_person_links
  for each row execute function public.records_intake_link_cleanup();

-- A trigger function is never called directly; EXECUTE is checked only when
-- the trigger is created, so the trigger still fires.
revoke execute on function public.records_intake_link_cleanup() from public, anon, authenticated;
