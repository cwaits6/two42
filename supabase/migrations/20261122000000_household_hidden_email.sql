-- A hidden email is read only by its owner and a church admin. The household
-- arm of the profiles update policy compared the submitted email against the
-- stored one through get_profile_email(), so a household primary or spouse
-- could confirm a guessed address. The policy no longer reads the address; a
-- trigger refuses any statement that names email on another person's row
-- unless the caller is a church admin.

create function public.profiles_email_by_owner_or_admin()
  returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and (select auth.uid()) is distinct from old.id
     and not (select public.is_admin()) then
    raise exception 'only a church admin can change another person''s email'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- No WHEN clause: refusing on the column being named, not on its value, keeps
-- a right guess and a wrong guess indistinguishable.
create trigger profiles_email_by_owner_or_admin
  before update of email on public.profiles
  for each row execute function public.profiles_email_by_owner_or_admin();

-- A trigger function is never called directly; EXECUTE is checked only when
-- the trigger is created, so the trigger still fires for every role.
revoke execute on function public.profiles_email_by_owner_or_admin()
  from public, anon, authenticated;

drop policy "Profiles are updatable per access rules" on public.profiles;
create policy "Profiles are updatable per access rules" on public.profiles
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select auth.uid()) = id
      or (select public.is_admin())
      or (
        (select auth.uid()) <> id
        and family_id is not null
        and family_id = (select public.current_family_id())
        and (select public.is_household_manager())
      )
    )
  )
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (
        (select auth.uid()) = id
        and role = (select public.get_own_role())
        and not (email is distinct from (select public.get_own_email()))
      )
      or (select public.is_admin())
      or (
        -- Without this the household arm also matches a person's own row,
        -- and their own email would no longer be pinned by the self arm.
        (select auth.uid()) <> id
        and family_id = (select public.current_family_id())
        and role = public.get_profile_role(id)
      )
    )
  );

drop function public.get_profile_email(uuid);
