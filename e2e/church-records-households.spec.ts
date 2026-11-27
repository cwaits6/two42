import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures/auth";
import { PERSONAS } from "./fixtures/personas";
import { requireRecordsSecret } from "./fixtures/recordsSecret";

// Who sees the children a church's records suggest for a household, and what
// the church admin sees of its household suggestions. No records are called:
// the connection, the Mockingham household's link to its family, the
// children switch, the suggested children and two household suggestions are
// fixture rows written through the stack's own Postgres container, and
// afterAll removes them with the connection, along with the child Henry adds.
// A connection or children setting someone made by hand on the shared stack
// stops the spec rather than being replaced.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const FIXTURE_URL = "https://records.example.test";
const HENRY = PERSONAS.householdPrimary.email;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const SUGGESTED = "Suggested from your church's records";
let fixturesWritten = false;

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

const org = `(select org_id from public.profiles where email = '${HENRY}')`;
const henrysHousehold = `(select family_id from public.profiles where email = '${HENRY}')`;
const householdOf = (first: string, last: string) =>
  `(select family_id from public.profiles where first_name = '${first}' and last_name = '${last}' and org_id = ${org})`;
const profile = (first: string, last: string) =>
  `(select id from public.profiles where first_name = '${first}' and last_name = '${last}' and org_id = ${org})`;

// The stack is shared, so only this spec's own rows are ever removed. The
// child Henry adds is the one entry the connection's cascade doesn't take; a
// child entered before the fixture connection, which adding can reuse, stays.
function removeFixtures() {
  sql(`delete from public.family_members m where m.org_id = ${org} and m.id in (
         select s.family_member_id from public.records_child_suggestions s
           join public.records_household_links l on l.org_id = s.org_id and l.family_id = s.family_id
           join public.records_connections c on c.org_id = l.org_id and c.connection_id = l.connection_id
          where s.org_id = ${org} and s.family_member_id is not null
            and c.base_url = '${FIXTURE_URL}' and m.created_at >= c.connected_at);
       delete from public.records_connections where org_id = ${org} and base_url = '${FIXTURE_URL}';
       delete from public.records_org_settings where org_id = ${org}
          and not exists (select 1 from public.records_connections where org_id = ${org});`);
}

function suggestChild(id: string, first: string, birthday: [number, number] | null) {
  sql(`insert into public.records_child_suggestions
         (org_id, family_id, external_person_id, first_name, last_name, birth_month, birth_day, graduation_year)
       values (${org}, ${henrysHousehold}, '${id}', '${first}', 'Mockingham',
               ${birthday ? birthday[0] : "null"}, ${birthday ? birthday[1] : "null"}, ${birthday ? 2034 : "null"});`);
}

test.beforeAll(() => {
  requireRecordsSecret();
  const existing = sql(`select count(*) from public.records_connections
                         where org_id = ${org} and base_url <> '${FIXTURE_URL}';`);
  if (existing !== "0") {
    throw new Error("The seeded church already has a records connection on this stack; this spec won't replace it.");
  }
  const orphaned = sql(`select count(*) from public.records_org_settings
                         where org_id = ${org}
                           and not exists (select 1 from public.records_connections where org_id = ${org});`);
  if (orphaned !== "0") {
    throw new Error("The seeded church has a children setting without a connection on this stack; this spec won't remove it.");
  }
  removeFixtures();
  // Adding a suggested child reuses a same-named child already in the household,
  // and removeFixtures would then delete that child too. Checked after the
  // cleanup, so a child left by an earlier run of this spec doesn't count.
  // The same name key records_add_suggested_child matches on.
  const nameKey = (column: string) =>
    `lower(regexp_replace(regexp_replace(normalize(coalesce(${column}, ''), NFKD), '([A-Za-z])[\\u0300-\\u036f]+', '\\1', 'g'), '[[:space:][:punct:]]', '', 'g'))`;
  const sameNamed = sql(`select count(*) from public.family_members
                          where org_id = ${org} and family_id = ${henrysHousehold}
                            and ${nameKey("last_name")} = 'mockingham'
                            and ${nameKey("first_name")} in ('lily', 'max', 'rosa');`);
  if (sameNamed !== "0") {
    throw new Error("Henry's household already has a child named like this spec's suggestions; this spec won't remove them.");
  }
  fixturesWritten = true;
  sql(`
    insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint)
      values (${org}, 'rock', '${FIXTURE_URL}', 'k1.fixture.fixture.fixture', 'test');
    insert into public.records_household_links (org_id, family_id, connection_id, external_family_id)
      select org_id, ${henrysHousehold}, connection_id, 'e2e-f-1' from public.records_connections where org_id = ${org};
    insert into public.records_org_settings (org_id, suggest_children) values (${org}, true);
    insert into public.records_household_suggestions
        (org_id, connection_id, external_family_id, target_family_id, family_name, people, ready)
      select org_id, connection_id, 'e2e-f-2', ${householdOf("Walter", "Nullington")}, null,
             jsonb_build_array(jsonb_build_object('profile_id', ${profile("Ruth", "Fixtureton")},
                                                  'from_family_id', ${householdOf("Ruth", "Fixtureton")},
                                                  'from_relationship', 'primary',
                                                  'relationship', 'spouse')),
             false
        from public.records_connections where org_id = ${org}
      union all
      select org_id, connection_id, 'e2e-f-3', ${householdOf("Ava", "Sampleton")}, null, '[]'::jsonb, true
        from public.records_connections where org_id = ${org};`);
  suggestChild("e2e-c-1", "Lily", [3, 3]);
  suggestChild("e2e-c-2", "Max", null);
});

