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
| `ref` | A short random reference, eight characters. |
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

## What is never written

Error messages, details and hints. Row values. Names, emails, phone numbers
and addresses. Prayer and announcement text. Request and response bodies.
Tokens, keys and signed links, whole or in part. Real page addresses and
query strings.

The helper enforces this by shape, not by trust in the call site: `route` is
dropped unless it is a pattern or a function name, `step` unless it is a
label, and an `ids` value unless it is a UUID or a finite number. So an email
or a token passed by mistake is not written.

## The reference

The reference is made on the server, where the failure is logged.

- **A page whose server read failed** shows `Reference: K7M29QXD` under
  "Try again" in the failed state (`components/states/ErrorState.tsx`). Every
  line logged while that page rendered carries the same value.
- **A page that threw** shows the framework's digest as its reference
  (`app/error.tsx`). The framework writes the same digest to the server log
  beside the error.
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
  `logWarn` and `logInfo` to be a fixed string.

## What this does not cover

- **The framework's own output for an exception nothing caught.** It prints
  the error's message and stack beside the digest. Code that can fail on
  people's data should catch the failure and log it through the helper.
- **Request logs kept by the hosts.**
- **Optional tracing** (`instrumentation.ts`, `instrumentation.node.ts`). It
  is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set and names no vendor.
  When on, a span for an incoming request records the real path, including
  an invite token in `/join/<token>`, and its query string. A span for an
  outgoing request records the full address with its query, which for a
  database read holds the filter values, such as an email being looked up.
  Request and response bodies and headers are not recorded. Point it only at
  a collector you run or trust with that.
