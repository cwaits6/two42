// Unit tests for the tenancy guard's analyzers. The guard is the only thing
// in CI that reads application source for a missing org_id predicate, so a
// wrong predicate check here is invisible everywhere else: it reports clean
// on an unscoped query. Every analyzer is driven with a passing AND a
// failing fixture so a regression in the guard itself fails, not just a
// regression in the code it guards.

import { describe, expect, it } from "vitest";
import {
  chainFinding,
  chainHasEmbed,
  hasOrgPredicate,
  markerState,
  mentionsOrgIdProperty,
  scanSource,
} from "./check-service-role-org-scope.mjs";
import ts from "typescript";

const APP = "app/api/fixture/route.ts";
const LIB = "lib/fixture.ts";
const EDGE = "supabase/functions/fixture/index.ts";

/** A route-shaped fixture with a service-role binding named `service`. */
function appSource(body) {
  return `import { createServiceClient } from "@/lib/supabase/server";
export async function POST() {
  const service = await createServiceClient();
  ${body}
}
`;
}

/** An exported lib helper taking a SupabaseClient parameter named `supabase`. */
function libSource(body, { exported = true } = {}) {
  return `import type { SupabaseClient } from "@supabase/supabase-js";
${exported ? "export " : ""}async function helper(supabase: SupabaseClient, orgId: string) {
  ${body}
}
`;
}

function chainsOf(rel, text) {
  return scanSource(rel, text).chains;
}

function only(rel, text) {
  const chains = chainsOf(rel, text);
  expect(chains).toHaveLength(1);
  return chains[0];
}

/** Parse a bare expression and hand back its AST node. */
function expressionNode(text) {
  const sf = ts.createSourceFile("x.ts", `const __x = ${text};`, ts.ScriptTarget.Latest, true);
  return sf.statements[0].declarationList.declarations[0].initializer;
}

describe("scanSource — which chains are collected", () => {
  it("collects a chain rooted at a createServiceClient() binding as tier B", () => {
    const c = only(APP, appSource(`await service.from("profiles").select("id").eq("org_id", "o");`));
    expect(c).toMatchObject({ kind: "service", table: "profiles", isRpc: false, line: 4 });
  });

  it("ignores a chain rooted at any other binding in app/", () => {
    const src = `import { createClient } from "@/lib/supabase/server";
export async function GET() {
  const supabase = await createClient();
  await supabase.from("profiles").select("id");
}
`;
    expect(chainsOf(APP, src)).toHaveLength(0);
  });

  it("collects a chain rooted at an exported lib helper's SupabaseClient parameter as tier C", () => {
    const c = only(LIB, libSource(`await supabase.from("site_settings").select("value");`));
    expect(c).toMatchObject({ kind: "tierC", table: "site_settings", fnName: "helper" });
  });

  it("ignores the same chain when the helper is not exported", () => {
    const src = libSource(`await supabase.from("site_settings").select("value");`, { exported: false });
    expect(chainsOf(LIB, src)).toHaveLength(0);
  });

  it("collects .rpc() calls the same way as .from() chains, including a chained .single()", () => {
    const c = only(
      APP,
      appSource(`await service.rpc("serving_signup_apply", { _group_id: "g" }).single<{ id: string }>();`)
    );
    expect(c).toMatchObject({ kind: "service", table: "serving_signup_apply", isRpc: true });
    expect(c.methods.map((m) => m.name)).toEqual(["rpc", "single"]);
  });

  it("collects an .rpc() call rooted at a lib helper's SupabaseClient parameter as tier C", () => {
    const c = only(LIB, libSource(`await supabase.rpc("app_request_org_id");`));
    expect(c).toMatchObject({ kind: "tierC", isRpc: true, table: "app_request_org_id" });
  });

  it("collects every chain under supabase/functions/ regardless of its root", () => {
    const src = `export async function run(client: OrgListClient) {
  await client.from("events").select("id").eq("org_id", "o");
  await client.rpc("email_quota_consume", { _org_id: "o", _n: 1 });
}
`;
    const chains = chainsOf(EDGE, src);
    expect(chains.map((c) => [c.kind, c.table, c.isRpc])).toEqual([
      ["edge", "events", false],
      ["edge", "email_quota_consume", true],
    ]);
  });

  it("does not mistake a constructor's .from() for an edge-function query", () => {
    const src = `const bytes = Uint8Array.from("abc");\nconst buf = Buffer.from("abc");\n`;
    expect(chainsOf(EDGE, src)).toHaveLength(0);
  });

  it("merges the later calls of a let-assigned builder into the chain", () => {
    const c = only(
      EDGE,
      `export async function claim(supabase: Client) {
  let q = supabase.from("org_domains").update({ a: 1 }).eq("id", "x");
  q = q.eq("org_id", "o");
  await q;
}
`
    );
    expect(hasOrgPredicate(c)).toBe(true);
  });
});

