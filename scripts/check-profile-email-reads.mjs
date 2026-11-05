#!/usr/bin/env node
/**
 * Static guard: no request-client read of profiles.email.
 *
 * The app reads a person's address through three paths that apply their
 * hide_email setting, never from the table on the request client. Client
 * roles are also to hold no SELECT on the column, and PostgREST answers 42501
 * for the whole request when any part of it touches a column the role cannot
 * read. That includes `select("*")`, a bare `.select()` after a write,
 * a filter or ordering on the column, and an embedded `profiles(...)` on
 * another table. This script walks the TypeScript AST of every tracked file
 * in app/, components/ and lib/ and fails on each of those shapes when the
 * chain runs on the request client.
 *
 * A chain is on the service client, and skipped, when the nearest enclosing
 * declaration of its root is a variable bound from createServiceClient(), or
 * a function parameter that every call site in the scanned files fills with
 * such a binding. Those chains carry an explicit org_id, which
 * check-service-role-org-scope.mjs enforces. Every other chain is judged as a
 * request-client read: a root that is a property, `this`, an import, or a
 * name the walk cannot place, and a table that is not known text is judged
 * as profiles.
 *
 * A select argument must resolve to text: a string literal, a template whose
 * substitutions are constants, or a constant, declared in the same file or
 * exported from a directly imported one. Anything else fails closed.
 *
 * Known limits: an embed written through a foreign key column instead of the
 * table name (`author:created_by(*)`) is not recognised as a profiles embed.
 * A query builder held in a variable is followed inside the function that
 * declares it, and no further: one handed to another function, returned, or
 * stored on an object is read only as far as the chain that built it.
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
  // A spread embed (`...profiles(email)`) and quoted names read the same columns.
  const head = (open === -1 ? item : item.slice(0, open)).replace(/^\s*\.\.\./, "").replace(/"/g, "").trim();
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

function bindsName(nameNode, name) {
  if (ts.isIdentifier(nameNode)) return nameNode.text === name;
  return nameNode.elements.some((el) => !ts.isOmittedExpression(el) && bindsName(el.name, name));
}

function declarationIn(list, name) {
  return list.declarations.find((decl) => bindsName(decl.name, name)) ?? null;
}

/**
 * What `name` refers to where `node` stands: the nearest enclosing variable
 * declaration or function parameter, or null for an import, a global or
 * anything else. Two functions in one file may bind the same name to
 * different clients, so a file-wide lookup by name is not enough.
 */
function bindingOf(node, name) {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      const index = scope.parameters.findIndex((p) => bindsName(p.name, name));
      if (index !== -1) return { fn: scope, index, plain: ts.isIdentifier(scope.parameters[index].name) };
    }
    if (
      ts.isSourceFile(scope) ||
      ts.isBlock(scope) ||
      ts.isModuleBlock(scope) ||
      ts.isCaseClause(scope) ||
      ts.isDefaultClause(scope)
    ) {
      for (const stmt of scope.statements) {
        const decl = ts.isVariableStatement(stmt) && declarationIn(stmt.declarationList, name);
        if (decl) return { decl, scope };
      }
    }
    if (
      (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) &&
      scope.initializer &&
      ts.isVariableDeclarationList(scope.initializer)
    ) {
      const decl = declarationIn(scope.initializer, name);
      if (decl) return { decl, scope };
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration && bindsName(scope.variableDeclaration.name, name)) {
      return { decl: scope.variableDeclaration, scope };
    }
  }
  return null;
}

/**
 * Which client an identifier holds: "service", a `{ fnName, index }` when it
 * is a named function's parameter, whose callers decide, or "request".
 */
