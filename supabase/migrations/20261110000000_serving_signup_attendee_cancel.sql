-- Anyone listed on a date can cancel it in the app, the rule the emailed cancel
-- link already applies. The attendee rows go with the signup through their
-- foreign key, so "Signup owners can remove attendees" stays as it is.

-- The arm reads attendees through a definer function because the attendee
-- select policy reads serving_signups, and Postgres raises 42P17 when policy
-- expansion revisits a relation, whichever command the second policy is for.
create function public.is_serving_signup_attendee(_signup_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.serving_signup_attendees a
    join public.profiles p on p.id = a.profile_id and p.org_id = a.org_id
    where a.signup_id = _signup_id
      and a.profile_id = auth.uid()
      and a.org_id = public.app_current_org_id()
      and p.role <> 'pending'
  );
$$;

revoke execute on function public.is_serving_signup_attendee(uuid) from public, anon;
grant execute on function public.is_serving_signup_attendee(uuid) to authenticated;

comment on function public.is_serving_signup_attendee(uuid) is
  'True when the caller (auth.uid()) is a non-pending person listed on the given serving signup in their own org. Caller resolved from auth.uid() only.';

drop policy "Owners, team leads and group leaders can delete serving signups" on public.serving_signups;

create policy "Owners, attendees, team leads and group leaders can delete serving signups" on public.serving_signups
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      created_by = (select auth.uid())
      or public.is_serving_signup_attendee(id)
      or public.is_team_lead(team_id)
      or exists (
        select 1 from public.teams t
        where t.id = serving_signups.team_id
          and t.org_id = serving_signups.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  );
