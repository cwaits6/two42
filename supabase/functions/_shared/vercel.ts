// The Vercel project-domains client used by the attachment worker.
//
// Split in two so the classification logic is a pure unit: the classify*
// functions map a (status, body) pair to a discriminated result and are
// tested directly; createVercelClient() does the fetch() calls and funnels
// every response through them. The worker's orchestration
// (_shared/domain-attach.ts) depends only on the VercelClient interface, so
// it is unit-tested against a hand-written fake and never touches the network.
//
// Endpoint semantics, from Vercel's REST reference (docs/security/domains.md
// carries the citations):
//   POST   /v10/projects/{id}/domains          add — 200 on success; a plain
//          400 when the domain "already exists on the project" (idempotent
//          success once a GET confirms it); 409 when the name is assigned to
//          another project/account; 403 when the token lacks access or the
//          domain belongs to someone else; 402 when the team has no payment
//          method. The three last are permanent: nothing a retry can fix.
//   GET    /v9/projects/{id}/domains/{domain}  confirm — 200 with
//          `verified: boolean`; 404 when not on the project.
//   DELETE /v9/projects/{id}/domains/{domain}  detach — 200 on success; 404
//          is idempotent success (already gone); 409 (project being
//          transferred) is transient.
//
// The token does not exist yet, so none of these shapes has been confirmed
// against the live API. Every unrecognised status degrades to "ambiguous"
// (the worker GET-reconciles before doing anything else) rather than to a
// confident classification — a wrong "added" would stamp attached_at for a
// host Vercel does not route, and orgBaseUrl() would start emailing it.

export type VercelPermanentReason =
  | "conflict"
  | "forbidden"
  | "payment_required"
  | "ownership_challenge";

export type VercelAddResult =
  | { kind: "added" }
  | { kind: "already_exists" }
  | { kind: "permanent"; reason: VercelPermanentReason; status: number; detail: string }
  | { kind: "ambiguous"; status: number; detail: string };

export type VercelGetResult =
  | { kind: "attached" }
  | { kind: "not_attached" }
  // On the project, but Vercel is holding it behind its own ownership TXT
  // challenge (another Vercel account already has the name). Not routed —
  // never stamp from this state.
  | { kind: "pending_verification" }
  | { kind: "error"; status: number; detail: string };

export type VercelRemoveResult =
  | { kind: "removed" }
  | { kind: "not_found" }
  | { kind: "error"; status: number; detail: string };

export interface VercelClient {
  addDomain(domain: string): Promise<VercelAddResult>;
  getDomain(domain: string): Promise<VercelGetResult>;
  removeDomain(domain: string): Promise<VercelRemoveResult>;
}

// Vercel wraps errors as { error: { code, message } }; both fields are
// optional here because the shapes are unconfirmed (see the header).
interface VercelErrorBody {
  error?: { code?: unknown; message?: unknown };
}

function errorDetail(body: unknown): { code: string; message: string } {
  const err = (body as VercelErrorBody | null)?.error;
  return {
    code: typeof err?.code === "string" ? err.code : "",
    message: typeof err?.message === "string" ? err.message : "",
  };
}

function describe(status: number, body: unknown): string {
  const { code, message } = errorDetail(body);
  const parts = [`status ${status}`];
  if (code) parts.push(code);
  if (message) parts.push(message);
  return parts.join(": ");
}

/** True when a 200 add/get body says Vercel still wants its own ownership challenge. */
function isUnverified(body: unknown): boolean {
  return (
    typeof body === "object" && body !== null &&
    (body as { verified?: unknown }).verified === false
  );
}

/**
 * Narrow match for the one 400 that is idempotent success. 400 is heavily
 * overloaded on this endpoint (invalid domain, conflicting redirect
 * options, ...) and none of the others may be read as "attached".
 */
function isAlreadyExists(body: unknown): boolean {
  const { code, message } = errorDetail(body);
  if (/already[_ ]exists/i.test(code)) return true;
  return /already exists/i.test(message);
}

export function classifyAddResponse(status: number, body: unknown): VercelAddResult {
  if (status === 200 || status === 201) {
    // A 200 with verified:false means the name is on the project but held
    // behind Vercel's cross-account ownership challenge — the same situation
    // a 409 describes, reported differently. Permanent for this worker.
    if (isUnverified(body)) {
      return {
        kind: "permanent",
        reason: "ownership_challenge",
        status,
        detail: "vercel requires its own domain-ownership verification (name registered to another account)",
      };
    }
    return { kind: "added" };
  }
  if (status === 400 && isAlreadyExists(body)) return { kind: "already_exists" };
  if (status === 409) return { kind: "permanent", reason: "conflict", status, detail: describe(status, body) };
  if (status === 403) return { kind: "permanent", reason: "forbidden", status, detail: describe(status, body) };
  if (status === 402) return { kind: "permanent", reason: "payment_required", status, detail: describe(status, body) };
  return { kind: "ambiguous", status, detail: describe(status, body) };
}

export function classifyGetResponse(status: number, body: unknown): VercelGetResult {
  if (status === 200) {
    return isUnverified(body) ? { kind: "pending_verification" } : { kind: "attached" };
  }
  if (status === 404) return { kind: "not_attached" };
  return { kind: "error", status, detail: describe(status, body) };
}

export function classifyRemoveResponse(status: number, body: unknown): VercelRemoveResult {
  if (status === 200 || status === 204) return { kind: "removed" };
  if (status === 404) return { kind: "not_found" };
  return { kind: "error", status, detail: describe(status, body) };
}

export interface VercelClientOptions {
  token: string;
  projectId: string;
  teamId?: string;
  /** Per-request timeout. A timed-out add is reported as ambiguous, never retried blind. */
  timeoutMs?: number;
  baseUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function createVercelClient(opts: VercelClientOptions): VercelClient {
  const base = (opts.baseUrl ?? "https://api.vercel.com").replace(/\/$/, "");
  const project = encodeURIComponent(opts.projectId);
  const team = opts.teamId ? `?teamId=${encodeURIComponent(opts.teamId)}` : "";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(
    method: "POST" | "GET" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${base}${path}${team}`, {
      method,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: res.status, body: parsed };
  }

  function domainPath(domain: string): string {
    return `/v9/projects/${project}/domains/${encodeURIComponent(domain)}`;
  }

  return {
    async addDomain(domain) {
      try {
        const { status, body } = await call("POST", `/v10/projects/${project}/domains`, { name: domain });
        return classifyAddResponse(status, body);
      } catch (err) {
        // Timeout or network failure: the request may or may not have
        // landed. Ambiguous by definition — the worker reconciles via GET.
        return { kind: "ambiguous", status: 0, detail: err instanceof Error ? err.message : String(err) };
      }
    },
    async getDomain(domain) {
      try {
        const { status, body } = await call("GET", domainPath(domain));
        return classifyGetResponse(status, body);
      } catch (err) {
        return { kind: "error", status: 0, detail: err instanceof Error ? err.message : String(err) };
      }
    },
    async removeDomain(domain) {
      try {
        const { status, body } = await call("DELETE", domainPath(domain));
        return classifyRemoveResponse(status, body);
      } catch (err) {
        return { kind: "error", status: 0, detail: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
