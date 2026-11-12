import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, GROUP_C, type PersonaKey } from "./fixtures/personas";

// Group Home and the Directory both list households through families_directory_full,
// so whoever opens them sees the same couples on each. The seed's Mockingham
// household (Henry and Chloe, Groups A and B) gets its anniversary moved to today
// in the church's time zone, so it is on both pages' This week for Group B.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const HOUSEHOLD = "f0000000-0000-0000-0000-000000000005";
const COUPLE = "Henry & Chloe Mockingham";

const SEED_SQL = `
  update public.family_units
     set anniversary_month = 10, anniversary_day = 3, anniversary_year = 2009
   where id = '${HOUSEHOLD}';
`;

const TODAY_SQL = `
  update public.family_units f
     set anniversary_month = extract(month from church.today)::int,
         anniversary_day = extract(day from church.today)::int,
         anniversary_year = 2009
    from (select o.id, (now() at time zone o.timezone)::date as today from public.organizations o) church
   where f.id = '${HOUSEHOLD}' and church.id = f.org_id;
`;

function runSql(sql: string) {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(() => runSql(`${SEED_SQL}${TODAY_SQL}`));
test.afterAll(() => runSql(SEED_SQL));

/** The couples on the group's Home, as its "This week" line names them. */
async function homeLine(page: Page, groupId: string) {
  await page.goto(`/g/${groupId}/dashboard`);
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  const row = page.getByRole("link", { name: /^Anniversar(y|ies) this week/ });
  if ((await row.count()) === 0) return { shown: [] as string[], total: 0 };
  const line = (await row.innerText()).split("\n").at(-1) ?? "";
  // "A", "A and B", or "A, B and 3 more".
  const more = /^(.*) and (\d+) more$/.exec(line);
  const shown = more ? more[1].split(", ") : line.split(" and ");
  return { shown, total: shown.length + (more ? Number(more[2]) : 0) };
}

/** The couples on the group's Directory, This week. */
async function directoryNames(page: Page, groupId: string) {
  await page.goto(`/g/${groupId}/directory/anniversaries?when=week`);
  const rows = page.locator(`a[href^="/g/${groupId}/directory/families?family="]`);
  await expect(rows.first().or(page.getByText("No anniversaries this week."))).toBeVisible();
  return rows.locator("span.font-semibold").allInnerTexts();
}

const VIEWERS: { persona: PersonaKey; who: string; groupId: string; seesCouple: boolean }[] = [
  { persona: "oneGroup", who: "a member of Group B", groupId: GROUP_B, seesCouple: true },
  { persona: "householdPrimary", who: "the household's primary", groupId: GROUP_B, seesCouple: true },
  { persona: "admin", who: "the church admin, in Group B", groupId: GROUP_B, seesCouple: true },
  { persona: "twoGroups", who: "a member of Group C who shares Group B", groupId: GROUP_C, seesCouple: false },
  { persona: "leadsC", who: "Group C's leader, who shares no group with them", groupId: GROUP_C, seesCouple: false },
];

for (const { persona, who, groupId, seesCouple } of VIEWERS) {
  test.describe(who, () => {
    test.use({ persona });

    test(`sees the same couples on the group's Home and Directory${seesCouple ? ", the Mockinghams among them" : ""}`, async ({ page }) => {
      const directory = await directoryNames(page, groupId);
      const home = await homeLine(page, groupId);

      expect(home.total).toBe(directory.length);
      for (const name of home.shown) expect(directory).toContain(name);
      expect(directory.includes(COUPLE)).toBe(seesCouple);
      if (seesCouple && directory.length <= 2) expect(home.shown).toContain(COUPLE);
    });
  });
}
