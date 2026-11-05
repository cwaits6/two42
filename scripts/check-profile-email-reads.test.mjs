import { describe, expect, it } from "vitest";
import ts from "typescript";
import { judgeAll, scanSource, selectExposure } from "./check-profile-email-reads.mjs";

const REQUEST = `import { createClient } from "@/lib/supabase/server";\nconst supabase = await createClient();\n`;

/** Findings for one or more fixture files, as `file:line reason` strings. */
function check(files, loadModule) {
  const scans = Object.entries(files).map(([rel, text]) => scanSource(rel, text, loadModule));
  return judgeAll(scans).map((f) => `${f.file} ${f.reasons.join("; ")}`);
}

const page = (body) => check({ "app/page.tsx": REQUEST + body });

describe("selectExposure", () => {
  it("reads the top level only when the string is a profiles select", () => {
    expect(selectExposure("id, email", true)).toBe("email");
    expect(selectExposure("id, email", false)).toBeNull();
    expect(selectExposure("*", true)).toBe("all columns");
    expect(selectExposure("id, first_name, hide_email, email_announcements", true)).toBeNull();
  });

  it("sees an alias or a cast on the column", () => {
    expect(selectExposure("id, address:email", true)).toBe("email");
    expect(selectExposure("id, email::text", true)).toBe("email");
  });

  it("finds a profiles embed at any depth, with an alias or a hint", () => {
    expect(selectExposure("id, profiles(id, email)", false)).toBe("email");
    expect(selectExposure("id, lead:profiles!team_lead_fkey(*)", false)).toBe("all columns");
    expect(selectExposure("id, serving_signup_attendees(profile_id, profiles!inner(id, email))", false)).toBe("email");
    expect(selectExposure("id, profiles(id, first_name), teams(*)", false)).toBeNull();
  });

  it("does not take another relation's columns for a profile's", () => {
    expect(selectExposure("id, access_requests(email), family_units(*)", true)).toBeNull();
  });
});

describe("request-client reads of profiles", () => {
  it("refuses all columns", () => {
    expect(page(`await supabase.from("profiles").select("*").eq("id", id);`)).toEqual([
      "app/page.tsx a select of all columns from profiles",
    ]);
  });

  it("allows named columns without the email", () => {
    expect(page(`await supabase.from("profiles").select("id, first_name, hide_email").eq("id", id);`)).toEqual([]);
  });

  it("refuses a named email", () => {
    expect(page(`await supabase.from("profiles").select("id, email");`)).toEqual([
      "app/page.tsx a select of email from profiles",
    ]);
  });

  it("refuses a bare select after a write, and allows a write that returns named columns", () => {
    expect(page(`await supabase.from("profiles").update({ bio }).eq("id", id).select();`)).toEqual([
      "app/page.tsx a bare .select() reads all columns",
    ]);
    expect(page(`await supabase.from("profiles").update({ email }).eq("id", id).select("id");`)).toEqual([]);
  });

  it("refuses a filter or an ordering on the email", () => {
    expect(page(`await supabase.from("profiles").select("id").eq("email", address);`)).toEqual([
      "app/page.tsx .eq() on email",
    ]);
    expect(page(`await supabase.from("profiles").select("id").order("email");`)).toEqual([
      "app/page.tsx .order() on email",
    ]);
    expect(page(`await supabase.from("profiles").select("id").match({ email: address });`)).toEqual([
      "app/page.tsx .match() on email",
    ]);
    expect(page(`await supabase.from("profiles").select("id").eq("hide_email", true).order("first_name");`)).toEqual([]);
  });

  it("refuses an .or() string that names the email", () => {
    expect(
      page("await supabase.from(\"profiles\").select(\"id\").or(`first_name.ilike.%${q}%,email.ilike.%${q}%`);"),
    ).toEqual(["app/page.tsx .or() on email"]);
    expect(
      page("await supabase.from(\"profiles\").select(\"id\").or(`email.ilike.%${q}%`);"),
    ).toEqual(["app/page.tsx .or() on email"]);
    expect(
      page("await supabase.from(\"profiles\").select(\"id\").or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`);"),
    ).toEqual([]);
    expect(page(`await supabase.from("profiles").select("id").or("first_name.eq.a,email.eq.b");`)).toEqual([
      "app/page.tsx .or() on email",
    ]);
    expect(page(`await supabase.from("profiles").select("id").or("first_name.eq.a,last_name.eq.b");`)).toEqual([]);
  });

  it("refuses an embedded profiles read on another table", () => {
    expect(page(`await supabase.from("team_members").select("team_id, profiles(id, email)");`)).toEqual([
      "app/page.tsx a select of email from profiles",
    ]);
    expect(page(`await supabase.from("giving_funds").select("id, steward:profiles!fk(*)");`)).toEqual([
      "app/page.tsx a select of all columns from profiles",
    ]);
    expect(page(`await supabase.from("team_members").select("*, profiles(id, first_name)");`)).toEqual([]);
  });

  it("refuses a filter on an embedded profiles.email", () => {
    expect(
      page(`await supabase.from("team_members").select("team_id, profiles!inner(id)").eq("profiles.email", a);`),
    ).toEqual(["app/page.tsx .eq() on an embedded profiles.email"]);
  });

  it("never matches the directory view", () => {
    expect(page(`await supabase.from("profiles_directory").select("*").eq("email", address);`)).toEqual([]);
  });
});

