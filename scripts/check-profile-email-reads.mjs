#!/usr/bin/env node
/**
 * Static guard: no request-client read of profiles.email.
 *
 * Client roles are losing SELECT on profiles.email, and PostgREST answers
 * 42501 for the whole request when any part of it touches a column the role
 * cannot read. That includes `select("*")`, a bare `.select()` after a write,
 * a filter or ordering on the column, and an embedded `profiles(...)` on
 * another table. This script walks the TypeScript AST of every tracked file
 * in app/, components/ and lib/ and fails on each of those shapes when the
 * chain runs on the request client.
 *
 * A chain is on the service client, and skipped, when its root is bound from
 * createServiceClient() in the same file, or is a function parameter that
 * every call site in the scanned files fills with such a binding. Those
 * chains carry an explicit org_id, which check-service-role-org-scope.mjs
 * enforces. Every other root is treated as the request client.
 *
 * A select argument must resolve to text: a string literal, a template whose
 * substitutions are constants, or a constant, declared in the same file or
 * exported from a directly imported one. Anything else fails closed.
 *
 * Known limit: an embed written through a foreign key column instead of the
 * table name (`author:created_by(*)`) is not recognised as a profiles embed.
 *
 * There is no marker and no allowlist. The address has three read paths:
 * get_own_email(), admin_member_emails() and profiles_directory.
 *
 * Run: npm run guard:tenancy      (see scripts/README.md)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  chainRoot,
  collectMethods,
  enclosingFunction,
  functionName,
  lineOf,
  outermostChainCall,
  unwrap,
} from "./check-service-role-org-scope.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_ROOTS = ["app", "components", "lib"];
const SCAN_EXCLUDE = new Set(["lib/supabase/database.types.ts"]);

const WRITES = new Set(["insert", "update", "upsert", "delete"]);

// ── PostgREST select strings ────────────────────────────────────────────────

/** Split on commas that sit outside every pair of parentheses. */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * One select item as `{ column }` or `{ relation, inner }`. An item is
 * `[alias:]name[::cast]`, `[alias:]name->path`, or
 * `[alias:]relation[!hint][!inner](items)`.
 */
export function parseSelectItem(item) {
  const open = item.indexOf("(");
  const head = (open === -1 ? item : item.slice(0, open)).trim();
  // A cast is `::`, so only a single colon separates an alias.
  const alias = head.match(/^[\w$]+\s*:(?!:)\s*/);
  const named = alias ? head.slice(alias[0].length) : head;
  if (open === -1) {
    return { column: named.split(/::|->/)[0].trim() };
  }
  const close = item.lastIndexOf(")");
  return {
    relation: named.split("!")[0].trim(),
    inner: item.slice(open + 1, close === -1 ? item.length : close),
  };
}

function exposesEmail(items) {
  for (const item of items) {
    if (item.column === "*") return "all columns";
    if (item.column === "email") return "email";
  }
  return null;
}

/**
 * What a select string reads of profiles.email: "all columns", "email", or
 * null. `onProfiles` says whether the top level of the string is the
 * profiles table itself; embeds are searched at every depth either way.
 */
export function selectExposure(text, onProfiles) {
  const items = splitTopLevel(text).map(parseSelectItem);
  if (onProfiles) {
    const hit = exposesEmail(items);
    if (hit) return hit;
  }
  for (const item of items) {
    if (item.relation === undefined) continue;
    const hit = selectExposure(item.inner, item.relation === "profiles");
    if (hit) return hit;
  }
  return null;
}

// ── Resolving a select argument to text ─────────────────────────────────────

function constInitializer(sourceFile, name) {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if ((ts.getCombinedNodeFlags(stmt.declarationList) & ts.NodeFlags.Const) === 0) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
        return decl.initializer;
      }
    }
  }
  return null;
}

function importSpecifierOf(sourceFile, name) {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (el.name.text === name) {
        return { specifier: stmt.moduleSpecifier.text, exported: (el.propertyName ?? el.name).text };
      }
    }
  }
  return null;
}

/**
 * The text of a select argument, or null when it cannot be known statically.
 * `loadModule(fromRel, specifier)` returns the parsed source file an import
 * points at, or null; `hops` bounds the walk to one import.
 */