describe("hasOrgPredicate", () => {
  const pred = (rel, body) => hasOrgPredicate(only(rel, body));

  it("accepts .eq(\"org_id\", …) anywhere in the chain", () => {
    expect(pred(APP, appSource(`await service.from("t").select("id").eq("org_id", "o").eq("id", "x");`))).toBe(true);
  });

  it("rejects a chain with no org predicate", () => {
    expect(pred(APP, appSource(`await service.from("t").select("id").eq("id", "x");`))).toBe(false);
  });

  it("accepts .in(\"org_id\", …) and .filter(\"org_id\", …)", () => {
    expect(pred(APP, appSource(`await service.from("t").select("id").in("org_id", ["o"]);`))).toBe(true);
    expect(pred(APP, appSource(`await service.from("t").select("id").filter("org_id", "eq", "o");`))).toBe(true);
  });

  it("accepts an insert that stamps org_id, and rejects one that does not", () => {
    expect(pred(APP, appSource(`await service.from("t").insert({ org_id: orgId, a: 1 });`))).toBe(true);
    expect(pred(APP, appSource(`await service.from("t").insert({ a: 1 });`))).toBe(false);
  });

  it("accepts an .rpc() call whose args carry _org_id or org_id", () => {
    expect(pred(APP, appSource(`await service.rpc("f", { _org_id: orgId, _n: 1 });`))).toBe(true);
    expect(pred(APP, appSource(`await service.rpc("f", { org_id: orgId });`))).toBe(true);
  });

  it("rejects an .rpc() call whose args carry no org property, or no args at all", () => {
    expect(pred(APP, appSource(`await service.rpc("f", { bar: 1 });`))).toBe(false);
    expect(pred(APP, appSource(`await service.rpc("f");`))).toBe(false);
  });

  it("does not let the .rpc() name itself stand in for a predicate", () => {
    // The first argument is the function name, not the args object.
    expect(pred(APP, appSource(`await service.rpc("org_id", { bar: 1 });`))).toBe(false);
  });

  it("treats .eq(\"id\", …) as the predicate only on the tenant root", () => {
    expect(pred(APP, appSource(`await service.from("organizations").select("slug").eq("id", orgId);`))).toBe(true);
    expect(pred(APP, appSource(`await service.from("profiles").select("id").eq("id", userId);`))).toBe(false);
  });
});

describe("mentionsOrgIdProperty", () => {
  it("recognises org_id and _org_id as plain or shorthand properties, nested included", () => {
    expect(mentionsOrgIdProperty(expressionNode(`{ org_id: x }`))).toBe(true);
    expect(mentionsOrgIdProperty(expressionNode(`{ _org_id: x }`))).toBe(true);
    expect(mentionsOrgIdProperty(expressionNode(`{ org_id }`))).toBe(true);
    expect(mentionsOrgIdProperty(expressionNode(`[{ a: 1 }, { org_id: x }]`))).toBe(true);
  });

  it("rejects look-alikes and a spread it cannot see through", () => {
    expect(mentionsOrgIdProperty(expressionNode(`{ orgId: x }`))).toBe(false);
    expect(mentionsOrgIdProperty(expressionNode(`{ organisation_id: x }`))).toBe(false);
    // A spread may or may not carry org_id; the analyzer fails toward
    // reporting rather than guessing.
    expect(mentionsOrgIdProperty(expressionNode(`{ ...row }`))).toBe(false);
  });
});

