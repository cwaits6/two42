// Hardened service-key resolution, moved verbatim from the two reminder
// functions (commit 834d76b). Do not simplify or reorder the precedence.

// Service key resolution. The platform reserves the SUPABASE_ prefix for
// its own injected vars, so SUPABASE_SECRET_KEY can never be set manually
// via `supabase secrets set`: on hosted projects with new-style API keys it
// arrives as the JSON map SUPABASE_SECRET_KEYS (keyed by key name, "default"
// unless renamed); legacy projects and the local CLI stack inject
// SUPABASE_SERVICE_ROLE_KEY instead.
export function resolveServiceKey(): string {
  const direct = Deno.env.get("SUPABASE_SECRET_KEY");
  if (direct) return direct;
  const map = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (map) {
    try {
      const parsed: unknown = JSON.parse(map);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = parsed as Record<string, unknown>;
        const key = keys["default"] ?? Object.values(keys)[0];
        if (typeof key === "string" && key) return key;
      }
      console.error("SUPABASE_SECRET_KEYS has no usable key; falling back");
    } catch {
      console.error("SUPABASE_SECRET_KEYS is not valid JSON; falling back");
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (typeof legacy === "string" && legacy) return legacy;
  throw new Error(
    "No service key found: expected SUPABASE_SECRET_KEY, SUPABASE_SECRET_KEYS, or SUPABASE_SERVICE_ROLE_KEY"
  );
}
