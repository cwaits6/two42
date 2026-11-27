# Church records

Many churches keep their people in church management software, such as
[Rock RMS](https://www.rockrms.com/). two42 calls this the church's
**records**. A church can connect its records to two42 so its members and
church admins don't have to type what the church already knows. two42 only
ever **reads** from the records, and works the same for a church that never
connects them.

This document is the design record. **The baseline**, **Copy into two42**
and **Live from the records** below are built. The rest is decided but not
built, and each part names its ticket.

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
| Households, and children without accounts | Now, as suggestions |
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

- **Copy into two42** (built, T42-272; see [Copy into two42](#copy-into-two42-built)). Values from the records are
  stored in two42's own fields. A nightly job asks the records only for people
  changed since the last run. A church admin can also press **Refresh now**.
  This is what makes the directory fast, searchable and viewable offline.
- **Live from the records** (built, T42-274; see [Live from the records](#live-from-the-records-built)). two42 stores what it needs to
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
- **No email is copied** (maintainer, 2026-11-26). The records' email is used
  only for matching, and two42 keeps one email per person, the sign-in
  address. A separate contact email would be its own ticket.

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

### Households

- Families in the records become **suggestions** to a church admin, never
  applied automatically. In two42, household membership is chosen by its
  members.
- **Children** come over only if a church admin turns on a church-wide switch,
  off by default. Then they are suggested to the household's adults, who add
  them: first and last name, birthday without the year, grade and photo.
- The family's **address and home phone** go to the household. Mobile and
  work phones go to the person.

How it works:

- **The refresh works the suggestions out and stores them.** Each refresh,
  nightly or Refresh now, reads the family of every linked person once
  (`RecordsCopySource.households`, a capability a provider may offer; shared
  code asks for it and never names a provider). From that read it replaces
  the household suggestions, copies confirmed households' address and home
  phone, and updates the suggested children. The church admin's
  **Households** tab reads only two42's database, and the browser sends only
  suggestion ids. A refresh cut short keeps the last refresh's suggestions.
  A key refused a family read ends only the household step: people are still
  copied, and the tab says families couldn't be read. Any other records error
  reading families fails the refresh, like any other.
- **Which household.** A family's household is the one already linked to it;
  else, of its linked people's households not linked to another family, the
  one holding most of them, then the oldest; else a new household named from
  the most common two42 last name among them. Only approved people count, and
  a person counts only in their own primary family.
- **Confirming** (`records_confirm_household()`, all or nothing) moves exactly
  the people the suggestion names, by their household and relationship, and
  links the household to the family. Whoever stays behind keeps their
  household with its address, phone, photo, anniversary and the people in it
  without an account; it is never deleted. A suggestion where anyone leaves a
  household they're in is **Check first**, confirmed one at a time; the rest
  are **Ready to confirm**, in bulk. Confirming refuses a suggestion that
  changed since the refresh (anyone moved, unlinked or no longer approved,
  anyone it names given another relationship, the household linked elsewhere
  or holding a primary or spouse it didn't), and
  is refused while a refresh runs.
- **Relationships.** When the family's two adults are married in the records
  and both are linked, one is `primary` (whoever already is, in the household)
  and the other `spouse`. A child in the records becomes `child`. Anyone whose
  `primary` or `spouse` would clash with one the household already has
  becomes `other`.
- **Address and home phone** follow the field settings, always
  member-changeable. Their source is kept per **linked household**
  (`records_household_values`), not per person, so a clear by either adult
  sticks whichever adult the copy reads next. The states are the same as a
  person's: `records` follows the church, `changed` and `cleared` are the
  household's. An address outside the US, or one the household form wouldn't
  accept, counts as empty. While a spouse's own mobile is the household's
  phone, the copy leaves it alone. The anniversary keeps its per-person source.
- **Children.** While the switch is on, each confirmed household's family's
  children are stored as open suggestions (`records_child_suggestions`), with
  only the fields above and never a birth year. A child already linked to an
  account, or already in the household under the same name, isn't suggested;
  an entry another child was added as doesn't count, so two children of one
  name are both suggested. Accents fold only on Latin letters.
  RLS shows open suggestions only to that household's primary and spouse, and
  only while the switch is on. They add (`records_add_suggested_child()`,
  which writes a child without an account, no birth year) or dismiss
  (`records_dismiss_suggested_child()`); either keeps only the record of the
  decision, so the child isn't suggested again. Disconnecting cascades
  through the household links and deletes those decisions. An added child's photo is
  fetched by the next refresh, stored under the child's own storage key, and
  never replaces a photo the household uploaded. Turning the switch off
  removes every open suggestion and every photo still waiting. Saving the
  switch is refused while a refresh holds its claim, because that refresh
  works from the switch it read when it started.
- Not built: dismissing a household suggestion, unlinking a household, and a
  review list for families missing from the records.

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
base64. Without it every church records route answers 404 and the settings
page is gone; details already copied keep their labels, and a locked one stays
locked, because the database keeps enforcing the settings it holds. Generate one with `openssl rand -base64 32` and set it in
Production only, like the prayer keys. Changing it makes every saved key
unreadable, and each church admin has to connect again; the links stay.

### For a church admin

**Church settings → Church records** (`/admin/settings/church-records`).

1. **Connect.** In Rock, add a REST key under Admin Tools › Settings › REST
   Keys, active, on a user made for two42 alone (see
   [Rock RMS](#rock-rms) for the role it needs). Enter the Rock address and
   the key. two42 tries the key on every controller a refresh reads before it
   saves anything, so a missing permission shows now, not at the first
   refresh. The key is never
   shown again; the page shows its last four characters.
2. **Link people.** two42 suggests a person from the records for each approved
   two42 profile without a link. A suggestion shows the person's name in the
   records and which facts agreed, never the records' values. The page is
   built for churches with thousands of people, so every list is searched by
   name and shown 25 at a time:
   - **Ready to link:** the name and an email or birthday agree, with only one
     possible match on each side. Link them all at once, or review the list
     and untick anyone first. two42 sends them 100 at a time, shows its
     progress, and stops at the first batch the server refuses.
   - **Check first:** only the name agrees, or there's more than one possible
     match. Each is linked by hand; a profile with several possible matches
     shows them all to choose from.
   - **No match found:** usually not in the records yet, or spelled
     differently.
3. **Unlink** a person, **change the key**, or **disconnect**. Disconnecting
   removes the key and every link; profiles are unchanged. Connecting a
   different address or provider removes the old links, because a person id
   means nothing in other records.
4. **Households.** When the provider reads families, the page has a
   **Households** tab: the **Suggest children** switch, and the refresh's
   household suggestions under **Ready to confirm** and **Check first**,
   searched by name and shown 25 at a time. See [Households](#households).

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
| Copy | See [Copy into two42](#copy-into-two42-built) | The copied values in the profile, and where each came from |

Values read to suggest or link are held in memory for one request. Nothing
read from the records is ever logged. The baseline requests no phone,
address, family, group or giving data; copying reads listed phones.

### Where it lives

- `lib/integrations/records/` — provider-neutral: `types.ts` (the
  `RecordsProvider` interface), `providers.ts`, `address.ts` (which addresses
  may be called), `safeFetch.ts` (the only way a key leaves two42),
  `crypto.ts` (sealing the key), `match.ts` (suggestions), `store.ts` (the two
  tables, service key only), `errors.ts`, `http.ts` and `enabled.ts`.
- `lib/integrations/rock/` — `client.ts` (read-only v1 REST calls) and
  `provider.ts` (Rock as a `RecordsProvider`).
- `app/api/admin/church-records/` — the church admin's routes.
- `app/admin/settings/church-records/` — the page.
- `supabase/migrations/20261202000000_church_records_connection.sql` —
  `records_connections`, `records_person_links` and
  `records_save_connection()`. No client role has any privilege on either
  table or the function; see `docs/security/service-role-inventory.md` ("Lib
  helpers").
- `supabase/tests/church_records_suite.sql` — the database's half of the
  boundary.
- For copying: `supabase/migrations/20261209000000_church_records_copy.sql`
  (the settings, sources, person state and refresh tables, the two
  service-role functions and the member-edit triggers), with
  `supabase/tests/church_records_copy_suite.sql`; the shared code in
  `supabase/functions/_shared/` (`records-*.ts`, `rock-client.ts`,
  `rock-copy.ts`, `name-case.ts`, `phone.ts`), which the `lib/` files
  re-export; `supabase/functions/refresh-church-records/`; and
  `lib/integrations/records/` `refresh.ts`, `photo.ts`, `settings.ts`,
  `labels.ts` and `profileRecords.ts`.
- For households: `supabase/migrations/20261210000000_church_records_households.sql`
  (the children switch, household links, household sources, household and
  child suggestions, their functions and the household member-edit trigger),
  with `supabase/tests/church_records_households_suite.sql`;
  `_shared/records-households.ts` (the pure planners), `_shared/rock-households.ts`,
  `_shared/address-case.ts`; `app/api/admin/church-records/households/`,
  `RecordsHouseholds.tsx` and `householdLists.ts`; and
  `components/household/SuggestedChildren.tsx`.
- For live details: `supabase/migrations/20261211000000_church_records_live.sql`
  (the mode, `records_save_mode()`, the count, the guards and
  `records_live_hide()`), with `supabase/tests/church_records_live_suite.sql`;
  `lib/integrations/records/live.ts` and `livePlan.ts`,
  `lib/integrations/rock/live.ts`, `app/api/directory/live/`,
  `app/api/admin/church-records/mode/`, `RecordsMode.tsx`, and
  `components/directory/liveDetails.ts` and `LiveDetailsContext.tsx`.

Outside these paths, three kinds of code import it: the link on Church
settings; the pages and forms that show a detail's records state
(`app/profile/page.tsx`, `app/profile/setup/`, `app/admin/members/[id]/page.tsx`,
`app/admin/families/HouseholdsManager.tsx`, `components/profile/` and
`components/household/`); and name saving everywhere, because
`lib/sanitize.ts` and `lib/nameField.ts` use `_shared/name-case.ts`. Removing
the integration keeps `name-case.ts`.

### Baseline decisions

- **The key is sealed by the server** with AES-256-GCM, under a key derived
  per church and provider from `RECORDS_KEY_SECRET`, the way prayer request
  text is. Not Supabase Vault: the app reads Vault nowhere else, and a sealed
  column with no client grants keeps the key out of every client role's reach
  without a new definer function.
- **Addresses.** Only an `https` origin on a public host name or public
  address: private, loopback, link-local, shared, benchmarking, documentation,
  multicast and reserved ranges are refused, and so is any IPv6 literal.
  Because DNS can point a public name at a private address, `safeFetch()`
  checks every address the name resolves to at the moment it connects, and
  refuses before the key is sent. It also refuses redirects, gives up after 10
  seconds and stops reading past 5 MB.
- **A connection has an id that changes with the records it points at.**
  Saving runs in one transaction (`records_save_connection()`): a new key for
  the same records keeps the id and the links; another provider or address
  replaces the row, so the links go with the old id. Links are written under
  the id they were checked against, so a save that lands while an admin is
  linking makes the links fail rather than file them under other records.
- **Bulk linking is checked by the server.** More than one pair at a time is
  accepted only if every pair is a suggestion the server itself would mark
  confirmable in bulk, worked out again from the records. When a last name has
  more people than two42 reads, its pairs are never bulk-confirmable, since a
  competing candidate may be unread. Last names are looked up in the spellings
  matching treats as equal (`O'Brien` and `OBrien`, `Smith-Jones` and `Smith
  Jones`).
- **Person ids are text** in `records_person_links.external_person_id`,
  because providers differ in what an id looks like. Rock's is a number,
  stored as its digits.

## Copy into two42 (built)

T42-272. A church admin chooses a setting for each field under **What two42
copies** on the church records page; linked people's values are filled in
and kept up to date.

### How it works

- **Settings** (`records_field_settings`): one row per field the church fills,
  `locked` or `member`; no row is *Not from your church's records*. Field names
  are two42's: `name` (first and last), `suffix`, `title`, `gender`,
  `phone_mobile`, `phone_work`, `birthday`, `anniversary` (the household's;
  each linked person's records hold their own, so while two linked people in
  a household differ, the first one copied stands and the other's isn't
  recorded; a member's change or clear of it is still worked out as usual and
  takes the new church value, so the two agree again once the church corrects
  both),
  `photo` and `grade` (the person's own household member row). The preferred
  name follows `name`, and is never locked. Turning a field off removes its
  sources, so its values become ordinary two42 data; any change asks the next
  refresh to copy everyone in full. A save is refused while a refresh holds
  its claim, because that refresh works from the settings it read when it
  started.
- **Where each value came from** (`records_field_values`): per linked person
  and field, `records`, `changed` or `cleared`, with the church's last value.
  It goes with the link, so unlinking or disconnecting leaves the values as
  ordinary data, and live mode (T42-274) can find what to remove.
- **Member edits** are marked by `BEFORE UPDATE` triggers on `profiles`,
  `family_units` and `family_members`, so every screen that saves a profile
  counts: an edit is `changed`, a clear `cleared`, the church's own value
  `records` again (which is all **Use your church's value** does). A locked
  value is kept, not refused, because every profile form sends each column.
  Only a signed-in person's write counts; the refresh writes as the service
  role.
- **The rules** for one person's copy are `planPersonCopy()` in
  `supabase/functions/_shared/records-copy.ts`:
  - Locked: two42 holds the church's value, an empty one included.
  - Member-changeable, first fill: an empty two42 value is filled. One the
    member already entered is kept and marked `changed`, with the church's
    value offered back. Turning a field on never replaces what a member
    entered.
  - Member-changeable, `records`: follows the records, a removal included.
  - `changed` or `cleared`: left alone; only the church's value is updated.
  - Preferred name: filled from the nick name only while empty, and not when
    the nick name is the first name.
  - Values are normalized the way the forms save them (names cased, phones
    E.164), so saving an unchanged form isn't an edit. A value the forms
    wouldn't accept counts as empty.
  - Photo: downloaded only to fill an empty photo, or to follow a new one while
    `records`. Stored at `<org>/profiles/<profile>/records-photo.jpg` in the
    avatars bucket, never linked to the church's server. A member's own upload
    is another address, marked `changed`, so it is never replaced.
- **Refresh** (`refreshOrg()` in `_shared/records-refresh.ts`): nightly in the
  `refresh-church-records` edge function and on **Refresh now**. It claims the
  church's refresh so two never overlap, reads every link's existence and
  status by id for **Needs review**, then copies linked people never copied and
  people changed since the last mark, 50 at a time, within a time budget,
  people never copied first. Each
  copy goes through `records_apply_copy()`, which writes nothing if the
  member's values changed since they were read, or if the profile is now
  linked to someone else. A refresh that runs out of
  time marks the people it didn't reach to be copied in full next time, and
  still moves the mark on. Details are read only for those
  people; existence and status are read for everyone linked, because a
  person deleted or merged in the records leaves no change to find.
- **Needs review**: linked people who are inactive (or deceased, or not a
  person record) or can't be found. Nothing happens to them; they aren't
  copied while listed.
- **Last refreshed** is written only when a refresh finishes; a failed one
  releases its claim and leaves it as it was. A photo the records can't serve
  right now (no answer, a timeout, a 5xx or a 429) fails that person's copy, so
  they are tried again; a photo the records have no usable copy of is
  skipped.
- **The one-time notice**: set when a copy first fills a value, shown on
  **My profile** until the member selects **Got it**, never again. It links to
  each filled detail the member can change; the anniversary's link opens the
  Household tab. A linked person's grade is on no member's form.
- **Labels on every form that edits a copied detail**: **My profile**, the
  setup steps, the household edit sheet (a household manager reads the
  sources of the people they can edit), the household's anniversary (everyone
  in the household reads its source) and the church admin's member and
  household pages. When the sources can't be read, the page shows its error
  state rather than a form that would offer a locked detail.
- **Providers.** Copying is the optional `copy` capability of
  `RecordsProvider`; the shared code asks whether a provider has it and never
  names one. Each provider also describes its own connect step. The nightly
  function finds a provider's copy source in `_shared/records-providers.ts`.
- **One source for both runtimes.** The edge function can't import `lib/`, so
  the code both run (the Rock client, the address check and `safeFetch()`, key
  sealing, name casing, the copy rules and the refresh) lives in
  `supabase/functions/_shared/`, and `lib/` re-exports it
  (`allowImportingTsExtensions` lets `lib/` import modules that import each
  other with `.ts`). The phone normalizer can't be shared as code, so
  `_shared/phone.ts` uses the same libphonenumber-js release, and both are held
  to `_shared/phone-fixtures.ts`. A key sealed by the app is opened in both
  runtimes' tests (`_shared/records-crypto-vector.ts`).

### What is read

| | Read from the records | Stored in two42 |
|---|---|---|
| Refresh, every linked person | Id, record type, record status, deceased | Why they need review, and since when |
| Refresh, changed people | Ids and modified times of people and phone numbers changed since the mark | The mark |
| Copy | Names, nick name, title, suffix, gender, birthday, anniversary, graduation year, photo id; listed mobile and work phones; the names of title and suffix values | The copied values, where each came from, the church's last value |
| Photo | The photo, resized by the records to 400 pixels | The photo, in two42's storage |
| Refresh, households | Each linked person's family id; each family's active members, whether each is an adult and married; the family's home address; adults' listed home phones | The household suggestions, which households are linked to which family, the household's copied address and home phone and their source |
| Refresh, children (switch on) | Each child's first and last name, birth month and day, graduation year and photo id; never the birth year | Open suggestions with those fields; for a decided child only the decision |

Never copied: email (used only for matching), the texting flag, connection
status and the church's own fields. Unlisted phones can arrive with a person's
phone numbers and are dropped as they are read, never stored or copied.
Address and home phone go to the household, never to the person.

### For the operator

Set `RECORDS_KEY_SECRET` in the edge function secrets as well, the same value
as the app's, and schedule `refresh-church-records` nightly (no migration
does), off the hour so the scheduled-jobs check, which doesn't know the job,
doesn't count its responses: see the docs site's **Edge functions** page. Before it opens a key the
function checks the runtime refuses a request to a loopback address, and stops
with a 500 if it doesn't.

### Still open

- **A phone removed in the records** without any other change to the person
  is seen only when the person next changes, since a deleted phone number row
  leaves nothing changed to find.
- **Photos on a real Rock.** Rock serves photos only through its image
  handler, which follows Rock's own photo security rather than the REST key.
  Where Rock doesn't let a request without a sign-in see a photo, two42
  counts it as skipped. Check on a real install.
- **The hosted Edge Runtime**: the loopback check above, and the time a first
  copy of a large church takes.

## Live from the records (built)

T42-274. A church admin chooses **Live from your church's records** under
**How two42 uses your church's records** on the church records page.

### How it works

- **The mode** is `records_org_settings.mode`, `copy` (the default, and what
  no row means) or `live`. It belongs to the church, like the field settings
  it qualifies, so it survives reconnecting. The field settings still say
  which fields come from the records; the mode says whether the live-only
  ones are copied or read live.
- **Live-only fields** are a person's `birthday`, a household's `anniversary`
  and `address`, and a child's `grade` (`LIVE_ONLY_FIELDS` in
  `_shared/records-copy.ts`, `records_live_only_field()` in SQL). Everything
  else a church copies, names, phones, gender and photo, is copied as before.
- **Switching** goes through `records_save_mode()`, refused while a refresh
  holds its claim. **Copy → Live**, in one transaction: every live-only value
  whose source is still `records` is cleared from two42 (birthday, the
  person's own grade row, a household's anniversary when every linked
  person's source for it is the church's, a linked household's address), its
  source is removed, the church's last value is forgotten on the sources
  members changed or cleared, and open child suggestions lose their birthday
  and grade. The confirmation's count is `records_live_copied_count()`, one
  per value (two spouses' anniversary is one). Values a member changed stay
  theirs. A child already added from a suggestion holds no source, so their
  details are ordinary two42 data and stay, like values left after a link
  ends. **Live → Copy** asks the next refresh to copy everyone in full, and
  the admin's page starts **Refresh now**; households and children are read in
  full every refresh already.
- **Never stored.** The refresh, nightly and **Refresh now**, reads the mode
  inside its claim and plans no live-only field (`storedFields()`), copies no
  household address, and suggests children with names and photo only. Under
  that, `records_live_value_guard` and `records_live_child_guard` refuse, in
  live mode, any source of a live-only field that is `records` or keeps a
  church value, and any suggested child with a birthday or grade. Every copy
  of one of these fields writes its source in the same call, so a write path
  that forgot live mode fails rather than storing anything.
  `supabase/tests/church_records_live_suite.sql` checks no such value is
  stored after the switch.
- **Reading them.** The directory layouts ask `liveDirectoryOn()` (no provider
  call); only when it is on does the directory's client make one request to
  `GET /api/directory/live` per directory open, shared by all five tabs.
  `readLiveDirectory()` reads the people and households the viewer may see
  through the viewer's own RLS-scoped `profiles_directory` and
  `families_directory_full`, then, on the service client filtered on the
  request's `app_request_org_id()`, only those people's links and sources.
  `planLiveRequest()` decides each detail by the copy rules applied at read
  time: a value the member entered or changed in two42 is theirs, a cleared
  one stays hidden, and only an empty one with no source of its own is the
  records'. The provider is asked once, for exactly those ids. The answer is
  normalized as the copy would store it (`formDate()`,
  `householdChurchValues()`), merged into the rows the cards and lists already
  read (`applyLiveDetails()`), so live and copied details render through one
  path. Grades are fetched only for children added from a suggestion while
  the church suggests children: a linked person's own grade row is on no
  directory screen.
- **Field settings gate it.** Only a live-only field the church turns on under
  **What two42 copies** is read live; one set to "Not from your church's
  records" is neither read nor marked live on the admin's page.
- **Hiding.** A live value is never in two42 for a member to leave out, so
  `records_live_hide()` records a `cleared` source instead: a member's own
  birthday, or, for a household's primary or spouse, its address and
  anniversary. **Don't show** and **Show again** are on the member's own entry
  and household in the directory. A clear made in live mode stays the
  member's if the church switches back to copy.
- **Not reachable.** When the provider fails, or the key can't be opened,
  every detail that would have come from it shows "Not available right now";
  the rest of the directory is unaffected. When two42's own reads fail once
  the church is known to be live (the mode, the directory, the sources), or
  the request itself fails, the answer is `LIVE_UNAVAILABLE`: each entry and
  both lists say their details from the records aren't available, rather than
  showing none. The log line carries the error's kind only.
- **Never cached.** The route answers `Cache-Control: private, no-store` and
  is dynamic, the browser fetches it with `cache: "no-store"`, and the
  provider's requests are `no-store`. Nothing is kept server-side. Caching on
  the person's device is T42-275, not built.
- **Providers.** Live is the optional `live` capability of `RecordsProvider`
  (`RecordsLiveSource.details()`); shared code asks `liveSourceOf()` in
  `lib/integrations/records/providers.ts`, which also needs `copy`, since
  switching back fills the details in through it.
  Rock's is `lib/integrations/rock/live.ts`.

### What is read

| | Read from the records | Stored in two42 |
|---|---|---|
| Directory, live | For the visible linked people and added children: birth month and day, anniversary date, graduation year; never the birth year. For the visible linked households: the home address | Nothing |
| Refresh, live mode | As in copy mode | Only what live mode keeps: names, phones, gender, photo, and suggested children's names and photo |

Requests per directory open, from the code: `ceil(P/50)` People requests for P
people, and when any household's address is due, one DefinedValues lookup
plus `ceil(F/50)` Groups and `ceil(L/50)` Locations requests for F households
and L home locations. For 200 people and 80 households: 4 + 1 + 2 + 2 = 9,
run as two parallel chains. `lib/integrations/rock/live.test.ts` pins this.

### Still open

- **Measured on a real Rock.** The request count above comes from the code;
  how long a directory open takes against a real Rock, and how a large church
  fares, is still to measure on Rock's public demo.
- **Other screens.** Group Home's "this week" list, the contact card download,
  the profile page's directory preview and the church admin's member page show
  two42's stored values only in live mode.

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
- `ModifiedDateTime` is in the church's own time zone, so the refresh's mark
  is Rock's own latest `ModifiedDateTime`, never two42's clock, and is checked
  against `yyyy-MM-ddTHH:mm:ss[.fffffff]` before it goes into a filter.
- Phone types are defined values: mobile
  `407E7E45-7B2E-4FCD-9605-ECB1339F2453`, work
  `2CC66D5A-F61C-4B74-9AF9-590A9847C13C`. `PhoneNumber.IsUnlisted` marks a
  private number, which is dropped when read; `IsMessagingEnabled` (the texting
  flag) is never requested. `Gender` is 0 unknown, 1 male, 2 female.
- Group member status is 0 inactive, 1 active, 2 pending; only active
  family members count. For later work: a leader is a member whose
  `GroupTypeRole.IsLeader` is true.
- Families: a person's family is `Person.PrimaryFamilyId`. Adults and children
  are told apart by `Person.AgeClassification` (1 adult, 2 child), which Rock
  works out from family roles and age, so no role ids are needed. Married is
  marital status `5FE5A540-7D9F-433E-B47E-4229D1472248`; the home address is
  the family's location of type `8C52E53C-2A66-435A-AE6E-5EE307D9A0DC`,
  preferring the mailing one; the home phone is type
  `AA8732FB-2CEA-4C76-8D6D-6AAA2C6A4303`.

### The REST key's user and role

Recommended setup, following [Permissions](#permissions):

- A **dedicated user** for two42's REST key, used for nothing else.
- In a **dedicated security role** that has **View** on only the REST
  controllers two42 reads, and **no edit or write permission** anywhere.
  two42 needs no edit or write permission at all.

The controllers, from the requests the code makes
(`supabase/functions/_shared/rock-client.ts`, `rock-copy.ts` and
`rock-households.ts`, and `lib/integrations/rock/live.ts`, every one a `GET`).
Live details read no controller the list didn't already have:

| REST controller | Read for | Requests |
|---|---|---|
| **People** | Connecting, suggesting, linking, copying, review, live details | `GET /api/People` with `$select` of the fields in the tables above |
| **DefinedValues** | Connecting, record type and status, phone types, the names of titles and suffixes, and the home location type for live addresses | `GET /api/DefinedValues` by Guid or id, `$select=Id,Guid` or `Id,Value` |
| **PhoneNumbers** | Connecting, copying phones, families' home phones, and finding people whose phones changed | `GET /api/PhoneNumbers` by `PersonId`, `$select=PersonId,Number,CountryCode,IsUnlisted,NumberTypeValueId`; or by `ModifiedDateTime` then `Id`, `$select=PersonId,Id,ModifiedDateTime` |
| **Groups** | Connecting, and each family's home address, copied or live | `GET /api/Groups` by `Id`, `$expand=GroupLocations&$select=Id,GroupLocations/LocationId,GroupLocations/GroupLocationTypeValueId,GroupLocations/IsMailingLocation` |
| **GroupMembers** | Connecting, and who is in each family | `GET /api/GroupMembers?$filter=(GroupId eq …) and IsArchived eq false&$select=GroupId,PersonId,GroupMemberStatus&$orderby=Id`, paged |
| **Locations** | Connecting, and the address itself, copied or live | `GET /api/Locations` by `Id`, `$select=Id,Street1,Street2,City,State,PostalCode,Country` |

For families, People is also read by `Id` with
`$select=Id,PrimaryFamilyId`, and for the family's members
`Id,AgeClassification,MaritalStatusValueId,RecordTypeValueId,RecordStatusValueId,IsDeceased`,
adding `FirstName,LastName,BirthMonth,BirthDay,GraduationYear,PhotoId` only
while the church suggests children. Live details read People by `Id` with
`$select=Id,BirthMonth,BirthDay,AnniversaryDate,GraduationYear`, and a
family's home address the way households do (`lib/integrations/rock/live.ts`).
`BirthYear` is never requested.

Photos aren't read through the REST API: Rock has no endpoint for them. They
come from `GetImage.ashx?id=<PhotoId>&maxwidth=400&maxheight=400&format=jpg`,
which never reads the REST key, so two42 doesn't send it there. The role needs
nothing for photos; Rock's own photo security decides whether one is given.

To set it up in Rock:

1. Under Admin Tools › Settings › Security Roles, add a role, such as
   "two42 read-only", with no members but the user below.
2. Under Admin Tools › Settings › REST Controllers, open **People**,
   **DefinedValues**, **PhoneNumbers**, **Groups**, **GroupMembers** and
   **Locations** in turn, and on each, under Security, allow **View** for the
   role. Grant nothing else, and no **Edit**
   or **Administrate**.
3. Under Admin Tools › Settings › REST Keys, add a key, active, on a new user
   for two42 alone, and add that user to the role.

On Rock's public demo, a key whose user had no role was refused with 401, and
adding the user to **RSR - Staff Workers** was enough. That role grants far
more than two42 needs, so don't use it for a real church. The minimum above
comes from the requests the code makes; it is still to be confirmed on a test
Rock by removing each permission in turn and checking what still works. Each
later feature adds the controllers it reads to this list.

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

- **Family roles:** Rock's Adult and Child roles are configurable per install;
  two42 reads `AgeClassification`, which Rock works out from them, rather than
  role ids. Check its values on a real family.
- **Families on a real Rock:** that v1 honours `$select` on the expanded
  `GroupLocations`, and that the expand needs no grant on the GroupLocations
  controller. A key whose role lacks Groups, GroupMembers or Locations copies
  people and reports households unavailable.
- **Partial dates:** Rock stores birth month, day and year separately, so a
  birthday without a year works. Anniversaries need checking on a real install.
- **Large churches:** suggestions read people by last name, 15 names per
  request and up to 2,000 people per group of names. A church of about 2,000
  needs some 65 requests the first time; sending a few at once would cut that.
  Families are read in full on every refresh, since a change to a family's
  address or members leaves nothing changed on its people: about four
  requests per 50 families, plus the members' pages.

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
