import { execFileSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";

const AUTH_CONTAINER = "supabase_auth_small-group-hub";

/**
 * A service-role key the local Auth container accepts on its admin API. The stack's
 * own SERVICE_ROLE_KEY is HS256, which Auth refuses there (`bad_jwt`) once it signs
 * with GOTRUE_JWT_KEYS, as the pinned CLI's stack does; the database and storage take
 * either. Signed with that stack's own local key, so nothing here works on another
 * stack. Remove this once `supabase status` hands out a key the admin API accepts.
 */
export function localServiceKey(): string {
  const [jwk] = JSON.parse(
    execFileSync("docker", ["exec", AUTH_CONTAINER, "printenv", "GOTRUE_JWT_KEYS"], {
      encoding: "utf8",
    }),
  );
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${part({ alg: "ES256", typ: "JWT", kid: jwk.kid })}.${part({
    role: "service_role",
    iat: now,
    exp: now + 4 * 60 * 60,
  })}`;
  const signature = sign("sha256", Buffer.from(body), {
    key: createPrivateKey({ key: jwk, format: "jwk" }),
    dsaEncoding: "ieee-p1363",
  });
  return `${body}.${signature.toString("base64url")}`;
}
