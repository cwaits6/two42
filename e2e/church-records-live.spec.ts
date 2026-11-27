import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures/auth";
import { PERSONAS } from "./fixtures/personas";
import { requireRecordsSecret } from "./fixtures/recordsSecret";

// What a member sees in the directory when their church shows details live
// from its records, and what a church admin is told before switching to live.
// No records are called: the connection, the links, the settings and the mode
// are fixture rows written through the stack's own Postgres container, and the
// fixture's key can't be opened, so the real live route can only answer that
// the records aren't available. The first test answers that route itself.
// afterAll removes the rows with the connection and puts the seeded birthdays
// back. A connection or setting someone made by hand on the shared stack stops
// the spec rather than being replaced.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const FIXTURE_URL = "https://records.example.test";
const ISAAC = PERSONAS.oneGroup.email;
const CHLOE = PERSONAS.spouse.email;
const HENRY = PERSONAS.householdPrimary.email;
const PEOPLE = [ISAAC, CHLOE, HENRY];
// Undefined until captured, so a failed setup never writes over the seeded birthdays.
let seededBirthdays: string | undefined;
let isaacId = "";

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

const org = `(select org_id from public.profiles where email = '${ISAAC}')`;
const id = (email: string) => `(select id from public.profiles where email = '${email}')`;
const birthdayOf = (email: string) =>
  sql(`select concat_ws('/', birth_month, birth_day, birth_year) from public.profiles where email = '${email}';`);

// The stack is shared, so only this spec's own rows are ever removed.
function removeFixtures() {
  sql(`delete from public.records_connections where org_id = ${org} and base_url = '${FIXTURE_URL}';
       delete from public.records_field_settings where org_id = ${org}
          and not exists (select 1 from public.records_connections where org_id = ${org});
       delete from public.records_org_settings where org_id = ${org}
          and not exists (select 1 from public.records_connections where org_id = ${org});`);
}

test.beforeAll(() => {
  requireRecordsSecret();
  const existing = sql(`select count(*) from public.records_connections
                         where org_id = ${org} and base_url <> '${FIXTURE_URL}';`);
  if (existing !== "0") {
    throw new Error("The seeded church already has a records connection on this stack; this spec won't replace it.");
  }
  const orphaned = sql(`select (select count(*) from public.records_field_settings where org_id = ${org})
                             + (select count(*) from public.records_org_settings where org_id = ${org})
                         where not exists (select 1 from public.records_connections where org_id = ${org});`);
  if (orphaned !== "" && orphaned !== "0") {
    throw new Error("The seeded church has records settings without a connection on this stack; this spec won't remove them.");
  }
  seededBirthdays = sql(`select json_object_agg(email, json_build_array(birth_month, birth_day, birth_year))
                           from public.profiles where email in (${PEOPLE.map((e) => `'${e}'`).join(", ")});`);
  isaacId = sql(`select ${id(ISAAC)};`);
  removeFixtures();
  sql(`
    insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint)
      values (${org}, 'rock', '${FIXTURE_URL}', 'k1.fixture.fixture.fixture', 'test');
    insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
      select org_id, connection_id, l.profile_id, l.person from public.records_connections,
             (values (${id(ISAAC)}, 'e2e-2001'), (${id(CHLOE)}, 'e2e-2002'), (${id(HENRY)}, 'e2e-2003')) l(profile_id, person)
       where org_id = ${org};
    insert into public.records_field_settings (org_id, field, mode) values (${org}, 'birthday', 'member');
    insert into public.records_org_settings (org_id, mode) values (${org}, 'live');
    update public.profiles set birth_month = null, birth_day = null, birth_year = null where email = '${ISAAC}';`);
});

test.afterAll(() => {
  if (seededBirthdays === undefined) return;
  removeFixtures();
  sql(`update public.profiles p
          set birth_month = (s.value ->> 0)::smallint, birth_day = (s.value ->> 1)::smallint, birth_year = (s.value ->> 2)::smallint
         from json_each('${seededBirthdays}'::json) s
        where p.email = s.key;`);
});

