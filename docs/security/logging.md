# Logging: what is written, and what never is

Logs must allow a failure to be found and fixed without recording what
people do or enter. Every log line in `app/`, `lib/`, `components/` and
`supabase/functions/` goes through one helper, which decides what is written.

## The line

One JSON object per line, on standard output, for every level:

```json
{"level":"error","what":"Calendar read failed","route":"/g/[groupId]/calendar","code":"PGRST301","ref":"K7M29QXD","ids":{"group":"3f0c9a52-7b1e-4c7d-9a41-0d2f6e8b1c33"}}
```

| Field | What it holds |
|---|---|
| `level` | `error`, `warn` or `info`. |
| `what` | What failed, as a fixed string written at the call site. |
| `route` | The page or API route pattern (`/join/[token]`, never the real address), or an edge function's name. Shared code in `lib/` and `components/` writes none. |
| `step` | Optional. A fixed `lower_snake_case` label for the stage, such as a table name. |
| `code` | The error's code, read as described below. Absent when no error was passed. |
| `ref` | A short random reference, eight characters. For an error nothing caught, the framework's digest instead (see "The reference"). |
| `ids` | Optional. Row ids (UUIDs) and counts. |

To find where a line came from, search the source for its `what`.

## What is read from an error

Exactly one value, the first of these that is present and well formed:

| Field | Written | Why |
|---|---|---|
| `code` | Yes | SQLSTATE, PostgREST, Auth and Node codes are fixed vocabularies. |
| `status` / `statusCode` | Yes, when there is no code | An HTTP status from Auth, Storage or the email service. |
| `name` | Yes, when there is neither | A class label such as `TypeError` or `validation_error`. |
| `message` | Never | Can quote a value: `invalid input syntax for type uuid: "…"`, or an address the email service rejected. |
| `details` | Never | `Key (email)=(…) already exists.`, `Failing row contains (…)`. |
| `hint` | Never | Quotes column names and values. |
| `stack`, `cause`, anything else | Never | A stack's first line is the message. |

An error passed as text is written as the code `string`, and one with none of
the fields above as `unknown`. An empty `code`, which the database client
uses for a request that got no response, is written as `empty`.

Code that turns a database error into a new `Error` or into text logs the
original first, on the line before, because the copy carries no code. Such a
failure is logged twice: once where it happened, with its code, and once
where it was caught, with `Error` or `string`.

## What is never written

Error messages, details and hints. Row values. Names, emails, phone numbers
and addresses. Prayer and announcement text. Request and response bodies.
Tokens, keys and signed links, whole or in part. Real page addresses and
query strings.

The helper checks the shape of what it is given: `route` is dropped unless
it looks like a pattern or a function name, `step` unless it is a label, and
an `ids` value unless it is a UUID or a finite number. That stops an address
with a query, a hash or a scheme, an email in any of the three, and any text
in `ids`.

Shape cannot stop everything, so the call site carries the rest:

- A lowercase name such as `mary_smith` has the shape of a `step`, and
  `/mary-smith` the shape of a `route`. A string of digits such as a phone
  number fits a `route`, and a number fits `ids`. Never pass a value a person
  entered in any of the three.

- A real path such as `/join/<token>` has the shape of a pattern. `route` is
  always a fixed string, never a path read from the request. Lint requires a
  fixed string only when `route` is written inside the call; it does not see
  a `route` on a context object built elsewhere, or one passed to `writeLog`.
- An invite token is a UUID, the same shape as a row id. Never put a token in
  `ids`.
- `stepOf()` turns any text into a label. Pass it only a fixed label or a
  bucket name, never a value a person entered.

A stored photo is logged by its kind and the id of the row it belongs to,
not by its path. A photo left behind after a person is deleted, or refused
because its key names another church, is one line each. The object is in
the `avatars` bucket under `<keyOrg>/<step>/<entity>/`. `step` is the folder
name with its hyphen written as an underscore, so a `family_members` line
means the `family-members` folder. A line with no
`keyOrg` is a key from before org partitioning, under `<step>/<entity>/`, or
`<entity>/` when it has no `step` either.

## The reference

The reference is made on the server, where the failure is logged.

- **A page whose server read failed** shows `Reference: K7M29QXD` under
  "Try again" in the failed state (`components/states/ErrorState.tsx`). Every
  line logged while that page rendered carries the same value.