describe("markerState", () => {
  it("returns \"valid\" for a reasoned marker above the statement", () => {
    const c = only(
      APP,
      appSource(`// org-anchor: the token row resolves the org
  const { data } = await service.from("tokens").select("org_id").eq("token", t).maybeSingle();`)
    );
    expect(c.marker).toBe("valid");
  });

  it("returns \"valid\" when the marker is one line of a larger comment block", () => {
    const c = only(
      APP,
      appSource(`// Explanatory prose first.
  // org-anchor: the token row resolves the org
  // More prose after.
  const { data } = await service.from("tokens").select("org_id").eq("token", t).maybeSingle();`)
    );
    expect(c.marker).toBe("valid");
  });

  it("attaches a marker placed on a Promise.all element to that element's chain only", () => {
    const chains = chainsOf(
      APP,
      appSource(`const [a, b] = await Promise.all([
    // org-anchor: profile read unscoped so the pairing check can reject it
    service.from("profiles").select("org_id").eq("id", p).maybeSingle(),
    service.from("settings").select("enabled").eq("id", g).maybeSingle(),
  ]);`)
    );
    expect(chains.map((c) => [c.table, c.marker])).toEqual([
      ["profiles", "valid"],
      ["settings", null],
    ]);
  });

  it("returns \"bare\" for a marker with no reason, and null with no marker", () => {
    expect(only(APP, appSource(`// org-anchor:
  await service.from("t").select("id");`)).marker).toBe("bare");
    expect(only(APP, appSource(`// just a comment
  await service.from("t").select("id");`)).marker).toBe(null);
  });

  it("is exported for direct use on an arbitrary node", () => {
    const sf = ts.createSourceFile("x.ts", `// org-anchor: why\nconst a = 1;`, ts.ScriptTarget.Latest, true);
    expect(markerState(sf, sf.statements[0])).toBe("valid");
  });
});

describe("chainHasEmbed", () => {
  const embed = (select) => chainHasEmbed(only(APP, appSource(`await service.from("t").select(${select});`)));

  it("detects a nested relation, an aliased one, and an FK-hinted one", () => {
    expect(embed(`"id, org_domains(domain, status)"`)).toBe(true);
    expect(embed(`"*, steward:profiles!giving_funds_steward_id_fkey(first_name)"`)).toBe(true);
    expect(embed(`"id, serving_signup_attendees(profiles(id, first_name))"`)).toBe(true);
  });

  it("ignores a flat column list, a star, and a chain with no select", () => {
    expect(embed(`"id, first_name, last_name"`)).toBe(false);
    expect(embed(`"*"`)).toBe(false);
    expect(chainHasEmbed(only(APP, appSource(`await service.from("t").delete().eq("id", x);`)))).toBe(false);
  });
});

describe("chainFinding — tier B (service-role chains)", () => {
  it("passes a scoped chain and fails an unscoped one", () => {
    expect(chainFinding(only(APP, appSource(`await service.from("t").select("id").eq("org_id", o);`)))).toBeNull();
    const f = chainFinding(only(APP, appSource(`await service.from("t").select("id");`)));
    expect(f).toMatchObject({ tier: "B" });
    expect(f.message).toMatch(/service-role chain on "t" has no org_id predicate/);
  });

  it("accepts a reasoned marker and rejects a bare one", () => {
    expect(chainFinding(only(APP, appSource(`// org-anchor: why
  await service.from("t").select("id");`)))).toBeNull();
    const f = chainFinding(only(APP, appSource(`// org-anchor:
  await service.from("t").select("id");`)));
    expect(f).toMatchObject({ tier: "B" });
    expect(f.message).toMatch(/no reason text/);
  });

  it("names the embed when an unscoped chain selects a nested relation", () => {
    const f = chainFinding(only(APP, appSource(`await service.from("t").select("id, org_domains(domain)");`)));
    expect(f.message).toMatch(/nested embed/);
  });

  it("does not fail an embedding chain whose parent is scoped", () => {
    const c = only(APP, appSource(`await service.from("t").select("id, org_domains(domain)").eq("org_id", o);`));
    expect(chainHasEmbed(c)).toBe(true);
    expect(chainFinding(c)).toBeNull();
  });

  it("fails an .rpc() call with no org argument and passes one with _org_id", () => {
    const f = chainFinding(only(APP, appSource(`await service.rpc("provision_organization", { _name: n });`)));
    expect(f).toMatchObject({ tier: "B" });
    expect(f.message).toMatch(/rpc call "provision_organization" has no org_id predicate/);
    expect(chainFinding(only(APP, appSource(`await service.rpc("f", { _org_id: o });`)))).toBeNull();
  });

  it("accepts a reasoned marker on an .rpc() call", () => {
    expect(chainFinding(only(APP, appSource(`// org-anchor: this RPC creates the org
  await service.rpc("provision_organization", { _name: n });`)))).toBeNull();
  });
});

