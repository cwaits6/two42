import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS } from "./fixtures/personas";

// A Group B team on a set block of 30 Sundays starting next Sunday, asking
// for one more week, with Leo as its lead. Henry and Chloe are a couple, Isaac
// has no spouse with an account. The hooks build it through the stack's own
// Postgres container and delete it whatever happens between.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const TEAM_ID = "b0000000-0000-0000-0000-0000000000e5";
const TEAM_PATH = `/g/${GROUP_B}/serving/${TEAM_ID}`;
const SUNDAYS = 30;
const { householdPrimary, spouse, oneGroup, twoGroups } = PERSONAS;

const DROP_SQL = `delete from public.teams where id = '${TEAM_ID}';`;

// From next Sunday to the Saturday after the 30th Sunday: exactly 30 Sundays.
const SETUP_SQL = `
  ${DROP_SQL}
  insert into public.teams (id, org_id, group_id, name)
    select '${TEAM_ID}', g.org_id, g.id, 'Greeters'
    from public.groups g where g.id = '${GROUP_B}';
  insert into public.serving_team_settings (org_id, team_id, enabled, schedule, date_from, date_to, extra_weeks)
    select t.org_id, t.id, true, 'set',
           current_date + (7 - extract(dow from current_date)::int),
           current_date + (7 - extract(dow from current_date)::int) + ${SUNDAYS * 7 - 1},
           1
    from public.teams t where t.id = '${TEAM_ID}';
  insert into public.team_members (org_id, team_id, profile_id, is_leader)
    select t.org_id, t.id, p.id, p.email = '${twoGroups.email}'
    from public.teams t
    join public.profiles p on p.org_id = t.org_id
    where t.id = '${TEAM_ID}' and p.email in ('${twoGroups.email}', '${oneGroup.email}');
`;

const CLEAR_SIGNUPS_SQL = `delete from public.serving_signups where team_id = '${TEAM_ID}';`;

// The block ends in ten days, so the lead's To do is due.
const ENDING_SQL = `
  update public.serving_team_settings
     set date_from = current_date - 20, date_to = current_date + 10
   where team_id = '${TEAM_ID}';
`;

// Chloe leaves the team, and the team stops asking for more weeks, so a
// sign-up has nothing left to ask.
const SPOUSE_OFF_TEAM_SQL = `
  ${CLEAR_SIGNUPS_SQL}
  delete from public.team_members
   where team_id = '${TEAM_ID}'
     and profile_id = (select id from public.profiles where email = '${spouse.email}');
  update public.serving_team_settings set extra_weeks = 0 where team_id = '${TEAM_ID}';
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
test.afterAll(() => runSql(DROP_SQL));

const signUpButtons = (page: Page) => page.getByRole("button", { name: /^Sign up for / });
const dialog = (page: Page) => page.getByRole("dialog");

test.describe("the team lead", () => {
  test.use({ persona: "twoGroups" });

  test("adds a couple to the team in one go, and sees the block's Sunday count", async ({ page }) => {
    await page.goto(TEAM_PATH);
    await page.getByRole("button", { name: "Add person" }).click();
    await page.getByRole("button", { name: `Add ${householdPrimary.name} to Greeters` }).click();
    await expect(dialog(page)).toContainText(`Also add ${spouse.name}?`);
    await dialog(page).getByRole("button", { name: "Add both" }).click();
    await expect(page.getByText(`Added ${householdPrimary.name} and ${spouse.name} to Greeters.`)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: `Remove ${householdPrimary.name} from Greeters` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove ${spouse.name} from Greeters` })).toBeVisible();

    await page.getByRole("button", { name: "Team settings" }).click();
    await expect(dialog(page)).toContainText(`${SUNDAYS} Sundays`);
    await expect(dialog(page).getByRole("button", { name: "Set dates", pressed: true })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "1 more", pressed: true })).toBeVisible();
    await expect(dialog(page)).toContainText("Reminder email time");
    await expect(dialog(page)).toContainText("9:00 AM");
  });
});

