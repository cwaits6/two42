# Prayer request encryption

Prayer requests reveal health, family and faith. The database stores a
request's text only as ciphertext, and an anonymous request stores no author,
only a keyed hash. The keys live in the server environment, outside the
database. Members see the same wall they always did; the server opens the text
and recognises authors before a page renders.

## Who can read what

- **The operator holds the keys.** Anyone with the keys and database access,
  the operator included, can open every request and can identify the author of
  an anonymous request by recomputing the hash for each person in the church.
  Nothing here stops that, and no copy, policy or page may say otherwise.
- **A database copy without the keys** (a leaked dump, a backup, the Supabase
  dashboard) shows no request text and no author of an anonymous request. It
  still shows who wrote a by-name request, which group a request is in, when it
  was posted and answered, and who prays for it.
- **Members** read through the app, as before: the text of every request in
  their groups, the name on a by-name request where the directory rules show
  it, and "You" on their own requests, anonymous ones included.
- Rows written before the conversion keep plaintext `body` and, if anonymous,
  `author_id` until `scripts/encrypt-prayer-requests.mjs` has run (see
  [Converting existing rows](#converting-existing-rows)).

## What is stored

| Column | Holds |
|--------|-------|
| `body_ciphertext` | `v1.<key id>.<iv>.<ciphertext and tag>`: AES-256-GCM, a random 96-bit IV per write, base64url parts. The additional data is `<org_id>:<request id>`, so text copied onto another row or into another church fails to open. |
| `author_hash` | Anonymous requests only: `h1.<key id>.<mac>`, HMAC-SHA256 over `<request id>:<author id>`. Keyed on the request id, so two requests by one person share no stored value. |
| `author_id` | By-name requests only. Anonymous requests store none. |
| `body` | Plaintext, on rows not yet converted. The app never writes it. |

The key id is the first 8 hex characters of SHA-256 over a fixed label and
the master key. It is the same on every row sealed with that key, so it links
nothing, and it tells the current key from the previous one during a rotation.

Check constraints require exactly one text form and one author form on every
row, and an author on every by-name row. No client role can write the table;
the routes under `app/g/[groupId]/prayer/requests/` are the only writers in
the app, so a browser can never store text the server did not seal.

## The keys

| Variable | Purpose |
|----------|---------|
| `PRAYER_BODY_KEY` | Seals and opens request text. |
| `PRAYER_AUTHOR_KEY` | Keys the anonymous author hash. |
| `PRAYER_BODY_KEY_PREVIOUS`, `PRAYER_AUTHOR_KEY_PREVIOUS` | Set only during a rotation. |

Each is 32 random bytes in base64: `openssl rand -base64 32`. Each church
gets its own keys, derived with HKDF-SHA256 from the master key and the
church's id, so a key for one church opens nothing in another.

They are separate so that each can be rotated, or lost, without the other:
losing the author key costs recognition only, losing the body key costs text.

Keep two copies of every key outside the hosting provider, for example the
password manager and an offline copy. Backups of the database are only as
readable as the keys you keep for them.

## When a key is missing or wrong

The server reads the keys from its environment on every request. A missing or
malformed key (not exactly 32 bytes of base64) counts as missing.

- **The prayer page** shows its failed state, never ciphertext and never an
  empty wall. So does a page holding any request whose text fails to open,
  which is what a wrong body key causes.
- **Home** shows its prayer section as failed, never empty. The rest of the
  page, "New in the group" included, still shows; answered requests are left
  out of it.
- **Posting, marking answered, editing and deleting** return 503 and the
  board's usual error message.
- **Account download and account deletion** fail when a key is missing,
  rather than leave a person's anonymous requests out of the file or behind in
  the database.
- **A wrong author key** cannot be detected: a hash under another key matches
  no one, so authors are not recognised on their anonymous requests until the
  right key is back. Under it, account download leaves the person's anonymous
  requests out, and account deletion goes ahead without them: they stay,
  nobody's, until a leader deletes them or the church's retention period
  removes them.

**Production** must have both keys. **Preview deployments** carry no service
secrets by design, the prayer keys included, so on a preview the prayer page
and Home's prayer section show their failed state, and every route that needs
the service key already fails there. **Locally**, put your own keys in
`.env.local`; the Playwright specs read them from there to open what the app
stored. CI generates fresh keys for each run.

## Converting existing rows

`scripts/encrypt-prayer-requests.mjs` seals every plaintext `body`, replaces
each anonymous row's `author_id` with its hash, and, during a rotation, moves
text and hashes onto the current keys. The database cannot do this itself,
because the keys are not in it.

```bash
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SECRET_KEY=<service key>
export PRAYER_BODY_KEY=<key> PRAYER_AUTHOR_KEY=<key>
node scripts/encrypt-prayer-requests.mjs            # dry run: counts per church
node scripts/encrypt-prayer-requests.mjs --apply    # converts
node scripts/encrypt-prayer-requests.mjs            # should report only noop
```

During a rotation, also export the `_PREVIOUS` key.

`--org <uuid>` limits it to one church.

**What the dry run proves.** It opens every sealed row, so it proves the
**body key** before anything is written. It cannot prove the **author key** the
same way, because a hash cannot be opened, and hashing a legacy anonymous
request under a wrong author key cannot be undone. Two checks cover it:

- The script prints the id of each key it was given (`body key <id>, author
  key <id>`). Every hash the app wrote names its key:
  `select distinct split_part(author_hash, '.', 2) from public.prayer_requests where author_hash is not null;`
  must return only the printed author key id (and, during an author rotation,
  the previous key's).
- In a church that still has anonymous requests to hash and already holds
  hashes, none of them under the given author key or its `_PREVIOUS`, the
  script refuses to hash, reports it, and exits non-zero, on the dry run and
  on `--apply` alike.

On a first conversion, `unmatched` means the author key is wrong: stop, and do
not run `--apply`. The same goes for `unmatched` on a request posted since the
deploy. Outside the end of an author rotation or a lost author key, it is never
expected.

The script never sets
`updated_at`, so a converted request does not look newly answered on Home.
Each write is guarded on the `updated_at` it read; a row the app changed in
the meantime is counted and left for the next run. It prints counts only,
never request text or anyone's id, and exits non-zero when anything is left:
`error` (text that does not open with the configured keys) or a write that
lost a race, or a church refused as above. `unmatched` (an anonymous hash
under an old author key that matches no one; see below) is reported but does
not change the exit code: once an author rotation has finished or an author
key is lost, nothing can change it, and the script still moves that row's text
onto the current body key.

Afterwards, this should return 0:

```sql
select count(*) from public.prayer_requests
where body is not null or (is_anonymous and author_id is not null);
```

## Rotating a key

Rotate one key at a time.

**The body key**

1. Generate a new key and store its two copies.
2. In Production set `PRAYER_BODY_KEY_PREVIOUS` to the old key and
   `PRAYER_BODY_KEY` to the new one, and redeploy. New writes use the new key;
   old rows still open.
3. Run the script: a dry run shows `reencrypt` for every old row, then
   `--apply`, then a dry run showing only `noop` (and `unmatched` only for
   requests an earlier author rotation or a lost author key left), exiting 0.
4. Remove `PRAYER_BODY_KEY_PREVIOUS` and redeploy.
5. Keep the old key for as long as you keep backups taken before step 3; they
   hold text sealed with it.

**The author key**

The same steps with `PRAYER_AUTHOR_KEY` and `PRAYER_AUTHOR_KEY_PREVIOUS`. A
hash carries only its key id, not its author, so the script finds each
anonymous request's author by trying every person in the church under the
previous key, and rehashes under the new one. A request whose author is no
longer in the church reports as `unmatched`; it stays anonymous and nobody's,
and a leader can still delete it. The script reports it as `unmatched` on
every run from then on, and it no longer stops a body-key rotation.

## Losing a key

**The author key.** Nobody is recognised as the author of any anonymous
request: those requests lose "You" and My requests, and their authors can no
longer mark them answered or delete them. The text stays readable and leaders
can still delete them. Account deletion can no longer find them, so they stay
until a leader deletes them or the church's retention period removes them.
Set a new key; new anonymous requests work normally, and the script reports
the old ones as `unmatched` on every run from then on, without failing. A
church that still has requests to convert is refused until it holds a hash
under the new key, that is, until someone posts an anonymous request there.

**The body key.** The text of every request sealed with it is gone; no one can
recover it without a copy of the key. Every group holding such a request shows
the prayer page and Home's prayer section in their failed state until the key
is restored. If it cannot be restored, deleting the requests sealed with the
lost key (their `body_ciphertext` starts with `v1.<its key id>.`) brings those
pages back.

## Deleting a person

No foreign key reaches an anonymous request stored as a hash. Account
deletion (`deletePerson()` in `lib/account/deletion.ts`) reads the church's
hashed anonymous requests, matches the person's with the key, and passes their
ids to `delete_person()`, which deletes them in the same transaction as the
rest. A request the person posts between that read and the commit stays; their
login is gone by then, so it cannot happen twice. A login deleted outside the
app, for example from the Supabase dashboard, leaves that person's hashed
anonymous requests behind, unnamed, until a leader deletes them or retention
removes them.
