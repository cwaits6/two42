#!/usr/bin/env node
/**
 * Static tenancy guard for service-role Supabase queries.
 *
 * Service-role clients carry BYPASSRLS, so the .eq("org_id", ...) filters on
 * their query chains ARE the tenant boundary — and nothing else in CI reads
 * application source for them. This script walks the TypeScript AST of every
 * file in app/, lib/ and supabase/functions/ and enforces:
 *
 *   Tier A — the email fan-out chains (feedback admins, serving broadcast,
 *            leader cancel notices) must carry an org_id predicate and may
 *            NOT use the // org-anchor: escape hatch. These surfaces push one
 *            org's data to third parties and email cannot be recalled; the
 *            feedback fan-out bug already reached main once.
 *   Tier B — every other query chain rooted at a createServiceClient()
 *            binding must carry an org_id predicate, unless the chain is a
 *            documented org anchor: marked in-file with a reasoned
 *            `// org-anchor: <why>` comment. There is no allowlist.
 *   Tier C — every exported lib/ function taking a SupabaseClient parameter
 *            must scope the chains rooted at that parameter. Deliberate
 *            over-approximation: a helper that CAN receive a service client
 *            must scope unconditionally, which avoids call-graph analysis.
 *            No escape hatch for .from() chains — the helper can always take
 *            an orgId. An .rpc() call whose contract has no org parameter
 *            (an org RESOLVER such as app_request_org_id()) has nothing to
 *            scope on, so .rpc() chains on this tier accept the marker.
 *   Edge   — every chain in supabase/functions/ (entry points and _shared/).
 *            Those run on the service key by construction, so every chain is
 *            collected regardless of its root and must carry an org_id
 *            predicate or a reasoned marker. The one exemption is the tenant
 *            root: `organizations` has no org_id column and listActiveOrgs()'s
 *            full-tenant enumeration is the deliberate read.
 *
 * Both .from("table") and .rpc("name", args) chains are collected. For an
 * RPC the predicate is an `org_id` / `_org_id` property on its args object.
 * A chain whose .select() string embeds a nested relation gets a message
 * naming the embed when it fails: the embed is only as safe as the parent's
 * own scoping.
 *
 * Plus three non-AST checks (one command, one CI job):
 *   - inventory sync against docs/security/service-role-inventory.md
 *   - pins on the hand-written cross-org assertions
 *   - a repo-wide sweep for the retired hardcoded seed-org UUID
 *
 * Run: npm run guard:tenancy      (see scripts/README.md)
 *
 * The pure analyzers are exported and unit-tested in
 * scripts/check-service-role-org-scope.test.mjs; the scan itself only runs
 * when this file is the entry point.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// fileURLToPath, not new URL(...).pathname: the latter stays percent-encoded,
// so any checkout path containing a space or non-ASCII character would make
// every readFileSync below fail.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The definition site: its `const { createClient } = await import(...)` would
// read as a client binding to any name-based scan. Nothing in it queries.
const SCAN_EXCLUDE = new Set(["lib/supabase/server.ts"]);

// Every .ts file under here is scanned in edge mode. Deno test files are
// fixtures, not query surfaces.
const EDGE_ROOT = "supabase/functions/";
const EDGE_TESTS = "supabase/functions/tests/";

// Tier A: the email fan-out chains. `fn` narrows to a named enclosing
// function when the file has several chains on the same table.
const FANOUTS = [
  { file: "app/api/feedback/route.ts", fn: null, table: "profiles" },
  { file: "app/api/serving/broadcast/route.ts", fn: null, table: "profile_groups" },
  { file: "lib/serving/server.ts", fn: "notifyLeadersOfCancel", table: "profile_groups" },
];

const INVENTORY = "docs/security/service-role-inventory.md";

// The hand-written cross-org assertions. The two signed-link surfaces read
// the profile row unscoped ON PURPOSE so a cross-org pairing can be rejected
// explicitly; the invite-claim and household-link routes compare the
// caller's org to the target row's as defence in depth. Each only stays safe
// while the explicit rejection exists — pin it, and its distinctive denial
// log, to exactly one occurrence.
const PINS = [
  {
    file: "app/api/serving/link-action/route.ts",
    needles: [
      "profile.org_id !== group.org_id",
      "Signed-link cross-org denial: profile org %s does not match group org %s",
    ],
  },
  {
    file: "app/serving/go/page.tsx",
    needles: [
      "profile.org_id !== group.org_id",
      // NB: contains an em-dash — files are read as UTF-8 above.
      "Serving link page: cross-org denial — profile org %s does not match group org %s",
    ],
  },
  {
    file: "app/api/family-invites/claim/route.ts",
    needles: [
      "callerProfile.org_id !== invite.org_id",
      "family-invites/claim: caller org %s does not match invite org %s (user=%s, invite=%s)",
    ],
  },
  {
    file: "app/api/household/link-member/route.ts",
    needles: [
      "target.org_id !== currentProfile.org_id",
      "household/link-member: caller org %s does not match target org %s (user=%s, target=%s)",
    ],
  },
];

// Built by concatenation so this file never matches its own sweep.
const SEEDED_ORG_UUID = ["00000000", "0000", "0000", "0000", "000000000001"].join("-");

// Named, commented exclusions for the seeded-UUID sweep. The default is
// in-scope: a new root-level file is swept unless someone writes down here
// why it is not. (This inversion IS the fix for the earlier gap, where a
// hardcoded `app/ lib/ docs/` walk let a root README.md finding through.)
const UUID_SWEEP_EXCLUDE = [
  "supabase/migrations/", // backfill DDL legitimately names the seeded org
  "supabase/seed.sql", // seeds that org by definition
  "supabase/schema.sql", // generated dump of the above
  "CHANGELOG.md", // generated by semantic-release
  "package-lock.json", // generated
  "node_modules/", // not tracked, listed for completeness
  // pgTAP suites run against the migrations-built database, where the seeded
  // org exists by definition — exercising it by its UUID is their job:
  "supabase/tests/branding_rls_suite.sql", // updates the seeded org's own row by PK
  "supabase/tests/tenancy_leak_suite.sql", // asserts the seeded org still carries the default slug
  "supabase/tests/platform_org_lifecycle_suite.sql", // asserts app_request_org_id() resolves the header org to it, and inserts access_requests into it
];

function gitLsFiles(...pathspecs) {
  return execFileSync("git", ["ls-files", "--", ...pathspecs], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

// ── AST helpers ─────────────────────────────────────────────────────────────

export function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** Peel wrappers that can sit between chain links. */
export function unwrap(node) {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAwaitExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node))
  ) {
    node = node.expression;
  }
  return node;
}