describe("resolving the select argument", () => {
  it("follows a constant and a template built from constants in the same file", () => {
    expect(page(`const COLS = "id, email";\nawait supabase.from("profiles").select(COLS);`)).toEqual([
      "app/page.tsx a select of email from profiles",
    ]);
    expect(
      page("const PERSON = \"profiles(id, email)\";\nawait supabase.from(\"team_members\").select(`is_leader, ${PERSON}`);"),
    ).toEqual(["app/page.tsx a select of email from profiles"]);
    expect(page(`const COLS = "id, first_name";\nawait supabase.from("profiles").select(COLS);`)).toEqual([]);
  });

  it("follows one import to an exported constant", () => {
    const modules = {
      "@/lib/cols": `export const SAFE = "id, first_name";\nexport const UNSAFE = "id, email";`,
    };
    const loadModule = (_from, specifier) =>
      specifier in modules
        ? {
            rel: "lib/cols.ts",
            sourceFile: ts.createSourceFile("lib/cols.ts", modules[specifier], ts.ScriptTarget.Latest, true),
          }
        : null;
    const file = (name) =>
      `import { ${name} } from "@/lib/cols";\n${REQUEST}await supabase.from("profiles").select(${name});`;
    expect(check({ "app/page.tsx": file("SAFE") }, loadModule)).toEqual([]);
    expect(check({ "app/page.tsx": file("UNSAFE") }, loadModule)).toEqual([
      "app/page.tsx a select of email from profiles",
    ]);
  });

  it("fails closed on an argument it cannot read", () => {
    expect(page(`await supabase.from("profiles").select(columnsFor(viewer));`)).toEqual([
      "app/page.tsx a select argument that is not a literal column list; write it as one",
    ]);
  });
});

describe("which client a chain runs on", () => {
  it("skips a chain rooted at a createServiceClient() binding", () => {
    expect(
      check({
        "app/api/send/route.ts": `const service = await createServiceClient();\nawait service.from("profiles").select("id, email").eq("org_id", orgId);`,
      }),
    ).toEqual([]);
  });

  const helper = `export async function recipients(client, orgId) {\n  return client.from("profiles").select("id, email").eq("org_id", orgId);\n}`;

  it("skips a helper whose every call site passes a service client", () => {
    expect(
      check({
        "lib/send.ts": helper,
        "app/api/send/route.ts": `const service = await createServiceClient();\nawait recipients(service, orgId);\nawait recipients(await createServiceClient(), orgId);`,
      }),
    ).toEqual([]);
  });

  it("refuses the helper when one call site passes the request client", () => {
    expect(
      check({
        "lib/send.ts": helper,
        "app/api/send/route.ts": `const service = await createServiceClient();\nawait recipients(service, orgId);`,
        "app/page.tsx": `${REQUEST}await recipients(supabase, orgId);`,
      }),
    ).toEqual([
      "lib/send.ts a select of email from profiles; recipients() takes its client as a parameter and app/page.tsx:3 does not pass a service client",
    ]);
  });

  it("follows a client handed on through another helper's parameter", () => {
    const outer = `export async function notify(db, orgId) {\n  return recipients(db, orgId);\n}`;
    expect(
      check({
        "lib/send.ts": helper,
        "lib/notify.ts": outer,
        "app/api/send/route.ts": `const service = await createServiceClient();\nawait notify(service, orgId);`,
      }),
    ).toEqual([]);
    expect(
      check({
        "lib/send.ts": helper,
        "lib/notify.ts": outer,
        "app/page.tsx": `${REQUEST}await notify(supabase, orgId);`,
      }),
    ).toEqual([
      "lib/send.ts a select of email from profiles; recipients() takes its client as a parameter and app/page.tsx:3 does not pass a service client",
    ]);
  });

  it("refuses a helper nobody calls, since its client cannot be proven", () => {
    expect(check({ "lib/send.ts": helper })).toEqual([
      "lib/send.ts a select of email from profiles; recipients() takes its client as a parameter and no call site was found, so the client cannot be proven",
    ]);
  });
});
