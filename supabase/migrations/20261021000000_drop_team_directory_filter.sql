-- The directory filter is now the roster's Filter menu over the group's
-- teams and labels; a per-team "show as directory chip" flag has no reader.
alter table public.teams drop column show_in_directory_filter;
