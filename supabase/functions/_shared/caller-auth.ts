// Who may call a cron-triggered function. The gateway's JWT check alone can
// let through any valid project JWT or API key, which is not enough for a job
// that deletes data or sends email.

const KEY_VARS = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

/**
 * Every service key in the environment, not only the one resolveServiceKey()
 * picks: the vault's cron key may be a different one, and checking against one
 * could refuse the scheduler on every run.
 */
function serviceKeysFromEnv(): string[] {
  const keys = KEY_VARS.map((name) => Deno.env.get(name) ?? "");
  try {
    const parsed: unknown = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const value of Object.values(parsed)) {
        if (typeof value === "string") keys.push(value);
      }
    }
  } catch {
    // A malformed map adds no keys; the others still apply.
  }
  return keys.filter((key) => key !== "");
}

function sameKey(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

/** True only for an `Authorization: Bearer <key>` naming a service key. */
export function isServiceKeyCaller(req: Request): boolean {
  const match = /^Bearer (.+)$/.exec(req.headers.get("Authorization") ?? "");
  if (!match) return false;
  return serviceKeysFromEnv().some((key) => sameKey(key, match[1]));
}

/**
 * Wraps a cron function's handler so it runs only for a service key caller.
 * Anything else gets a 401 before the handler can read data or send email.
 */
export function serviceKeyCallerOnly(
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Response | Promise<Response> {
  return (req) => {
    if (isServiceKeyCaller(req)) return handler(req);
    console.error("refused request: the bearer token is not a service key");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  };
}
