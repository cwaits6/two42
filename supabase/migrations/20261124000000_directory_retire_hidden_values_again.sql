-- Deletes values hidden since the first sweep and resets their flags. The
-- columns, view gates and this function stay for the release that drops them.
select public.directory_retire_hidden_values();

comment on function public.directory_retire_hidden_values() is
  'Deletes values hidden with the retired flags and moves anniversaries to the household parts. Idempotent. Drop it with the retired columns.';