export function resolveText(node, sourceFile, rel, loadModule, hops = 1) {
  node = unwrap(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      const part = resolveText(span.expression, sourceFile, rel, loadModule, hops);
      if (part === null) return null;
      text += part + span.literal.text;
    }
    return text;
  }
  if (ts.isIdentifier(node)) {
    const local = constInitializer(sourceFile, node.text);
    if (local) return resolveText(local, sourceFile, rel, loadModule, hops);
    if (hops === 0) return null;
    const imported = importSpecifierOf(sourceFile, node.text);
    if (!imported) return null;
    const target = loadModule(rel, imported.specifier);
    if (!target) return null;
    const init = constInitializer(target.sourceFile, imported.exported);
    return init ? resolveText(init, target.sourceFile, target.rel, loadModule, hops - 1) : null;
  }
  return null;
}

// ── One file ────────────────────────────────────────────────────────────────

function parse(rel, text) {
  const scriptKind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind);
}

function isServiceClientCall(node) {
  const call = unwrap(node);
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "createServiceClient"
  );
}

function serviceBindingsOf(sourceFile) {
  const bindings = new Set();
  (function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.name) &&
      isServiceClientCall(node.initializer)
    ) {
      bindings.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  })(sourceFile);
  return bindings;
}

/** Index of the plain identifier parameter named `name`, or -1. */
function paramIndex(fn, name) {
  return fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === name);
}

/** The nearest enclosing function that declares `name` as a parameter. */
function paramOwner(node, name) {
  for (let fn = enclosingFunction(node); fn; fn = enclosingFunction(fn.parent)) {
    const index = paramIndex(fn, name);
    if (index !== -1) return { fn, index };
  }
  return null;
}

function stringArg(m, index = 0) {
  const arg = m.args[index] && unwrap(m.args[index]);
  return arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : null;
}

function namesEmailKey(node) {
  const obj = node && unwrap(node);
  if (!obj || !ts.isObjectLiteralExpression(obj)) return false;
  return obj.properties.some(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === "email"
  );
}

