import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS } from "./fixtures/personas";

// The seed has no Group B team or signup, so the hooks build a team with Leo as
// its lead, and each test starts from Henry's signup for himself and Chloe. The
// date is the Sunday after next, inside the default window in every time zone.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const TEAM_ID = "b0000000-0000-0000-0000-0000000000e3";
const SIGNUP_ID = "b0000000-0000-0000-0000-0000000000e4";
const WINDOW_WEEKS = 8;
const TEAM_PATH = `/g/${GROUP_B}/serving/${TEAM_ID}`;
const { householdPrimary, spouse, oneGroup, twoGroups } = PERSONAS;

const DROP_SQL = `delete from public.teams where id = '${TEAM_ID}';`;

const SETUP_SQL = `
  ${DROP_SQL}
  insert into public.teams (id, org_id, group_id, name)
    select '${TEAM_ID}', g.org_id, g.id, 'Ushers'
    from public.groups g where g.id = '${GROUP_B}';
  insert into public.serving_team_settings (org_id, team_id, enabled, window_weeks)
    select t.org_id, t.id, true, ${WINDOW_WEEKS} from public.teams t where t.id = '${TEAM_ID}';
  insert into public.team_members (org_id, team_id, profile_id, is_leader)
    select t.org_id, t.id, p.id, p.email = '${twoGroups.email}'
    from public.teams t
    join public.profiles p on p.org_id = t.org_id
    where t.id = '${TEAM_ID}'
      and p.email in ('${householdPrimary.email}', '${spouse.email}', '${oneGroup.email}', '${twoGroups.email}');
`;

const SIGNUP_SQL = `
  delete from public.serving_signups where id = '${SIGNUP_ID}';
  insert into public.serving_signups (id, org_id, team_id, service_date, family_id, created_by)
    select '${SIGNUP_ID}', p.org_id, '${TEAM_ID}',
           current_date + 14 - extract(dow from current_date)::int, p.family_id, p.id
    from public.profiles p where p.email = '${householdPrimary.email}';
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id)
    select p.org_id, '${SIGNUP_ID}', p.id
    from public.profiles p where p.email in ('${householdPrimary.email}', '${spouse.email}');
`;

function runSql(sql: string) {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(() => runSql(SETUP_SQL));
test.beforeEach(() => runSql(SIGNUP_SQL));
test.afterAll(() => runSql(DROP_SQL));

const openDates = (page: Page) => page.getByText("still needs someone");
const cancelButton = (page: Page) => page.getByRole("button", { name: /^Cancel signup for / });
const removeButton = (page: Page) => page.getByRole("button", { name: /^Remove .* from .*\d/ });

async function expectDateOpensAfter(page: Page, confirmLabel: string) {
  await page.getByRole("dialog").getByRole("button", { name: confirmLabel }).click();
  await expect(page.getByText("Signup cancelled.")).toBeVisible();
  await expect(openDates(page)).toHaveCount(WINDOW_WEEKS);

  await page.reload();
  await expect(openDates(page)).toHaveCount(WINDOW_WEEKS);
  await expect(cancelButton(page)).toHaveCount(0);
  await expect(removeButton(page)).toHaveCount(0);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test.describe(`the spouse listed on the date at ${viewport.width}`, () => {
    test.use({ persona: "spouse", viewport });

    test("cancels a date they did not sign up for, and it opens up", async ({ page }) => {
      await page.goto(TEAM_PATH);
      await expect(openDates(page)).toHaveCount(WINDOW_WEEKS - 1);
      await cancelButton(page).click();
      await expectDateOpensAfter(page, "Cancel signup");
    });
  });
}

test.describe("the person who tapped Sign up", () => {
  test.use({ persona: "householdPrimary" });

  test("can still cancel the date", async ({ page }) => {
    await page.goto(TEAM_PATH);
    await cancelButton(page).click();
    await expectDateOpensAfter(page, "Cancel signup");
  });
});

for (const [who, persona] of [["team lead", "twoGroups"], ["group leader", "leadsB"]] as const) {
  test.describe(`the ${who}`, () => {
    test.use({ persona });

    test("can still remove the date", async ({ page }) => {
      await page.goto(TEAM_PATH);
      await removeButton(page).click();
      await expectDateOpensAfter(page, "Remove signup");
    });
  });
}

test.describe("a team member not listed on the date", () => {
  test.use({ persona: "oneGroup" });

  test("sees no way to cancel it, and the API refuses them", async ({ page }) => {
    await page.goto(TEAM_PATH);
    await expect(openDates(page)).toHaveCount(WINDOW_WEEKS - 1);
    await expect(cancelButton(page)).toHaveCount(0);
    await expect(removeButton(page)).toHaveCount(0);

    const res = await page.request.delete("/api/serving/signups", { data: { signupId: SIGNUP_ID } });
    expect(res.status()).toBe(403);

    await page.reload();
    await expect(openDates(page)).toHaveCount(WINDOW_WEEKS - 1);
  });
});