function clientOf(identifier) {
  const binding = bindingOf(identifier, identifier.text);
  if (binding?.decl) {
    const { name, initializer } = binding.decl;
    if (!ts.isIdentifier(name)) return "request";
    // Every value the variable is given, a later assignment included
    // (`let service; try { service = await createServiceClient(); }`).
    const values = initializer ? [initializer] : [];
    (function visit(node) {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        node.left.text === name.text
      ) {
        values.push(node.right);
      }
      ts.forEachChild(node, visit);
    })(binding.scope);
    return values.length > 0 && values.every(isServiceClientCall) ? "service" : "request";
  }
  if (binding?.fn && binding.plain) {
    const fnName = functionName(binding.fn);
    if (fnName) return { fnName, index: binding.index };
  }
  return "request";
}

/**
 * The calls made later on a query builder that `head` leaves in a variable
 * (`let q = c.from("profiles").select("id"); q = q.eq("email", x)`), inside
 * the function that declares it.
 */
function continuedMethods(head) {
  const parent = head.parent;
  let holder = null;
  if (ts.isVariableDeclaration(parent) && parent.initializer === head && ts.isIdentifier(parent.name)) {
    holder = parent.name;
  } else if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === head &&
    ts.isIdentifier(parent.left)
  ) {
    holder = parent.left;
  }
  if (!holder) return [];
  const methods = [];
  (function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      outermostChainCall(node) === node &&
      node !== head
    ) {
      const chain = collectMethods(node);
      let root = node;
      for (let i = 0; i < chain.length; i++) root = unwrap(root.expression.expression);
      if (ts.isIdentifier(root) && root.text === holder.text) methods.push(...chain);
    }
    ts.forEachChild(node, visit);
  })(enclosingFunction(head) ?? head.getSourceFile());
  return methods;
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
      if (m.args.length === 0) continue;
      // The source text, so a template with substitutions is still searched.
      const filters = first ?? m.args[0].getText().replace(/^[`"']/, "");
      const onProfiles = chain.onProfiles && m.args.length < 2;
      const embedded = m.args.length > 1 && /["'`]profiles["'`]/.test(m.args[1].getText());
      if ((onProfiles || embedded) && OR_EMAIL.test(filters)) return `.or() on email`;
      continue;
    }
    if (m.name === "match") {
      if (chain.onProfiles && namesEmailKey(m.args[0])) return `.match() on email`;
      continue;
    }
    if (first === null) continue;
    if (chain.onProfiles && first === "email") return `.${m.name}() on email`;
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
            const client = clientOf(id);
            if (client === "service") return { service: true };
            return client === "request" ? { service: false } : { service: false, param: client };
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
      const root = chainRoot(node.expression.expression);
      const client = root ? clientOf(root) : "request";
      if (client !== "service") {
        const head = outermostChainCall(node);
        // Null when the table is not known text; the chain is then judged as profiles.
        const table = resolveText(node.arguments[0], sourceFile, rel, loadModule);
        const chain = {
          table: table ?? "a table that is not a literal, judged as profiles",
          onProfiles: table === null || table === "profiles",
          line: lineOf(sourceFile, node),
          methods: [...collectMethods(head), ...continuedMethods(head)],
        };
        const reasons = [];
        for (const m of chain.methods) {
          if (m.name !== "select") continue;
          if (m.args.length === 0) {
            if (chain.onProfiles) reasons.push("a bare .select() reads all columns");
            continue;
          }
          const resolved = resolveText(m.args[0], sourceFile, rel, loadModule);
          if (resolved === null) {
            reasons.push("a select argument that is not a literal column list; write it as one");
            continue;
          }
          const hit = selectExposure(resolved, chain.onProfiles);
          if (hit) reasons.push(`a select of ${hit} from profiles`);
        }
        const filter = filterExposure(chain);
        if (filter) reasons.push(filter);

        if (reasons.length > 0) {
          const entry = { file: rel, line: chain.line, table: chain.table, reasons };
          if (client === "request") findings.push(entry);
          else pending.push({ ...entry, ...client });
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
      "\nThe app reads no address from profiles on the request client. Select PROFILE_COLUMNS from lib/profileColumns.ts, " +
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