- **A page that threw** shows the framework's digest as its reference
  (`app/error.tsx`). `onRequestError` in `instrumentation.ts` writes a helper
  line with that digest as its `ref`, the route pattern and the error's code.
  The digest is a hash of the error's message and stack, not a random value:
  the same failure shows the same digest each time, so it names the failure
  and not the one request. On a page that logs a failure and then throws, the
  line holding the real error code was written first, under its own random
  reference that is not shown. Nothing in either line names the other: only
  the time joins the two.
- **A read made in the browser**, and **a failed save answered by an API
  route**, show no reference. The first has no server log line; the second
  logs one with its own reference that is not shown.

## Where lines go

Standard output, through `console.log`. Nothing is sent to a logging service
and nothing depends on one host, so the app logs the same way on a managed
host and in a container. In the browser the same helper writes to the
browser's console, which stays on the person's own device.

## How it is kept

- `lib/log/core.ts` builds the line. `lib/log/index.ts` adds the per-page
  reference. Import from `@/lib/log`.
- Edge functions cannot import from `lib/`, so
  `supabase/functions/_shared/log.ts` is a byte-for-byte copy of
  `lib/log/core.ts`. `lib/log/mirror.test.ts` fails when the two differ. Edit
  `lib/log/core.ts` and copy it over.
- ESLint (`eslint.config.mjs`) forbids direct `console` use in `app/`,
  `lib/`, `components/`, `supabase/functions/`, `instrumentation*.ts` and
  `proxy.ts`, tests excepted, and requires the first argument of `logError`,
  `logWarn` and `logInfo`, and any `route` written in the call, to be a
  fixed string.

## Tracing

Optional, and off unless a host sets `OTEL_EXPORTER_OTLP_ENDPOINT`. Off,
`instrumentation.ts` returns before the tracing code is imported, so a
request records nothing and pays nothing. On, it uses the standard
OpenTelemetry SDK (`instrumentation.node.ts`) and names no vendor.

Every span passes through `lib/tracing/redactSpans.ts` before it is
exported, the framework's own spans included. It keeps an attribute only
when its key is on an allow-list, so a key a new instrumentation adds is
dropped until someone adds it there.

A span holds:

| Kept | Example |
|---|---|
| Its name, with any address cut to its origin and a database path, and a real path replaced by the span's route (or `[path]` when it has none) | `GET /join/[token]`, `fetch GET http://127.0.0.1:54321/rest/v1/profiles` |
| Start, end and duration | |
| Trace, span and parent ids | |
| Status code, without its message | `2` (error) |
| The route pattern, never the real path | `next.route`, `http.route`, `next.page`: `/join/[token]` |
| Method and status | `http.method`, `http.status_code`, and the newer `http.request.method`, `http.response.status_code` |
| The server it called, on a span for an outgoing request only | `server.address`, `server.port`, `net.peer.name`, `net.peer.port` |
| The protocol | `url.scheme`, `network.protocol.version` |
| The database operation | `url.path` on an outgoing request when it is a PostgREST table or function (`/rest/v1/profiles`, `/rest/v1/rpc/<name>`), and from a database driver `db.system`, `db.system.name`, `db.operation`, `db.operation.name`, `db.collection.name` and `db.sql.table` |
| The error's class | `error.type`, and on an exception event `exception.type` only |
| The framework's labels | `next.span_type`, `next.span_category`, `next.segment`, `next.rsc`, `next.bubble`, `next.fetch.*`, `next.clientComponentLoadCount` |

Dropped: the real path and query string (`http.target`, `http.url`,
`url.full`, `url.query`, and any other `url.path`), the client's address
and port, the user agent, request and response bodies and headers, a
database statement, a status message, and an exception's message and
stack. The resource, sent once per
batch, describes the server process: host name, process id and command,
service name and version.

## What this does not cover

- **The framework's own output for an exception nothing caught.** After
  `onRequestError` returns, the framework's production server writes the
  error itself, through its own logger, as `⨯ Error: <message>`, the stack,
  and `{ digest: '<digest>' }`, beside the helper's line for the same
  failure. The digest in both lines is the reference on the error page. The
  only switch for that line is the `quiet` option of a custom server built
  with `next()`, which `next start` and a managed host's runtime don't
  offer. Stopping it otherwise means replacing `console.error` or rewriting
  the error object inside `onRequestError` so the framework prints the
  altered copy, and either depends on the framework's internals rather than
  an interface it documents. So the line stays: code that can fail on
  people's data should catch the failure and log it through the helper, so
  the thrown error's message is fixed text.
- **Request logs kept by the hosts.**
