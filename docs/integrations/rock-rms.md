# Rock RMS integration

two42 can connect to a church's own [Rock RMS](https://www.rockrms.com/) so a
church admin can say which two42 profile is which Rock person. That link is the
base for everything else in this document. two42 only ever **reads** from Rock,
and works the same for a church that never connects it.

What runs today is the **baseline** below. Everything after it is a plan, with
each area marked as reading from Rock, syncing, or staying out.

## Where two42 fits next to Rock

Rock is the church's system of record, run by staff: people, families,
contributions, check-in and pastoral care. two42 is for the people in a
church's groups to talk among themselves. So the rule is:

- **Rock owns identity facts.** Names, contact details and birthdays live in
  Rock. two42 may offer them to a member, who decides what to keep.
- **two42 owns everything about how people use two42.** What shows in the
  directory, events, replies, serving, lessons and funds.
- **Pastoral and financial data never moves.** Prayer requests, giving and
  anything else private between a person and their church stay where they are.
- **One way only.** two42 never writes to Rock. A link is a reference, not a
  copy: deleting it, or disconnecting Rock, leaves every profile as it is.

| Area | Rock | two42 | Direction | Status |
|---|---|---|---|---|
| Connection | REST key on a Rock user | Sealed key per church | — | **Baseline** |
| Who is who | `Person.Id` | `rock_person_links` | Read; a church admin confirms | **Baseline** |
| A member's own details | Person, PhoneNumber, family Location | Profile fields | Read; the member picks each field | Planned (T42-169) |
| Changes in Rock to details a member took | `ModifiedDateTime` | Offered as a change | Read; the member accepts | Planned (T42-169) |
| Leaders confirming links for their own groups | — | Church-wide setting, off by default | — | Planned (T42-169) |
| Group rosters | Small-group `GroupMember`s | `group_members` | Read-only comparison for a leader, never an automatic change | Worth a ticket |
| Attendance | `Attendance` | Event replies | Would be a write | Out: two42 doesn't write to Rock |
| Households | Family groups | Households | Read | Out for now: household membership in two42 is chosen by its members |
| Prayer requests | `PrayerRequest` | Encrypted prayer requests | — | Never |
| Giving | Financial transactions | Funds | — | Never |
| Serving | Connection requests, schedules | Teams, serving | — | Never |

Group rosters are the one more place it could help: a leader could see who is
in their Rock small group but not in the two42 group, and invite them. That
reads Rock's `GroupMembers` for one linked group and changes nothing on its
own. It is not built.

## The baseline

### For the operator

The integration is off unless `ROCK_KEY_SECRET` is set: 32 random bytes,
base64. Without it every Rock route answers 404 and no screen mentions Rock.
Generate one with `openssl rand -base64 32` and set it in Production only, like
the prayer keys. Changing it makes every saved key unreadable, and each church
admin has to connect Rock again; the links stay.

### For a church admin

**Church settings → Rock RMS → Rock connection** (`/admin/settings/rock`).

1. **Connect.** In Rock, add a REST key under Admin Tools › Settings › REST
   Keys, active, on a user whose security role can view the **People** and
   **DefinedValues** REST controllers. Enter the Rock address and the key in
   two42. two42 tries the key against Rock before it saves anything. The key
   is never shown again; the page shows its last four characters.
2. **Link people.** two42 suggests Rock people for each approved two42 profile
   without a link. A suggestion shows the Rock person's name and which facts
   agreed, never Rock's values. Link one at a time, or select several and link
   them together.
3. **Unlink** a person, **change the key**, or **disconnect**. Disconnecting
   removes the key and every link; profiles are unchanged. Connecting a
   different Rock address removes the old links, because a Rock person id
   means nothing in another Rock.

### How a match is suggested

- The **last name must agree**, and the first name must agree with Rock's
  first or nick name (case, accents and punctuation ignored). An email alone
  is never a suggestion: people in one household often share an address.
- A **birthday that disagrees** rules a person out. A birthday missing on
  either side says nothing.
- A suggestion can be **linked in bulk** only when an email or birthday also
  agrees and neither side has another candidate. Others carry "Check in Rock
  first" and are linked one at a time.
