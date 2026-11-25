# Church records

Many churches keep their people in church management software, such as
[Rock RMS](https://www.rockrms.com/). two42 calls this the church's
**records**. A church can connect its records to two42 so its members and
church admins don't have to type what the church already knows. two42 only
ever **reads** from the records, and works the same for a church that never
connects them.

This document is the design record. **The baseline** below is built. The rest
is decided but not built, and each part names its ticket.

## Decisions

### Purpose and direction

- **Why connect.** First, less retyping: names, phones, addresses and
  birthdays the church already has. Second, keeping two42 accurate when the
  church office updates someone.
- **One way only.** Data moves from the records into two42. two42 never
  writes to the records. The one possible exception is under
  [Later](#later).
- **The records own identity facts.** Names, contact details and birthdays
  live there. two42 owns everything about how people use two42: what the
  directory shows, events, replies, serving, lessons and funds.

### Scope

| Area | Decision |
|---|---|
| People and their directory details | Now |
| Households, and children without accounts | Later, as suggestions (T42-273) |
| Group rosters | Later: a read-only comparison for a leader, never an automatic change |
| Calendar | Later, shown in two42 only, never copied in |
| Attendance | Never for now: it would mean writing to the records |
| Prayer requests | Never. two42 encrypts them and allows anonymous ones; the records' prayer requests are read by a staff prayer team |
| Giving | Never |
| Serving schedules | Later at most, as a comparison |

### Naming

- The database and code are named after **church records**, not a product:
  `records_connections` and `records_person_links`, each connection with a
  `provider` (`'rock'` today), and `lib/integrations/records/`. Everything
  Rock-specific is in `lib/integrations/rock/`, behind the small
  `RecordsProvider` interface in `lib/integrations/records/types.ts`. A second
  provider adds its own folder and a line in `providers.ts`.
- **Members never see a product name.** A field filled from the records says
  "From your church's records".
- **Church admins do**, because they set it up: **Church settings → Church
  records**, at `/admin/settings/church-records`, where the provider is named
  ("Rock RMS").

### Permissions

- **Each feature documents the exact minimum it needs** from the records, and
  the setup text asks for no more.
- **The read key is always view-only.** It never needs edit or write rights.
- **Writing would use a separate key and role.** If the write idea under
  [Later](#later) is built, it gets its own key, on its own user and role,
  granted only by churches that turn it on. The read key never gains write
  rights.

### Two modes (T42-272, T42-274)

A church admin picks one:

- **Copy into two42** (built first, T42-272). Values from the records are
  stored in two42's own fields. A nightly job asks the records only for people
  changed since the last run. A church admin can also press **Refresh now**.
  This is what makes the directory fast, searchable and viewable offline.
- **Live from the records** (later, T42-274). two42 stores what it needs to
  run: name, sign-in email, phones, gender and photo. Address, birthday,
  anniversary and a child's grade are fetched from the records when a screen
  needs them, only for the people the viewer may already see, and are never
  saved in two42. A church that wants even names kept out of two42 isn't a fit,
  and the setup screen says so.

Switching **from Copy to Live** deletes every value two42 still holds from the
records, after a confirmation that shows how many. Values a member changed in
two42 are theirs and stay. Switching **from Live to Copy** fills the values in.

### Per-field settings

For each field, a church admin chooses:

- **Not from the records:** two42 doesn't touch it.
- **From the records, locked:** shows "Managed by your church", and members
  can't change it.
- **From the records, member can change:** filled from the records. A member's
  edit stops that field updating for that person; it then shows "Changed in
  two42 · Use your church's value".

Rules:

- **Only identity fields can be locked:** name, suffix, title, gender, a
  child's grade.
- **Contact details, birthday, anniversary and photo are always
  member-changeable**, and a member clearing one sticks. In two42 you hide
  something by leaving it out, and a church can't take that away.
- **Values fill in automatically**, and the member gets a one-time notice:
  "Your church filled in some of your details from its records."
- **Preferred name** stays editable. The records' nick name fills it only
  while the member hasn't set one.
- **The sign-in email is never overwritten**, and may differ from the email
  in the records, which is used only for matching.
- **Photos** come from the records and are resized like any upload. A member
  who uploads their own photo keeps it; the records' photo no longer replaces
  it.

For each person and field, two42 keeps track of whether the value came from
the records. That is what makes "Use your church's value" and the Copy-to-Live
deletion possible.

### Fields (T42-271)

New for every church, whether or not it connects its records:

- **Gender:** Male or Female, optional but asked during profile setup like any
  other field. Members can filter the directory by it. It is never used to keep
  anyone out of a group.
- **Title** (Dr., Pastor): shown only where formal, on the profile and the
  teacher listing.
- **Suffix** (Jr., III): always part of the name.
- **A child's grade:** stored as the graduation year so it moves up each school
  year. Shown on the household card only, to people who can already see the
  household. Never searchable or filterable, alone or with location.

Not added: middle name, country, campus, and a marital status field ("married"
comes from the household).

Never copied from the records: phone numbers marked unlisted, the "can receive
texts" flag, connection status (member, attendee, visitor), and church-defined
custom fields.

### Households (T42-273)

- Families in the records become **suggestions** to a church admin, never
  applied automatically. In two42, household membership is chosen by its
  members.
- **Children** come over only if a church admin turns on a church-wide switch,
  off by default. Then they are suggested to the household's adults, who add
  them: first and last name, birthday without the year, grade and photo.
- The family's **address and home phone** go to the household. Mobile and
  work phones go to the person.

### Links ending, and review

- When a link ends, through unlinking or disconnecting, values already copied
  stay in the profile. Only the link and future updates stop.
- People who become **inactive** in the records, or can no longer be found
  there, go to **Needs review** on the church admin's page. Nothing happens to
  them automatically.

### Elsewhere in the app

- **Caching for offline viewing** (T42-275) on phone, browser and desktop:
  only what the person can already see, cleared at sign-out, expiring after 30
  days, never prayer requests or admin pages.

### Later

- **Adding new people to the church's records** (T42-277). A church could let
  two42 capture people who haven't registered with the church and send their
  details to the records. It's the one possible exception to "one way only":
  it creates new people only, with the person's consent, under a separate
  key and role, and only for churches that turn it on.

## The baseline (built)

### For the operator

The integration is off unless `RECORDS_KEY_SECRET` is set: 32 random bytes,
base64. Without it every church records route answers 404 and no screen
mentions it. Generate one with `openssl rand -base64 32` and set it in
Production only, like the prayer keys. Changing it makes every saved key
unreadable, and each church admin has to connect again; the links stay.

### For a church admin

**Church settings → Church records** (`/admin/settings/church-records`).

1. **Connect.** In Rock, add a REST key under Admin Tools › Settings › REST
   Keys, active, on a user made for two42 alone (see
   [Rock RMS](#rock-rms) for the role it needs). Enter the Rock address and
   the key. two42 tries the key before it saves anything. The key is never
   shown again; the page shows its last four characters.
2. **Link people.** two42 suggests a person from the records for each approved
   two42 profile without a link. A suggestion shows the person's name in the
   records and which facts agreed, never the records' values. Link one at a
   time, or select several and link them together.
3. **Unlink** a person, **change the key**, or **disconnect**. Disconnecting
   removes the key and every link; profiles are unchanged. Connecting a
   different address or provider removes the old links, because a person id
   means nothing in other records.

### How a match is suggested

- The **last name must agree**, and the first name must agree with the
  records' first or nick name (case, accents and punctuation ignored). An email
  alone is never a suggestion: people in one household often share an address.
- A **birthday that disagrees** rules a person out. A birthday missing on
  either side says nothing.
- A suggestion can be **linked in bulk** only when an email or birthday also
  agrees and neither side has another candidate. Others carry "Check in Rock
  RMS first" and are linked one at a time.
- Only people the provider marks **linkable** are offered. For Rock that means
  living Person records that aren't Inactive, never a business or nameless
  record.
- When a link is confirmed, the server reads those people again and refuses
  any pair that no longer meets the rule, so a browser can't link a pair the
  server wouldn't suggest.

### What is read and stored

| | Read from the records | Stored in two42 |
|---|---|---|
| Connect | One person id, to prove the key works | Provider, address, sealed key, its last 4 characters, who connected and when |
| Suggest | People with the church's last names: id, names, email, birthday, and what decides whether they're linkable | Nothing |
| Link | The same, for the chosen ids | Profile id, the person's id in the records, who linked and when |

Values from the records are held in memory for one request and are never
logged or stored. No phone, address, family, group or giving data is requested.

### Where it lives

- `lib/integrations/records/` — provider-neutral: `types.ts` (the
  `RecordsProvider` interface), `providers.ts`, `address.ts` (which addresses
  may be called), `crypto.ts` (sealing the key), `match.ts` (suggestions),
  `store.ts` (the two tables, service key only), `errors.ts`, `http.ts` and
  `enabled.ts`.
- `lib/integrations/rock/` — `client.ts` (read-only v1 REST calls) and
  `provider.ts` (Rock as a `RecordsProvider`).
- `app/api/admin/church-records/` — the church admin's routes.
- `app/admin/settings/church-records/` — the page.
- `supabase/migrations/20261202000000_church_records_connection.sql` —
  `records_connections` and `records_person_links`. No client role has any
  privilege on either; see `docs/security/service-role-inventory.md` ("Lib
  helpers").
- `supabase/tests/church_records_suite.sql` — the database's half of the
  boundary.

The integration stays a leaf: nothing outside these paths imports it except
the one link on Church settings.

### Baseline decisions

- **The key is sealed by the server** with AES-256-GCM, under a key derived
  per church and provider from `RECORDS_KEY_SECRET`, the way prayer request
  text is. Not Supabase Vault: the app reads Vault nowhere else, and a sealed
  column with no client grants keeps the key out of every client role's reach
  without a new definer function.
- **Addresses.** Only an `https` origin on a public host name or address. The
  client refuses redirects and gives up after 10 seconds. DNS can still point a
  public name at a private address; with no redirects that host gets one
  request, and nothing it returns is shown except as an error.
- **Person ids are text** in `records_person_links.external_person_id`,
  because providers differ in what an id looks like. Rock's is a number,
  stored as its digits.

## Rock RMS

### API facts

- **v1 REST with a REST key, not v2.** v2 needs Rock 17 or later and a grant on
  each REST controller, and its ad-hoc search needs "Unrestricted Read", which
  skips Rock's own entity security. v1's `GET` needs only View on the
  controllers it reads. Revisit when most churches run Rock 17 or later.
- The key goes in the `Authorization-Token` header. v1 is OData v3, with no
  default page size, so every list asks for a page size.
- Record types and statuses are defined values whose ids differ between
  installs, so they are looked up by Rock's stock Guids: Person record type
  `36CF10D6-C695-413D-8E7C-4546EFEF385E`, Inactive record status
  `1DAD99D5-41A9-4865-8366-F269902B80A4`.
- For later work: group member status is 0 inactive, 1 active, 2 pending; a
  leader is a member whose `GroupTypeRole.IsLeader` is true; and
  `PhoneNumber.IsUnlisted` marks a private number.

### The REST key's user and role

Recommended setup, following [Permissions](#permissions):

- A **dedicated user** for two42's REST key, used for nothing else.
- In a **dedicated security role** that has **View** on only the REST
  controllers two42 reads, and **no edit or write permission** anywhere. For
  the baseline that is **People** and **DefinedValues**.

On Rock's public demo, a key whose user had no role was refused with 401, and
adding the user to **RSR - Staff Workers** was enough. That role grants far
more than two42 needs, so don't use it for a real church. The exact minimum is
confirmed by removing each permission in turn and checking what still works;
T42-272 tracks that, and each later feature adds the controllers it reads to
this list.

### Checked against a real Rock

On 2026-11-21 the client and matching code ran against Rock's public demo
(`rock.rocksolidchurchdemo.com`, Rock 19.3.4), with a key made for the test:

- Connecting, the Guid lookup, the last-name and id filters (including a name
  with an apostrophe) and the field names all worked as written.
- A key with no role got 401, which two42 reports as a key Rock didn't accept.
  A host that isn't Rock got 404.
- Businesses and REST key users were left out by the record-type filter.
- Matching on real data behaved as designed: email or birthday matches could be
  linked in bulk, a name-only match needed checking, and a wrong birthday ruled
  a person out.
- The demo has no inactive or deceased people, so leaving those out is checked
  only by the filter Rock accepted, not by watching one excluded. Pending people
  (status "Pending") are suggested; only Inactive is left out.

The demo resets nightly and its admin login is shared, so it is for manual
checks only, never for automated tests. Before turning this on for a church,
connect it to that church's Rock and check a suggestion end to end.

### Still open

- **Family roles:** Rock's Adult and Child roles are configurable per install.
  This matters when households come over (T42-273).
- **Partial dates:** Rock stores birth month, day and year separately, so a
  birthday without a year works. Anniversaries need checking on a real install.
- **Large churches:** suggestions read people by last name, 15 names per
  request and up to 2,000 people per group of names. A church of about 2,000
  needs some 65 requests the first time; sending a few at once would cut that.

### Sources

- Rock API introduction and the v2 recommendation:
  <https://community.rockrms.com/documentation/supporting-rock/data/api/intro-to-the-rock-api>
- REST keys: <https://community.rockrms.com/documentation/supporting-rock/data/api/rest-keys>
- Securing the API (v1 defaults, v2 controller grants):
  <https://community.rockrms.com/documentation/supporting-rock/data/api/secure-the-api>
- Rock source, <https://github.com/SparkDevNetwork/Rock>:
  `Rock.Rest/Filters/AuthenticateAttribute.cs` (the `Authorization-Token`
  header), `Rock.Rest/ApiController.cs` (OData v3, no default page size),
  `Rock/SystemGuid/DefinedValue.cs` (record type and status Guids).