/** Walk leftward from any chain expression to its root Identifier (or null). */
export function chainRoot(expr) {
  let node = unwrap(expr);
  while (node) {
    if (ts.isIdentifier(node)) return node;
    if (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) {
      node = unwrap(node.expression);
      continue;
    }
    return null;
  }
  return null;
}

/** The outermost CallExpression this call participates in as a chain. */
export function outermostChainCall(callExpr) {
  let node = callExpr;
  for (;;) {
    const parent = node.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      const grand = parent.parent;
      if (grand && ts.isCallExpression(grand) && grand.expression === parent) {
        node = grand;
        continue;
      }
    }
    return node;
  }
}

/** Collect [{name, args}] from root to tip of a call chain expression. */
export function collectMethods(expr) {
  const methods = [];
  let node = unwrap(expr);
  while (node && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    methods.unshift({ name: node.expression.name.text, args: node.arguments });
    node = unwrap(node.expression.expression);
  }
  return methods;
}

/**
 * Does any expression subtree assign a property literally named org_id — or
 * _org_id, the argument convention of this repo's SQL functions? Only plain
 * and shorthand property assignments count: a spread or a computed key is
 * not recognised, which fails toward reporting, never toward silence.
 */
export function mentionsOrgIdProperty(node) {
  let found = false;
  function visit(n) {
    if (found) return;
    if (
      (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
      ts.isIdentifier(n.name) &&
      (n.name.text === "org_id" || n.name.text === "_org_id")
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}

export function firstArgIsString(m, text) {
  return m.args.length > 0 && ts.isStringLiteral(m.args[0]) && m.args[0].text === text;
}

/**
 * True when the chain carries an org predicate. Scan the WHOLE method list —
 * .eq("org_id", ...) is mid-chain on several real chains, never assume tail.
 * For an .rpc() call the predicate is an org_id / _org_id property on the
 * args object (its second positional argument).
 */
export function hasOrgPredicate(chain) {
  for (const m of chain.methods) {
    if (["eq", "in", "filter"].includes(m.name) && firstArgIsString(m, "org_id")) return true;
    if (m.name === "match" && m.args.length > 0 && mentionsOrgIdProperty(m.args[0])) return true;
    if (
      ["insert", "upsert"].includes(m.name) &&
      m.args.length > 0 &&
      mentionsOrgIdProperty(m.args[0])
    ) {
      return true;
    }
    if (m.name === "rpc" && m.args.length > 1 && mentionsOrgIdProperty(m.args[1])) return true;
    // On the tenant root, id IS the org id (lib/email/identity.ts). Any other
    // table's .eq("id", ...) proves nothing about the tenant.
    if (chain.table === "organizations" && m.name === "eq" && firstArgIsString(m, "id")) {
      return true;
    }
  }
  return false;
}

// PostgREST embed syntax inside a .select() string: `relation(cols)`, with an
// optional `alias:` prefix and `!fk_hint`. A heuristic, not a parser — a
// false positive only changes the wording of a finding the chain already
// earned, never whether it fails.
const EMBED = /(?:^|[,\s(])(?:\w+:)?\w+(?:!\w+)?\(/;

/** Does the chain's .select() string embed a nested relation? */
export function chainHasEmbed(chain) {
  for (const m of chain.methods) {
    if (m.name !== "select" || m.args.length === 0) continue;
    const arg = m.args[0];
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
      if (EMBED.test(arg.text)) return true;
    }
  }
  return false;
}

/**
 * org-anchor marker attached to the chain: a `// org-anchor: <reason>` line
 * in the leading comments of the chain expression or any enclosing node up
 * to (and including) its statement. Returns "valid", "bare", or null.
 */
export function markerState(sourceFile, chainTop) {
  const text = sourceFile.getFullText();
  const seen = new Set();
  let node = chainTop;
  while (node && !ts.isSourceFile(node)) {
    const pos = node.getFullStart();
    if (!seen.has(pos)) {
      seen.add(pos);
      for (const range of ts.getLeadingCommentRanges(text, pos) ?? []) {
        if (range.kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
        const comment = text.slice(range.pos, range.end);
        const m = comment.match(/^\/\/\s*org-anchor:(.*)$/);
        if (m) return m[1].trim() !== "" ? "valid" : "bare";
      }
    }
    if (ts.isStatement(node)) break;
    node = node.parent;
  }
  return null;
}

/** Exported lib/ function declarations with SupabaseClient-typed params. */
export function tierCParamsOf(node) {
  if (!ts.isFunctionDeclaration(node) && !ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
    return null;
  }
  const params = new Set();
  for (const p of node.parameters) {
    if (
      p.type &&
      ts.isTypeReferenceNode(p.type) &&
      ts.isIdentifier(p.type.typeName) &&
      p.type.typeName.text === "SupabaseClient" &&
      ts.isIdentifier(p.name)
    ) {
      params.add(p.name.text);
    }
  }
  return params.size > 0 ? params : null;
}

export function isExported(node) {
  if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
    return true;
  }
  // export const fn = (...) => {...}
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const decl = node.parent;
    if (decl && ts.isVariableDeclaration(decl)) {
      const stmt = decl.parent?.parent;
      if (
        stmt &&
        ts.isVariableStatement(stmt) &&
        ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function enclosingFunction(node) {
  let cur = node;
  while (cur && !ts.isSourceFile(cur)) {
    if (ts.isFunctionDeclaration(cur) || ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

export function functionName(fnNode) {
  if (ts.isFunctionDeclaration(fnNode) && fnNode.name) return fnNode.name.text;
  const decl = fnNode.parent;
  if (decl && ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) return decl.name.text;
  return null;
}

/** A `.from("table")` or `.rpc("name", ...)` call: the head of a query chain. */
function queryHead(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const name = node.expression.name.text;
  if (name === "from" && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
    return { table: node.arguments[0].text, isRpc: false };
  }
  if (name === "rpc" && node.arguments.length >= 1 && ts.isStringLiteral(node.arguments[0])) {
    return { table: node.arguments[0].text, isRpc: true };
  }
  return null;
}

export function isEdgeFile(rel) {
  return rel.startsWith(EDGE_ROOT);
}

// ── Pass over one file: taint bindings, then collect chains ─────────────────

/**
 * Scan one file's source text. `rel` decides the mode: under
 * supabase/functions/ every chain is collected as kind "edge"; elsewhere a
 * chain is kept only when rooted at a createServiceClient() binding ("service")
 * or, in lib/, at a SupabaseClient parameter of an exported function ("tierC").
 * Filesystem-free so the analyzers can be driven by fixture strings.
 */
export function scanSource(rel, text) {
  // Kind must follow the extension. Parsing a .ts file as TSX silently
  // reinterprets angle-bracket type assertions and generic arrows as JSX,
  // which can drop the .from() chains that follow them from the scan — a
  // guard that skips a file reports clean on an unscoped query.
  const scriptKind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind);
  const edge = isEdgeFile(rel);

  // Pass 1: identifiers bound as `const X = await createServiceClient()`.
  // Never name-match `supabase` globally — six files bind an AUTHENTICATED
  // client to that exact name.
  const serviceBindings = new Set();
  (function taint(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const init = unwrap(node.initializer);
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === "createServiceClient"
      ) {
        serviceBindings.add(node.name.text);
      }
    }
    ts.forEachChild(node, taint);
  })(sourceFile);

  const usesServiceClient = !edge && /createServiceClient\s*\(/.test(text);
  const chains = [];

  // Pass 2: every `.from("<table>")` / `.rpc("<name>", ...)` call, rooted
  // leftward to decide whose chain it is. Rooting at the head handles all
  // four syntactic positions uniformly (await'd, bare Promise.all element,
  // let-assigned, closure).
  (function collect(node) {
    const head = queryHead(node);
    if (head) {
      const root = chainRoot(node.expression.expression);
      if (root) {
        let kind = null;
        let fnName = null;
        if (edge) {
          // Every edge-function client is the service key. A capitalised
          // root is a constructor (Array.from, Buffer.from), not a client.
          if (!/^[A-Z]/.test(root.text)) kind = "edge";
        } else if (serviceBindings.has(root.text)) {
          kind = "service";
        } else if (rel.startsWith("lib/")) {
          const fn = enclosingFunction(node);
          if (fn && isExported(fn)) {
            const params = tierCParamsOf(fn);
            if (params && params.has(root.text)) {
              kind = "tierC";
              fnName = functionName(fn);
            }
          }
        }
        if (kind) {
          const top = outermostChainCall(node);
          const chain = {
            file: rel,
            line: lineOf(sourceFile, node),
            table: head.table,
            isRpc: head.isRpc,
            kind,
            fnName: fnName ?? functionName(enclosingFunction(node) ?? sourceFile) ?? null,
            methods: collectMethods(top),
            marker: markerState(sourceFile, top),
          };
          // Reassigned-builder case (`let query = svc.from(...)` then
          // `query = query.eq(...)`): union the binding's later chained
          // calls into the method list.
          const decl = top.parent && ts.isAwaitExpression(top.parent) ? top.parent.parent : top.parent;
          if (
            decl &&
            ts.isVariableDeclaration(decl) &&
            ts.isIdentifier(decl.name) &&
            (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Let) !== 0
          ) {
            const binding = decl.name.text;
            (function mergeAssignments(n) {
              if (
                ts.isBinaryExpression(n) &&
                n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isIdentifier(n.left) &&
                n.left.text === binding
              ) {
                const rhsRoot = chainRoot(n.right);
                if (rhsRoot && rhsRoot.text === binding) {
                  chain.methods.push(...collectMethods(n.right));
                }
              }
              ts.forEachChild(n, mergeAssignments);
            })(sourceFile);
          }
          chains.push(chain);
        }
      }
    }
    ts.forEachChild(node, collect);
  })(sourceFile);

  return { chains, usesServiceClient, text };
}

function scanFile(rel) {
  return scanSource(rel, fs.readFileSync(path.join(repoRoot, rel), "utf8"));
}

// ── Judging one chain (Tier B, Tier C, edge) ────────────────────────────────

function tierOf(chain) {
  if (chain.kind === "tierC") return "C";
  if (chain.kind === "edge") return "edge";
  return "B";
}

function describe(chain) {
  return chain.isRpc ? `rpc call "${chain.table}"` : `chain on "${chain.table}"`;
}

/**
 * The finding for a non-fan-out chain, or null when it passes. Pure: the
 * fixture tests drive this directly. Tier A chains are judged in main, where
 * a marker is itself a violation.
 */
export function chainFinding(chain) {
  if (hasOrgPredicate(chain)) return null;
  const tier = tierOf(chain);
  const what = describe(chain);

  if (chain.kind === "tierC" && !chain.isRpc) {
    return {
      tier,
      message:
        `${what} rooted at a SupabaseClient parameter${chain.fnName ? ` of ${chain.fnName}()` : ""} has no ` +
        `org_id predicate. lib/ helpers can receive a service-role client, so they must scope ` +
        `unconditionally — no escape hatch on this tier.`,
    };
  }

  // The tenant root has no org_id column; listActiveOrgs()'s enumeration of
  // it is the deliberate full-tenant read the edge functions iterate.
  if (chain.kind === "edge" && !chain.isRpc && chain.table === "organizations") return null;

  if (chain.marker === "valid") return null;
  if (chain.marker === "bare") {
    return {
      tier,
      message:
        `// org-anchor: marker has no reason text. Every exception must be named — ` +
        `write why this ${chain.isRpc ? "call" : "chain"} is the org anchor.`,
    };
  }

  if (chainHasEmbed(chain)) {
    return {
      tier,
      message:
        `${what} selects a nested embed via .select() with no org_id predicate on the parent — ` +
        `an embed is only as safe as its parent's own scoping. Add .eq("org_id", <validated anchor>) ` +
        `to this chain, or a \`// org-anchor: <reason>\` marker if this chain is itself the org anchor.`,
    };
  }

  const remedy = chain.isRpc
    ? `Pass the org as an org_id / _org_id argument`
    : `Add .eq("org_id", <validated anchor>)`;
  if (chain.kind === "edge") {
    return {
      tier,
      message:
        `supabase/functions/ ${what} has no org_id predicate. The edge functions run on the service key ` +
        `with no RLS backstop. ${remedy} (bound from the listActiveOrgs()/forEachOrg() iteration), ` +
        `or, if this ${chain.isRpc ? "call" : "chain"} IS the org anchor, a \`// org-anchor: <reason>\` comment above it.`,
    };
  }
  if (chain.kind === "tierC") {
    return {
      tier,
      message:
        `${what} rooted at a SupabaseClient parameter${chain.fnName ? ` of ${chain.fnName}()` : ""} has no ` +
        `org argument. Pass org_id / _org_id, or — only if the function resolves the org itself — ` +
        `a \`// org-anchor: <reason>\` comment above it.`,
    };
  }
  return {
    tier,
    message:
      `service-role ${what} has no org_id predicate. ${remedy} — ` +
      `or, if this ${chain.isRpc ? "call" : "chain"} IS the org anchor, a \`// org-anchor: <reason>\` comment above it and a row ` +
      `in ${INVENTORY}.`,
  };
}

// ── Main scan ───────────────────────────────────────────────────────────────

function main() {
  const findings = [];
  function fail(file, line, table, tier, message) {
    findings.push({ file, line, table, tier, message });
  }

  const scanTargets = gitLsFiles("app", "lib").filter(
    (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts") && !SCAN_EXCLUDE.has(f)
  );
  const edgeTargets = gitLsFiles(EDGE_ROOT).filter(
    (f) => f.endsWith(".ts") && !f.startsWith(EDGE_TESTS) && !f.endsWith("_test.ts")
  );

  const allChains = [];
  const serviceClientFiles = [];
  const fileTexts = new Map();
  for (const rel of [...scanTargets, ...edgeTargets]) {
    const { chains, usesServiceClient, text } = scanFile(rel);
    allChains.push(...chains);
    fileTexts.set(rel, text);
    if (usesServiceClient) serviceClientFiles.push(rel);
  }

  // Tier A first: on these chains a marker is itself a violation, so they must
  // not be excused (or double-reported) by the pass below.
  const tierAChains = new Set();
  for (const spec of FANOUTS) {
    const matches = allChains.filter(
      (c) =>
        c.file === spec.file &&
        c.table === spec.table &&
        !c.isRpc &&
        (spec.fn === null || c.fnName === spec.fn)
    );
    if (matches.length === 0) {
      fail(
        spec.file,
        0,
        spec.table,
        "A",
        `expected email fan-out chain on "${spec.table}"${spec.fn ? ` in ${spec.fn}()` : ""} not found — ` +
          `if it moved or was renamed, update FANOUTS in this script in the same PR`
      );
      continue;
    }
    for (const c of matches) {
      tierAChains.add(c);
      if (!hasOrgPredicate(c)) {
        fail(
          c.file,
          c.line,
          c.table,
          "A",
          `email fan-out chain on "${c.table}" has no org_id predicate. This surface pushes one ` +
            `org's data to third parties and email cannot be recalled — the fan-out tier has no escape hatch.`
        );
      }
      if (c.marker !== null) {
        fail(
          c.file,
          c.line,
          c.table,
          "A",
          `// org-anchor: marker on an email fan-out chain — the fan-out tier has no escape hatch. ` +
            `Remove the marker and scope the chain on org_id.`
        );
      }
    }
  }

  // Tier B (service chains), Tier C (SupabaseClient-param chains in lib/) and
  // every edge-function chain.
  for (const c of allChains) {
    if (tierAChains.has(c)) continue;
    const finding = chainFinding(c);
    if (finding) fail(c.file, c.line, c.table, finding.tier, finding.message);
  }

  // ── Inventory sync ──────────────────────────────────────────────────────

  const inventoryText = fs.readFileSync(path.join(repoRoot, INVENTORY), "utf8");

  function sectionRows(heading) {
    const start = inventoryText.indexOf(`## ${heading}`);
    if (start === -1) return null;
    const rest = inventoryText.slice(start);
    const end = rest.indexOf("\n## ", 1);
    const body = end === -1 ? rest : rest.slice(0, end);
    const rows = [];
    for (const line of body.split("\n")) {
      const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
      if (m && !m[1].startsWith("File")) rows.push(m[1]);
    }
    const countMatch = body.match(/^## .*\((\d+) sites?\)/);
    return { rows, headingCount: countMatch ? Number(countMatch[1]) : null };
  }

  const appSection = sectionRows("App routes and pages");
  const libSection = sectionRows("Lib helpers");
  if (!appSection || !libSection) {
    fail(INVENTORY, 0, "-", "inventory", "expected sections 'App routes and pages' and 'Lib helpers' not found");
  } else {
    const documented = new Set([...appSection.rows, ...libSection.rows]);
    const actualApp = serviceClientFiles.filter((f) => f.startsWith("app/"));
    const actualLib = serviceClientFiles.filter((f) => f.startsWith("lib/"));
    for (const f of serviceClientFiles) {
      if (!documented.has(f)) {
        fail(
          f,
          0,
          "-",
          "inventory",
          `calls createServiceClient() but has no row in ${INVENTORY} — add one in the same PR, ` +
            `with the justification and the tenancy risk (the doc's own rule).`
        );
      }
    }
    for (const f of documented) {
      if (!serviceClientFiles.includes(f)) {
        fail(
          INVENTORY,
          0,
          "-",
          "inventory",
          `inventory row \`${f}\` names a file with no createServiceClient() call — remove or update the row.`
        );
      }
    }
    if (appSection.headingCount !== actualApp.length) {
      fail(
        INVENTORY,
        0,
        "-",
        "inventory",
        `heading says 'App routes and pages (${appSection.headingCount} sites)' but ${actualApp.length} app files call createServiceClient()`
      );
    }
    if (libSection.headingCount !== actualLib.length) {
      fail(
        INVENTORY,
        0,
        "-",
        "inventory",
        `heading says 'Lib helpers (${libSection.headingCount} site${libSection.headingCount === 1 ? "" : "s"})' but ${actualLib.length} lib files call createServiceClient()`
      );
    }
  }

  // ── Pin the hand-written cross-org assertions ───────────────────────────

  for (const pin of PINS) {
    const text = fileTexts.get(pin.file);
    if (text === undefined) {
      fail(pin.file, 0, "-", "pin", "pinned file missing from scan set — update PINS if it moved");
      continue;
    }
    for (const needle of pin.needles) {
      const count = text.split(needle).length - 1;
      if (count !== 1) {
        fail(
          pin.file,
          0,
          "-",
          "pin",
          `expected the cross-org guard ${JSON.stringify(needle)} exactly once, found ${count}. ` +
            `The unscoped or cross-org read on this surface is only safe while this explicit rejection exists.`
        );
      }
    }
  }

  // ── Repo-wide sweep for the retired seed-org constant ───────────────────

  const sweepFiles = gitLsFiles().filter(
    (f) => !UUID_SWEEP_EXCLUDE.some((ex) => (ex.endsWith("/") ? f.startsWith(ex) : f === ex))
  );
  let sweepHits = 0;
  for (const f of sweepFiles) {
    const text = fs.readFileSync(path.join(repoRoot, f), "utf8");
    if (text.includes(SEEDED_ORG_UUID)) {
      sweepHits += 1;
      fail(
        f,
        0,
        "-",
        "sweep",
        `hardcodes the seeded default-org UUID. Derive the org from a validated anchor instead; ` +
          `if this file legitimately needs the constant, add it to UUID_SWEEP_EXCLUDE with a reason.`
      );
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────

  const serviceChainCount = allChains.filter((c) => c.kind === "service").length;
  const tierCChainCount = allChains.filter((c) => c.kind === "tierC").length;
  const edgeChainCount = allChains.filter((c) => c.kind === "edge").length;
  const rpcCount = allChains.filter((c) => c.isRpc).length;

  if (findings.length > 0) {
    console.error(`tenancy guard: ${findings.length} violation(s)\n`);
    const byFile = new Map();
    for (const f of findings) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file).push(f);
    }
    for (const [file, list] of byFile) {
      console.error(file);
      for (const f of list) {
        const loc = f.line ? `:${f.line}` : "";
        console.error(`  [tier ${f.tier}]${loc} (${f.table}) ${f.message}`);
      }
      console.error("");
    }
    process.exit(1);
  }

  console.log(
    `tenancy guard OK — ` +
      `${scanTargets.length} app/lib files + ${edgeTargets.length} supabase/functions files scanned; ` +
      `${serviceChainCount} service-role chains (tier A/B) + ${tierCChainCount} SupabaseClient-param chains (tier C) + ` +
      `${edgeChainCount} edge-function chains checked (${rpcCount} of them .rpc() calls); ` +
      `${FANOUTS.length} fan-outs pinned; ` +
      `inventory in sync (${serviceClientFiles.length} call sites); ` +
      `${PINS.length} cross-org assertion pins verified; ` +
      `${sweepFiles.length} files swept for the seeded-org UUID (${sweepHits} hits)`
  );
}

// Only the CLI entry point runs the scan; importing this module (the unit
// tests do) must be side-effect free and must never call process.exit.
const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