- Only living **Person** records that aren't **Inactive** are offered, never a
  business or nameless record. Record types and statuses are looked up by
  Rock's stock Guids, because their ids differ between installs.
- When a link is confirmed, the server reads those Rock people again and
  refuses any pair that no longer meets the rule, so a browser can't link a
  pair the server wouldn't suggest.

### What is read and stored

| | Read from Rock | Stored in two42 |
|---|---|---|
| Connect | `GET /api/People?$top=1&$select=Id` | Address, sealed key, its last 4 characters, who connected and when |
| Suggest | `GET /api/DefinedValues` (by Guid); `GET /api/People` filtered by the church's last names, selecting Id, names, email, birth month/day/year, record type and status, deceased | Nothing |
| Link | `GET /api/People` by id, the same fields | Profile id, Rock person id, who linked and when |

Rock's values are held in memory for one request and are never logged or
stored. No phone, address, family, group or giving data is requested.

### Where it lives

- `lib/integrations/rock/` — everything Rock-specific: `address.ts` (which
  addresses may be called), `client.ts` (read-only v1 REST calls), `crypto.ts`
  (sealing the key), `match.ts` (suggestions), `store.ts` (the two tables,
  service key only), `http.ts` and `enabled.ts`.
- `app/api/admin/rock/` — the church admin's routes.
- `app/admin/settings/rock/` — the page.
- `supabase/migrations/20261202000000_rock_connection.sql` — `rock_connections`
  and `rock_person_links`. No client role has any privilege on either; see
  `docs/security/service-role-inventory.md` ("Lib helpers").
- `supabase/tests/rock_connection_suite.sql` — the database's half of the
  boundary.

The integration stays a leaf: nothing outside these paths imports it except
the one link on Church settings.

## Decisions made

- **v1 REST with a REST key, not v2.** v2 needs Rock 17 or later and a grant on
  each REST controller, and its ad-hoc search needs "Unrestricted Read", which
  skips Rock's own entity security. v1's `GET` needs only View on the
  controllers above. Revisit when most churches run Rock 17 or later.
- **The key is sealed by the server** with AES-256-GCM, under a key derived per
  church from `ROCK_KEY_SECRET`, the way prayer request text is. Not Supabase
  Vault: the app reads Vault nowhere else, and a sealed column with no client
  grants keeps the key out of every client role's reach without a new definer
  function.
- **Addresses.** Only an `https` origin on a public host name or address. The
  client refuses redirects and gives up after 10 seconds. DNS can still point
  a public name at a private address; with no redirects that host gets one
  request, and nothing it returns is shown except as an error.
- **Which Rock people count** (was Q1): living Person records that aren't
  Inactive.
- **Inactive people** (was Q4): never suggested.

## Still open

- **Family roles** (was Q2): Rock's Adult/Child roles are configurable per
  install. This matters only when household details are offered to members;
  the baseline reads no family data. Children are never offered through this
  flow.
- **Phone privacy**: `PhoneNumber.IsUnlisted` marks a number private in Rock.
  The member flow must not offer such a number as an ordinary detail.
- **Partial dates**: Rock stores birth month, day and year separately, so a
  birthday without a year is representable. Anniversaries need checking on a
  real install.
- **Large churches**: suggestions read people by last name, 15 names per
  request and up to 2,000 people per group of names. A very large Rock may
  need paging over several visits.
- **Verify on a real Rock.** The field names and endpoints come from Rock's
  source (`develop`) and documentation, and are exercised here only against a
  stand-in. Before turning this on for a church, connect it to that church's
  Rock and check a suggestion end to end.

## Sources

- Rock API introduction and the v2 recommendation:
  <https://community.rockrms.com/documentation/supporting-rock/data/api/intro-to-the-rock-api>
- REST keys: <https://community.rockrms.com/documentation/supporting-rock/data/api/rest-keys>
- Securing the API (v1 defaults, v2 controller grants):
  <https://community.rockrms.com/documentation/supporting-rock/data/api/secure-the-api>
- Rock source, <https://github.com/SparkDevNetwork/Rock>:
  `Rock.Rest/Filters/AuthenticateAttribute.cs` (the `Authorization-Token`
  header), `Rock.Rest/ApiController.cs` (OData v3, no default page size),
  `Rock/SystemGuid/DefinedValue.cs` (record type and status Guids).