const OR_EMAIL = /(?:^|[,(])\s*email\./;

/** Why a chain's filters read profiles.email, or null. */
function filterExposure(chain) {
  for (const m of chain.methods) {
    if (m.name === "select" || m.name === "from" || WRITES.has(m.name)) continue;
    const first = stringArg(m);
    if (m.name === "or") {
      if (first === null) continue;
      const onProfiles = chain.table === "profiles" ? m.args.length < 2 : false;
      const embedded = m.args.length > 1 && /["'`]profiles["'`]/.test(m.args[1].getText());
      if ((onProfiles || embedded) && OR_EMAIL.test(first)) return `.or() on email`;
      continue;
    }
    if (m.name === "match") {
      if (chain.table === "profiles" && namesEmailKey(m.args[0])) return `.match() on email`;
      continue;
    }
    if (first === null) continue;
    if (chain.table === "profiles" && first === "email") return `.${m.name}() on email`;
    if (first.startsWith("profiles.email")) return `.${m.name}() on an embedded profiles.email`;
  }
  return null;
}

/**
 * Scan one file. Returns the request-client findings plus the chains whose
 * verdict depends on who calls the enclosing function (`pending`), and every
 * call in the file with the client argument it passes, for `judgeAll`.
 * Filesystem-free apart from `loadModule`, so fixtures can drive it.
 */
export function scanSource(rel, text, loadModule = () => null) {
  const sourceFile = parse(rel, text);
  const serviceBindings = serviceBindingsOf(sourceFile);
  const findings = [];
  const pending = [];
  const calls = [];

  (function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      if (name) {
        calls.push({
          name,
          line: lineOf(sourceFile, node),
          args: node.arguments.map((arg) => {
            if (isServiceClientCall(arg)) return { service: true };
            const id = unwrap(arg);
            if (!ts.isIdentifier(id)) return { service: false };
            if (serviceBindings.has(id.text)) return { service: true };
            const owner = paramOwner(node, id.text);
            return owner
              ? { service: false, param: { fnName: functionName(owner.fn), index: owner.index } }
              : { service: false };
          }),
        });
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "from" &&
      node.arguments.length > 0
    ) {
      const table = unwrap(node.arguments[0]);
      const root = chainRoot(node.expression.expression);
      if (
        (ts.isStringLiteral(table) || ts.isNoSubstitutionTemplateLiteral(table)) &&
        root &&
        !/^[A-Z]/.test(root.text) &&
        !serviceBindings.has(root.text)
      ) {
        const chain = {
          table: table.text,
          line: lineOf(sourceFile, node),
          methods: collectMethods(outermostChainCall(node)),
        };
        const reasons = [];
        for (const m of chain.methods) {
          if (m.name !== "select") continue;
          if (m.args.length === 0) {
            if (chain.table === "profiles") reasons.push("a bare .select() reads all columns");
            continue;
          }
          const resolved = resolveText(m.args[0], sourceFile, rel, loadModule);
          if (resolved === null) {
            reasons.push("a select argument that is not a literal column list; write it as one");
            continue;
          }
          const hit = selectExposure(resolved, chain.table === "profiles");
          if (hit) reasons.push(`a select of ${hit} from profiles`);
        }
        const filter = filterExposure(chain);
        if (filter) reasons.push(filter);

        if (reasons.length > 0) {
          const entry = { file: rel, line: chain.line, table: chain.table, reasons };
          const owner = paramOwner(node, root.text);
          const fnName = owner && functionName(owner.fn);
          if (fnName) pending.push({ ...entry, fnName, index: owner.index });
          else findings.push(entry);
        }
      }
    }
    ts.forEachChild(node, visit);
  })(sourceFile);

  return { findings, pending, calls: calls.map((c) => ({ ...c, file: rel })) };
}

/**
 * Settle the chains rooted at a function parameter: such a chain is on the
 * service client only when every call of that function passes one, directly
 * or through a parameter that is itself always filled with one.
 */
export function judgeAll(scans) {
  const findings = scans.flatMap((s) => s.findings);
  const calls = scans.flatMap((s) => s.calls);

  function requestCallSite(fnName, index, seen) {
    const key = `${fnName}#${index}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const sites = calls.filter((c) => c.name === fnName);
    if (sites.length === 0) return "no call site was found, so the client cannot be proven";
    for (const site of sites) {
      const arg = site.args[index];
      if (arg?.service) continue;
      if (arg?.param?.fnName) {
        const inner = requestCallSite(arg.param.fnName, arg.param.index, seen);
        if (inner === null) continue;
        return inner;
      }
      return `${site.file}:${site.line} does not pass a service client`;
    }
    return null;
  }

  for (const chain of scans.flatMap((s) => s.pending)) {
    const why = requestCallSite(chain.fnName, chain.index, new Set());
    if (why === null) continue;
    findings.push({
      file: chain.file,
      line: chain.line,
      table: chain.table,
      reasons: [...chain.reasons, `${chain.fnName}() takes its client as a parameter and ${why}`],
    });
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ── Main scan ───────────────────────────────────────────────────────────────

function resolveModule(fromRel, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = path.posix.join(path.posix.dirname(fromRel), specifier);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    const abs = path.join(repoRoot, candidate);
    if (fs.existsSync(abs)) {
      return { rel: candidate, sourceFile: parse(candidate, fs.readFileSync(abs, "utf8")) };
    }
  }
  return null;
}

function main() {
  const targets = execFileSync("git", ["ls-files", "--", ...SCAN_ROOTS], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !SCAN_EXCLUDE.has(f));

  const findings = judgeAll(
    targets.map((rel) =>
      scanSource(rel, fs.readFileSync(path.join(repoRoot, rel), "utf8"), resolveModule)
    )
  );

  if (findings.length > 0) {
    console.error(
      `profile email guard FAILED: ${findings.length} request-client read(s) of profiles.email\n`
    );
    for (const f of findings) {
      console.error(`${f.file}:${f.line} (${f.table})`);
      for (const reason of f.reasons) console.error(`  ${reason}`);
    }
    console.error(
      "\nClient roles cannot read profiles.email. Select PROFILE_COLUMNS from lib/profileColumns.ts, " +
        "or name the columns, and read an address through get_own_email(), admin_member_emails() " +
        "or profiles_directory. See scripts/README.md."
    );
    process.exit(1);
  }

  console.log(`profile email guard OK: ${targets.length} app/components/lib files scanned`);
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
