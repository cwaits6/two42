# Rock RMS integration — design note

**Status: design only.** Nothing under `lib/integrations/**` exists, no code
calls Rock, and no credentials are stored anywhere. This document records the
field mapping and integration shape agreed for CWA-40 so a future
implementation starts from a spec instead of a guess. The wire format it maps
onto is the v1 member CSV contract (`lib/members/format.ts` —
`MEMBER_CSV_COLUMNS`), which keeps the two documents from drifting: if the
CSV contract changes, this mapping is reviewed in the same PR.

## Field ownership

The crux of a two-way relationship with a church management system is
deciding, per field, who wins. The rule: Rock owns identity and contact
facts; two42 owns privacy, preference, and participation state; anything
pastoral never syncs at all.

| Rock-owned (pull in) | Two42-owned (never overwritten) | Never synced |
|---|---|---|
| first/last/nick name | the nine `hide_*` privacy flags | prayer requests |
| email, phone numbers | `is_unlisted` | giving funds/methods |
| address | `email_announcements` | serving signups |
| birthdate parts | `bio`, `avatar_url` | feedback |
| household composition | group assignments | |
| | `role` | |

## Rock → two42 CSV column mapping

Expressed against the v1 contract so the mapping is testable with the
existing pure parser:

| Rock REST field | v1 CSV column |
|---|---|
| `Person.FirstName` | `first_name` |
| `Person.NickName` | `preferred_name` |
| `Person.LastName` | `last_name` |
| `Person.Email` | `email` |
| `PhoneNumbers[Mobile]` | `phone_mobile` |
| `PhoneNumbers[Home]` | `phone_home` |
| `PhoneNumbers[Work]` | `phone_work` |
| `Person.BirthMonth` / `BirthDay` / `BirthYear` | `birth_month` / `birth_day` / `birth_year` |
| `Group(Family).Name` | `household_name` |
| `GroupMember.GroupRole` (Adult/Child) | `relationship` — **not a fixed mapping, see Q2** |
| `Group(Family).GroupLocation` | `address_line1` … `postal_code` |
| `Person.AnniversaryDate` | `anniversary` |
| `Person.RecordStatus` | no CSV column carries this — **see Q4** |

Rock has no equivalents for `has_login`, `role`, `is_class_member`,
`hidden_fields`, `groups`, or `leads` — those columns are two42-owned and a
Rock pull leaves them blank (blank means "not provided", so existing values
survive). Concretely: **only Rock's Family groups are read at all.** Every
other Rock group membership — ministry teams, small groups, serving teams —
is ignored, and two42's `groups` / `leads` columns stay blank on every Rock
row, so group assignments remain entirely admin-managed in two42. The single
`hidden_fields` column expands to the nine `hide_*` privacy flags
(`hide_email`, `hide_phone_mobile`, `hide_phone_home`, `hide_phone_work`,
`hide_address`, `hide_birthday`, `hide_birth_year`, `hide_anniversary`,
`hide_occupation`); Rock has no concept corresponding to any of them.

## Integration shape (v1: pull-only)

- **Pull only.** two42 never writes to Rock.
- **Auth**: a Rock REST Key sent as an `Authorization-Token` header. The key
  is stored in **Supabase Vault**, never in `organizations.branding` — that
  column is admin-readable and reaches CSS/email headers; a credential does
  not belong in it.
- **Incremental** by a `ModifiedDateTime` watermark per org; page size 100.
- **First run per org is always a dry run** (the import's `mode=validate`
  report) that an admin reviews and approves before anything applies.
- **Disconnect** nulls the external refs and leaves every member record
  intact and editable — no data hostage-taking.

## Preconditions before any code

1. Migration: `external_system` / `external_ref` / `external_synced_at`
   columns on the member tables plus the partial unique index (design doc
   §6.1, deferred out of CWA-40). Without `external_ref`, matching falls
   back to email, which cannot survive an email change in Rock.
2. A per-org opt-in flag (requires the deferred `organizations.features`
   column or equivalent).
3. A platform kill-switch environment variable.
4. The quarantine rule: deleting `lib/integrations/cms/` must leave the app
   building and every test green — the integration stays a leaf.

## Unresolved — decide these before writing code

The mapping table above is a starting point, not a settled contract. Each
question below is one an implementation would otherwise answer by guessing,
and every one of them can corrupt member data silently if guessed wrong.
They are recorded here rather than resolved because each needs a decision
about product behavior or a look at a real Rock instance.

**Q1 — Which Rock person records are in scope?** `Person.RecordStatus` and
`RecordType` distinguish active, inactive, and non-person records (business
and "nameless" records are `Person` rows in Rock). Decide the filter before
the first pull; a naive `/api/People` sweep imports businesses as members.

**Q2 — Rock family roles are not a fixed vocabulary.** `GroupMember.GroupRole`
is configurable per `GroupType`, so `Adult`/`Child` holds only for a stock
Rock install. The integration needs a per-org role → `relationship` map,
must filter on `GroupMemberStatus` explicitly (an `Inactive` family
membership is not a household member), and must **reject an unrecognized
role rather than defaulting it** — `relationship` drives household leader
capability, so a wrong default silently grants or removes it.
`Person.RecordStatus` is a person-level flag and does not substitute for the
per-group membership status.

**Q3 — `household_key` needs a stable identity.** The export currently mints
positional keys (`hh-1`, `hh-2`, … — `formatMembersCsv` in
`lib/members/format.ts`), which are stable *within* one export but shift as
soon as a household is added or removed. That is fine for an
export-edit-reimport round trip and wrong for a sync: the same household must
carry the same key across runs. Map Rock's Family group id, scoped by org and
Rock instance, and store it in the deferred `external_ref` column
(precondition 1) rather than in the CSV key. Also decide the behavior for a
person in no Family group, in more than one, and for a Family with no
`household_primary`.

**Q4 — How does an inactive person appear in the CSV?** The table says
inactive people are "reported, never hard-deleted", but the v1 contract has
no column carrying `RecordStatus`, so an inactive person is currently
indistinguishable from an active one. Pick one: omit them from the CSV,
surface them only in the validate report, or add a column. Until this is
decided, "reported" describes no actual mechanism.

**Q5 — Cursor and approval are a state machine, not a watermark.** A single
`ModifiedDateTime` watermark is not sufficient on its own. Specify the
ordering (`ModifiedDateTime` with `Id` as tie-break), what happens to records
sharing a timestamp across a page boundary, and retry behavior. Bind the
admin's approval to an immutable snapshot or plan hash so that what applies
is what was reviewed, and only advance the cursor after a complete apply
succeeds. Define recovery for a partial apply and whether the cursor is
retained or reset across disconnect/reconnect.

**Q6 — Orgs larger than the import limits.** The first run per org routes
through the import's `mode=validate`, but that path caps at 5 MB and 5,000
rows while the Rock pull pages at 100. A full snapshot of a large church
exceeds both. Either define chunked validate-and-apply under one stable plan,
or state the supported org size and fail loudly above it.

## Rock endpoints (for the record)

`/api/People`, `/api/Groups`, `/api/GroupMembers?$expand=Person`,
`/api/PhoneNumbers`.

Rock's REST surface varies by version and by the permissions attached to the
REST Key; every endpoint and field above must be verified against the target
church's actual Rock instance before implementation.
