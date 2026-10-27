-- A cancelled date of a repeating event is an exception row that suppresses
-- its series date without replacing it. Readers build the exception map from
-- every row and then drop cancelled rows, so the date neither re-expands nor
-- renders. Only an exception row of a series can be cancelled; a one-off is
-- deleted outright.

alter table public.events
  add column is_cancelled boolean not null default false,
  add constraint events_is_cancelled_exception_only
    check (
      not is_cancelled
      or (series_id is not null and series_occurrence_date is not null)
    );