test.afterAll(() => {
  if (fixturesWritten) removeFixtures();
});

for (const viewport of [PHONE, DESKTOP]) {
  test.describe(`at ${viewport.width} wide`, () => {
    test.use({ viewport });

    test.describe("the church admin", () => {
      test.use({ persona: "admin" });

      test("sees the household suggestions, named from two42, and the children switch on", async ({ page }) => {
        await page.goto("/admin/settings/church-records");
        await page.getByRole("tab", { name: "Households" }).click();
        await expect(page.getByRole("switch", { name: "Suggest children" })).toBeChecked();
        await expect(page.getByText("Ready to confirm · 1")).toBeVisible();
        await expect(page.getByText("Check first · 1")).toBeVisible();
        await expect(
          page.getByText("Your church's records list Ruth Fixtureton in one family. Put them in the Nullington household?"),
        ).toBeVisible();
        await expect(page.getByText("In the Fixtureton household · moves · as Spouse")).toBeVisible();
        await page.getByRole("button", { name: "Review list" }).click();
        await expect(page.getByText(/is in the Sampleton household\. Link it/)).toBeVisible();
      });
    });

    for (const persona of ["householdPrimary", "spouse"] as const) {
      test.describe(`the household's ${persona === "spouse" ? "spouse" : "primary"}`, () => {
        test.use({ persona });

        test("sees the children suggested for their household, with no birth year", async ({ page }) => {
          await page.goto("/profile?tab=household");
          const card = page.locator("[data-slot=card]", { has: page.getByRole("heading", { name: SUGGESTED }) });
          await expect(card.getByText("Lily Mockingham")).toBeVisible();
          await expect(card.getByText("Max Mockingham")).toBeVisible();
          await expect(card.getByText("Birthday March 3")).toBeVisible();
          await expect(card.getByRole("button", { name: "Add to household" })).toHaveCount(2);
        });
      });
    }
  });
}

test.describe("someone in another household", () => {
  test.use({ persona: "oneGroup" });

  test("sees no suggested children", async ({ page }) => {
    await page.goto("/profile?tab=household");
    await expect(page.getByRole("heading", { name: "Household details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: SUGGESTED })).toHaveCount(0);
    await expect(page.getByText("Lily Mockingham")).toHaveCount(0);
  });
});

test.describe("the household's primary on a phone", () => {
  test.use({ persona: "householdPrimary", viewport: PHONE });

  test("adds a suggested child, who joins the household without a birth year and isn't suggested again", async ({ page }) => {
    await page.goto("/profile?tab=household");
    const lily = page.getByRole("listitem").filter({ hasText: "Lily Mockingham" });
    await lily.getByRole("button", { name: "Add to household" }).click();
    await expect(page.getByText("Added Lily to your household.")).toBeVisible();
    const others = page.locator("[data-slot=card]", { has: page.getByRole("heading", { name: "Others in your household" }) });
    await expect(others.getByText("Lily Mockingham")).toBeVisible();
    expect(
      sql(`select coalesce(birth_year::text, 'none') from public.family_members
            where id = (select family_member_id from public.records_child_suggestions
                         where org_id = ${org} and external_person_id = 'e2e-c-1');`),
    ).toBe("none");
    await page.reload();
    const card = page.locator("[data-slot=card]", { has: page.getByRole("heading", { name: SUGGESTED }) });
    await expect(card.getByText("Max Mockingham")).toBeVisible();
    await expect(card.getByText("Lily Mockingham")).toHaveCount(0);
  });
});

test.describe("the household's spouse at desktop width", () => {
  test.use({ persona: "spouse", viewport: DESKTOP });

  test("dismisses a suggested child, who is never suggested again", async ({ page }) => {
    await page.goto("/profile?tab=household");
    const max = page.getByRole("listitem").filter({ hasText: "Max Mockingham" });
    await max.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText("Dismissed. Max won't be suggested again.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Household details" })).toBeVisible();
    await expect(page.getByText("Max Mockingham")).toHaveCount(0);
    expect(
      sql(`select state from public.records_child_suggestions where org_id = ${org} and external_person_id = 'e2e-c-2';`),
    ).toBe("dismissed");
  });
});

test.describe("with the children switch off", () => {
  test.use({ persona: "householdPrimary" });

  test("the household's primary sees no suggested child, even one still stored", async ({ page }) => {
    suggestChild("e2e-c-3", "Rosa", null);
    sql(`update public.records_org_settings set suggest_children = false where org_id = ${org};`);
    await page.goto("/profile?tab=household");
    await expect(page.getByRole("heading", { name: "Household details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: SUGGESTED })).toHaveCount(0);
    await expect(page.getByText("Rosa Mockingham")).toHaveCount(0);
  });
});