test.describe("a couple on the team", () => {
  test.use({ persona: "householdPrimary" });

  test("is asked who is serving and about the next week, and books both for both", async ({ page }) => {
    runSql(CLEAR_SIGNUPS_SQL);
    await page.goto(TEAM_PATH);
    await expect(page.getByText(`${SUNDAYS} open dates through`)).toBeVisible();
    await expect(signUpButtons(page)).toHaveCount(SUNDAYS);

    await signUpButtons(page).first().click();
    await expect(dialog(page)).toContainText("Who's serving?");
    await expect(dialog(page)).toContainText("Also serve");
    await expect(dialog(page).getByRole("button", { name: "Me & Chloe", pressed: true })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Yes", pressed: true })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByText(/^You're signed up for .* and .*\.$/)).toBeVisible();
    await expect(page.getByText("You & Chloe")).toHaveCount(2);
    await expect(signUpButtons(page)).toHaveCount(SUNDAYS - 2);
    await expect(page.getByText(`${SUNDAYS - 2} open dates through`)).toBeVisible();

    // The last date of the block has nothing after it to ask about.
    await signUpButtons(page).last().click();
    await expect(dialog(page)).toContainText("Who's serving");
    await expect(dialog(page)).not.toContainText("Also serve");
    await dialog(page).getByRole("button", { name: "Just me" }).click();
    await expect(page.getByText("You", { exact: true })).toBeVisible();
  });

  test("cannot book a date outside the team's dates, even directly", async ({ page }) => {
    // The date is checked before the attendees, so the list only has to be non-empty.
    const outside = await page.request.post("/api/serving/signups", {
      data: { groupId: TEAM_ID, serviceDate: sundayAfterBlock(), attendeeProfileIds: ["not-checked-first"] },
    });
    expect(outside.status()).toBe(400);
    expect(await outside.json()).toEqual({ error: "That date is not one of the team's dates" });
    await page.goto(TEAM_PATH);
    await expect(signUpButtons(page)).toHaveCount(SUNDAYS - 3);
  });
});

/**
 * The Sunday after the block: the block's first Sunday plus its 30 weeks.
 * Mirrors SETUP_SQL, where a Sunday starts the block a week out.
 */
function sundayAfterBlock(): string {
  const today = new Date();
  const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  next.setUTCDate(next.getUTCDate() + (7 - next.getUTCDay()) + SUNDAYS * 7);
  return next.toISOString().slice(0, 10);
}

test.describe("the other spouse", () => {
  test.use({ persona: "spouse" });

  test("sees the dates as theirs and switches one to just them", async ({ page }) => {
    await page.goto(TEAM_PATH);
    await expect(page.getByText("You & Henry")).toHaveCount(2);
    await page.getByRole("button", { name: /^Change / }).first().click();
    await expect(dialog(page)).toContainText("Who's serving?");
    await dialog(page).getByRole("button", { name: "Just me" }).click();
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByText("You", { exact: true })).toHaveCount(1);
    await expect(page.getByText("You & Henry")).toHaveCount(1);
  });
});

test.describe("a team member with no spouse", () => {
  test.use({ persona: "oneGroup" });

  test("sees the couple by name, cannot change their date, and is only asked about the next week", async ({ page }) => {
    await page.goto(TEAM_PATH);
    await expect(page.getByText("Chloe Mockingham", { exact: true })).toBeVisible();
    await expect(page.getByText("Henry & Chloe Mockingham")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Change / })).toHaveCount(0);

    await signUpButtons(page).first().click();
    await expect(dialog(page)).toContainText("Also serve");
    await expect(dialog(page)).not.toContainText("Who's serving");
    await dialog(page).getByRole("button", { name: /^Just Sun, / }).click();
    await expect(page.getByText(/^You're signed up for [^.]*\.$/)).toBeVisible();
    await expect(page.getByText("You", { exact: true })).toBeVisible();
  });
});

test.describe("a team lead whose block is ending", () => {
  test.use({ persona: "twoGroups" });

  test("gets the To do on Home, and a member does not", async ({ page, browser, baseURL }) => {
    runSql(ENDING_SQL);
    await page.goto(`/g/${GROUP_B}/dashboard`);
    await expect(page.getByText("Greeters needs more dates")).toBeVisible();
    await expect(page.getByText(/^Last date is /)).toBeVisible();

    const { openAs } = await import("./fixtures/auth");
    const { context, page: member } = await openAs(browser, baseURL!, "oneGroup");
    await member.goto(`/g/${GROUP_B}/dashboard`);
    await expect(member.getByText("Greeters needs more dates")).toHaveCount(0);
    await context.close();
  });
});

test.describe("a member whose spouse has left the team", () => {
  test.use({ persona: "householdPrimary" });

  test("is not asked who is serving and signs up alone in one tap", async ({ page }) => {
    runSql(SPOUSE_OFF_TEAM_SQL);
    await page.goto(TEAM_PATH);
    await signUpButtons(page).first().click();
    await expect(page.getByText(/^You're signed up for [^.]*\.$/)).toBeVisible();
    await expect(page.getByText("Who's serving")).toHaveCount(0);
    await expect(page.getByText("You", { exact: true })).toBeVisible();
    await expect(page.getByText(`You & ${spouse.name.split(" ")[0]}`)).toHaveCount(0);
  });
});