describe("chainFinding — tier C (SupabaseClient-parameter chains)", () => {
  it("fails an unscoped .from() chain even when it carries a marker — no escape hatch", () => {
    const f = chainFinding(only(LIB, libSource(`// org-anchor: pretend
  await supabase.from("t").select("id");`)));
    expect(f).toMatchObject({ tier: "C" });
    expect(f.message).toMatch(/no escape hatch on this tier/);
  });

  it("passes a scoped .from() chain", () => {
    expect(chainFinding(only(LIB, libSource(`await supabase.from("t").select("id").eq("org_id", orgId);`)))).toBeNull();
  });

  it("fails an .rpc() call with no org argument and no marker", () => {
    const f = chainFinding(only(LIB, libSource(`await supabase.rpc("app_request_org_id");`)));
    expect(f).toMatchObject({ tier: "C" });
    expect(f.message).toMatch(/rpc call "app_request_org_id".*has no org argument/);
  });

  it("accepts an .rpc() org resolver that names itself with a marker, or an org argument", () => {
    expect(chainFinding(only(LIB, libSource(`// org-anchor: this RPC IS the org resolver
  await supabase.rpc("app_request_org_id");`)))).toBeNull();
    expect(chainFinding(only(LIB, libSource(`await supabase.rpc("f", { _org_id: orgId });`)))).toBeNull();
  });
});

describe("chainFinding — supabase/functions/ (edge mode)", () => {
  const edgeChain = (body) => only(EDGE, `export async function run(supabase: Client, org: Org) {\n  ${body}\n}\n`);

  it("fails an unscoped chain and names the edge-function origin", () => {
    const f = chainFinding(edgeChain(`await supabase.from("prayer_call_sessions").select("id");`));
    expect(f).toMatchObject({ tier: "edge" });
    expect(f.message).toMatch(/^supabase\/functions\/ chain on "prayer_call_sessions"/);
  });

  it("passes the same chain scoped on the iterated org", () => {
    expect(chainFinding(edgeChain(`await supabase.from("prayer_call_sessions").select("id").eq("org_id", org.id);`))).toBeNull();
  });

  it("passes an insert that stamps org_id and fails one that does not", () => {
    expect(chainFinding(edgeChain(`await supabase.from("serving_broadcasts").insert({ org_id: org.id, a: 1 });`))).toBeNull();
    expect(chainFinding(edgeChain(`await supabase.from("serving_broadcasts").insert({ a: 1 });`))).not.toBeNull();
  });

  it("exempts the tenant root, which has no org_id column", () => {
    expect(
      chainFinding(edgeChain(`await supabase.from("organizations").select("id, org_domains(domain)").eq("status", "active");`))
    ).toBeNull();
  });

  it("does not extend the tenant-root exemption to any other table", () => {
    expect(chainFinding(edgeChain(`await supabase.from("org_domains").select("id").eq("status", "verified");`))).not.toBeNull();
  });

  it("names the embed when an unscoped parent selects a nested relation", () => {
    const f = chainFinding(edgeChain(`await supabase.from("serving_signups").select("id, serving_signup_attendees(profiles(id))");`));
    expect(f.message).toMatch(/nested embed/);
  });

  it("fails an .rpc() call with no org argument and passes one with _org_id", () => {
    const f = chainFinding(edgeChain(`await supabase.rpc("email_quota_consume", { _n: 1 });`));
    expect(f).toMatchObject({ tier: "edge" });
    expect(f.message).toMatch(/rpc call "email_quota_consume"/);
    expect(chainFinding(edgeChain(`await supabase.rpc("email_quota_consume", { _org_id: org.id, _n: 1 });`))).toBeNull();
  });

  it("accepts a reasoned marker", () => {
    expect(chainFinding(edgeChain(`// org-anchor: why
  await supabase.from("t").select("id");`))).toBeNull();
  });
});
