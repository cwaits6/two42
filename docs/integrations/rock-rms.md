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
| `GroupMember.GroupRole` (Adult/Child) | `relationship` |
| `Group(Family).GroupLocation` | `address_line1` … `postal_code` |
| `Person.AnniversaryDate` | `anniversary` |
| `Person.RecordStatus` | inactive people are **reported, never hard-deleted** |

Rock has no equivalents for `has_login`, `role`, `is_class_member`,
`hidden_fields`, `groups`, or `leads` — those columns are two42-owned and a
Rock pull leaves them blank (blank means "not provided", so existing values
survive).

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

## Rock endpoints (for the record)

`/api/People`, `/api/Groups`, `/api/GroupMembers?$expand=Person`,
`/api/PhoneNumbers`.

Rock's REST surface varies by version and by the permissions attached to the
REST Key; every endpoint and field above must be verified against the target
church's actual Rock instance before implementation.