test.describe("a member, in a church that shows details live", () => {
  test.use({ persona: "oneGroup" });

  test("sees their birthday from the church's records, on their card and in Birthdays, and may hide it", async ({ page }) => {
    let asked = 0;
    await page.route("**/api/directory/live", (route) => {
      asked++;
      return route.fulfill({
        json: {
          mode: "live",
          people: { [isaacId]: { birthday: { state: "shown", value: { month: 4, day: 12 } } } },
          households: {},
          children: {},
          canHide: { person: isaacId, household: null },
        },
      });
    });
    await page.goto(`/directory?person=${isaacId}`);
    await expect(page.getByText("Birthday — April 12")).toBeVisible();
    await expect(page.getByRole("button", { name: "Don't show" })).toBeVisible();
    await page.getByRole("link", { name: "Birthdays" }).click();
    const april = page.getByRole("heading", { name: /^April/ }).locator("xpath=..");
    await expect(april.getByText(PERSONAS.oneGroup.name)).toBeVisible();
    expect(asked).toBe(1);
  });

  test("when the records can't be reached, the directory still loads and says the detail isn't available", async ({ page }) => {
    await page.goto(`/directory?person=${isaacId}`);
    await expect(page.getByText("Birthday — Not available right now")).toBeVisible();
    await page.getByRole("link", { name: "Birthdays" }).click();
    await expect(page.getByText("Birthdays from your church's records: Not available right now")).toBeVisible();
    // Henry's birthday is his own in two42, so it shows as ever.
    const list = page.getByRole("main");
    await expect(list.getByText(PERSONAS.householdPrimary.name)).toBeVisible();
    await expect(list.getByText(PERSONAS.oneGroup.name)).toHaveCount(0);
  });

  test("when two42 can't load the details either, says so rather than showing none", async ({ page }) => {
    await page.route("**/api/directory/live", (route) => route.fulfill({ status: 500, json: { error: "x" } }));
    await page.goto(`/directory?person=${isaacId}`);
    await expect(page.getByText("Details from your church's records: Not available right now")).toBeVisible();
    await page.getByRole("link", { name: "Birthdays" }).click();
    await expect(page.getByText("Birthdays from your church's records: Not available right now")).toBeVisible();
  });
});

test.describe("a church admin switching from copy to live", () => {
  test.use({ persona: "admin" });

  test("is told how many copied details go, and the one a member changed stays", async ({ page }) => {
    // Two birthdays still the church's, and one Henry changed.
    sql(`update public.records_org_settings set mode = 'copy' where org_id = ${org};
         update public.profiles p set birth_month = (s.value ->> 0)::smallint, birth_day = (s.value ->> 1)::smallint,
                birth_year = (s.value ->> 2)::smallint
           from json_each('${seededBirthdays}'::json) s where p.email = s.key;
         insert into public.records_field_values (org_id, profile_id, field, state, church_value)
           values (${org}, ${id(ISAAC)}, 'birthday', 'records', '{}'),
                  (${org}, ${id(CHLOE)}, 'birthday', 'records', '{}'),
                  (${org}, ${id(HENRY)}, 'birthday', 'changed', '{"birth_month": 1, "birth_day": 1, "birth_year": null}');`);
    const henrysBirthday = birthdayOf(HENRY);

    await page.goto("/admin/settings/church-records");
    const card = page.getByText("How two42 uses your church's records").locator("xpath=ancestor::*[@data-slot='card'][1]");
    await expect(card.getByText(/copied from Rock RMS into two42/)).toBeVisible();
    await card.getByRole("button", { name: "Live from your church's records" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("This removes 2 details copied from your church's records.", { exact: false })).toBeVisible();
    await dialog.getByRole("button", { name: "Remove and switch" }).click();
    await expect(card.getByText(/never stored in two42/)).toBeVisible();

    expect(sql(`select mode from public.records_org_settings where org_id = ${org};`)).toBe("live");
    expect(birthdayOf(ISAAC)).toBe("");
    expect(birthdayOf(CHLOE)).toBe("");
    expect(birthdayOf(HENRY)).toBe(henrysBirthday);
  });
});
