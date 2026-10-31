-- Nothing reads or writes organization_members after the previous
-- migration: no function, policy, view, edge function or app query names it.
-- Its rows are derivable from profiles.org_id, so nothing is lost.
drop table public.organization_members;
