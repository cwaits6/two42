-- Permissive rewrite — giving
-- (giving_funds, giving_fund_methods).
--
-- giving_stewards_can_manage() is org-scoped since Task 2 (it was the
-- DB-layer bare-key settings read that raises SQLSTATE 21000 at two orgs);
-- giving_can_manage_fund(fund_id) checks the fund's org internally.

-- giving_funds ---------------------------------------------------------------

drop policy "Members can view giving funds" on public.giving_funds;
create policy "Members can view giving funds" on public.giving_funds
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Admins and self-stewards can create funds" on public.giving_funds;
create policy "Admins and self-stewards can create funds" on public.giving_funds
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and created_by = (select auth.uid())
    and (
      (select public.is_admin())
      or (
        (select public.giving_stewards_can_manage())
        and (select public.is_member())
        and steward_id = (select auth.uid())
      )
    )
  );

drop policy "Admins and stewards can update funds" on public.giving_funds;
create policy "Admins and stewards can update funds" on public.giving_funds
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (
        (select public.giving_stewards_can_manage())
        and steward_id = (select auth.uid())
      )
    )
  );

drop policy "Admins and stewards can delete funds" on public.giving_funds;
create policy "Admins and stewards can delete funds" on public.giving_funds
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (
        (select public.giving_stewards_can_manage())
        and steward_id = (select auth.uid())
      )
    )
  );

-- giving_fund_methods --------------------------------------------------------

drop policy "Members can view fund methods" on public.giving_fund_methods;
create policy "Members can view fund methods" on public.giving_fund_methods
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Fund managers can add methods" on public.giving_fund_methods;
create policy "Fund managers can add methods" on public.giving_fund_methods
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and public.giving_can_manage_fund(fund_id)
  );

drop policy "Fund managers can update methods" on public.giving_fund_methods;
create policy "Fund managers can update methods" on public.giving_fund_methods
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and public.giving_can_manage_fund(fund_id)
  );

drop policy "Fund managers can remove methods" on public.giving_fund_methods;
create policy "Fund managers can remove methods" on public.giving_fund_methods
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and public.giving_can_manage_fund(fund_id)
  );
