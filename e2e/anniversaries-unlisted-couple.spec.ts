import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { ORG_NAME } from "./fixtures/personas";

// The seed's Mockingham household: Henry the primary, Chloe the spouse, both
// with accounts and in Group B with the viewer, Isaac. The seed has no
// household record claimed by a spouse, which is what an invited spouse leaves
// behind, so the hooks add Chloe's and delete it again.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const HOUSEHOLD = "f0000000-0000-0000-0000-000000000005";
const HENRY = "a0000000-0000-0000-0000-000000000111";
const CHLOE = "a0000000-0000-0000-0000-000000000112";
const CLAIMED_RECORD = "d0000000-0000-0000-0000-0000000e2e03";

const ORG_OF_HOUSEHOLD = `(select org_id from public.family_units where id = '${HOUSEHOLD}')`;

const ANNIVERSARIES = "/directory/anniversaries";
const FILTERS = ["", "?when=week", "?when=month"];

const SEED_SQL = `
  delete from public.family_members where id = '${CLAIMED_RECORD}';
  update public.profiles set is_unlisted = false where id in ('${HENRY}', '${CHLOE}');
  update public.organizations set directory_visibility = 'shared_groups' where id = ${ORG_OF_HOUSEHOLD};
  update public.family_units
     set anniversary_month = 10, anniversary_day = 3, anniversary_year = 2009
   where id = '${HOUSEHOLD}';
`;

// The date is two days out in the church's zone, which is the zone the page
// takes "today" from, or the last day of that month when it comes sooner. That
// keeps the couple on every filter: This week, This month and all. No year, so
// a February 29 is a date the row accepts.
const SETUP_SQL = `
  insert into public.family_members
    (id, org_id, family_id, first_name, last_name, relationship, claimed_profile_id)
  values
    ('${CLAIMED_RECORD}', ${ORG_OF_HOUSEHOLD}, '${HOUSEHOLD}', 'Chloe', 'Mockingham', 'spouse', '${CHLOE}');
  update public.organizations set directory_visibility = 'org' where id = ${ORG_OF_HOUSEHOLD};
  update public.family_units
     set anniversary_month = extract(month from soon.day)::int,
         anniversary_day = extract(day from soon.day)::int,
         anniversary_year = null
    from (
      select least(
               church.today + 2,
               (date_trunc('month', church.today) + interval '1 month - 1 day')::date
             ) as day
        from (
          select (now() at time zone timezone)::date as today
            from public.organizations
           where id = ${ORG_OF_HOUSEHOLD}
        ) church
    ) soon
   where id = '${HOUSEHOLD}';
`;

function runSql(sql: string) {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(() => runSql(`${SEED_SQL}${SETUP_SQL}`));
test.afterAll(() => runSql(SEED_SQL));

const mockingham = (page: Page) => page.getByRole("link", { name: /Mockingham/ });

/** Opens a filter with everyone in the church showing, the widest list a member gets. */
async function openEveryone(page: Page, filter: string) {
  await page.goto(`${ANNIVERSARIES}${filter}`);
  const scope = page.getByRole("combobox", { name: "Show people from" });
  await scope.click();
  await page.getByRole("option", { name: `Everyone in ${ORG_NAME}` }).click();
  await expect(scope).toContainText(`Everyone in ${ORG_NAME}`);
  // The list renders only once the directory has loaded, so a count of 0 is real.
  await expect(page.getByLabel("Show anniversaries from")).toBeVisible();
}

test.describe("what a member sees under Anniversaries", () => {
  test.use({ persona: "oneGroup" });

  test("a couple who are both listed has one row on every filter", async ({ page }) => {
    for (const filter of FILTERS) {
      await openEveryone(page, filter);
      await expect(mockingham(page)).toHaveCount(1);
      await expect(mockingham(page)).toContainText("Henry & Chloe Mockingham");
    }
  });

  test("a listed primary whose claimed spouse is unlisted has no row", async ({ page }) => {
    runSql(`update public.profiles set is_unlisted = true where id = '${CHLOE}';`);
    for (const filter of FILTERS) {
      await openEveryone(page, filter);
      await expect(mockingham(page)).toHaveCount(0);
    }
  });

  test("a couple who are both unlisted has no row, and no household name", async ({ page }) => {
    runSql(`update public.profiles set is_unlisted = true where id in ('${HENRY}', '${CHLOE}');`);
    for (const filter of FILTERS) {
      await openEveryone(page, filter);
      await expect(mockingham(page)).toHaveCount(0);
      await expect(page.getByText("Mockingham")).toHaveCount(0);
    }
  });

  test("a listed primary whose spouse has no account keeps their row", async ({ page }) => {
    await openEveryone(page, "");
    const seedly = page.getByRole("link", { name: /Seedly/ });
    await expect(seedly).toHaveCount(1);
    await expect(seedly).toContainText("Isaac & Nora Seedly");
  });
});
