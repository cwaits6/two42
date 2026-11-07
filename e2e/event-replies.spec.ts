import { execFileSync } from "node:child_process";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS } from "./fixtures/personas";

// A reply is for one date: each date of the seeded weekly Sunday Class (Group
// B) shows its own reply, and Who's coming lists that date's replies only.
// The seed holds no reply on Sunday Class; the hooks clear any left from a
// run and add two Group B events that have ended, each with Zoe's Yes on its
// first date. Every page is read at phone width, where the calendar opens in
// List.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const SUNDAY_CLASS = "e0000000-0000-0000-0000-000000000002";
const PAST_ONCE = "e2180000-0000-0000-0000-000000000001";
const PAST_SERIES = "e2180000-0000-0000-0000-000000000002";
const CALENDAR = `/g/${GROUP_B}/calendar`;
const PHONE = { width: 390, height: 844 };
const { oneGroup, leadsB } = PERSONAS;

const CLEAR_SQL = `
  delete from public.events where id in ('${PAST_ONCE}', '${PAST_SERIES}');
  delete from public.rsvps where event_id = '${SUNDAY_CLASS}'
    and user_id in (select id from public.profiles where email in ('${oneGroup.email}', '${leadsB.email}'));
`;

const SETUP_SQL = `
  ${CLEAR_SQL}
  insert into public.events (id, org_id, group_id, calendar_id, title, start_time, end_time)
    select '${PAST_ONCE}', org_id, group_id, calendar_id, 'Fall supper', now() - interval '1 day 2 hours', now() - interval '1 day'
    from public.events where id = '${SUNDAY_CLASS}';
  insert into public.events (id, org_id, group_id, calendar_id, title, start_time, end_time,
                             recurrence_frequency, recurrence_end_mode, recurrence_until)
    select '${PAST_SERIES}', org_id, group_id, calendar_id, 'Weeknight study',
           now() - interval '21 days 2 hours', now() - interval '21 days 1 hour',
           'weekly', 'until', now() - interval '1 day'
    from public.events where id = '${SUNDAY_CLASS}';
  insert into public.rsvps (org_id, event_id, user_id, status, occurrence_date)
    select p.org_id, e.id, p.id, 'yes', (e.start_time at time zone o.timezone)::date
    from public.profiles p
    join public.events e on e.org_id = p.org_id
    join public.organizations o on o.id = e.org_id
    where p.email = '${leadsB.email}' and e.id in ('${PAST_ONCE}', '${PAST_SERIES}');
`;

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-Atq", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

test.beforeAll(() => {
  sql(SETUP_SQL);
});
test.afterAll(() => {
  sql(CLEAR_SQL);
});

const replyGroups = (page: Page) => page.getByRole("group", { name: "Your reply" });
const chosen = (page: Page, index: number) =>
  replyGroups(page).nth(index).locator('button[aria-pressed="true"]');
/** Picks a reply and waits for the save, which the control shows before it lands. */
async function answer(page: Page, group: Locator, reply: string) {
  const saved = page.waitForResponse((r) => r.url().includes("/rpc/rsvp_set"));
  await group.getByRole("button", { name: reply }).click();
  expect((await saved).ok()).toBe(true);
}
const dateLinks = (page: Page) => page.getByRole("link", { name: "Sunday Class", exact: true });

/** The names under Who's coming, or none when nobody has said they are. */
async function whosComing(page: Page): Promise<string[]> {
  const heading = page.getByRole("heading", { name: "Who's coming" });
  if ((await heading.count()) === 0) return [];
  const strip = page.locator("div").filter({ has: heading }).filter({ has: page.getByRole("listitem") }).last();
  // Each row is the person's initials, hidden from assistive tech, then their name.
  return strip.locator("li > span:first-of-type").allTextContents();
}

/** The first two Sunday Class dates' pages, from the list. */
async function firstTwoDates(page: Page): Promise<[string, string]> {
  await page.goto(CALENDAR);
  const first = await dateLinks(page).nth(0).getAttribute("href");
  const second = await dateLinks(page).nth(1).getAttribute("href");
  if (!first || !second) throw new Error("Sunday Class has fewer than two upcoming dates");
  return [first, second];
}

test.describe("a member of Group B on the calendar list", () => {
  test.use({ persona: "oneGroup", viewport: PHONE });

  test("answers one date, and the next date stays unanswered", async ({ page }) => {
    await page.goto(CALENDAR);
    await expect(replyGroups(page)).toHaveCount(10);
    await answer(page, replyGroups(page).nth(0), "Going");
    await expect(chosen(page, 0)).toHaveText("Going");

    await page.reload();
    await expect(chosen(page, 0)).toHaveText("Going");
    await expect(chosen(page, 1)).toHaveCount(0);
  });

  test("sees ten dates and reaches later months with Show more dates", async ({ page }) => {
    await page.goto(CALENDAR);
    await expect(dateLinks(page)).toHaveCount(10);
    await page.getByRole("button", { name: "Show more dates" }).click();
    await expect(dateLinks(page)).toHaveCount(20);
    const days = await page.getByText(/^Sunday, [A-Z][a-z]+ \d{1,2}, \d{4}$/).allTextContents();
    const months = new Set(days.map((d) => d.split(" ")[1]));
    expect(days).toHaveLength(20);
    expect(months.size).toBeGreaterThanOrEqual(4);
  });
});

test.describe("the leader of Group B on a date's page", () => {
  test.use({ persona: "leadsB", viewport: PHONE });

  test("answers the second date, and each date lists only its own people", async ({ page }) => {
    const [first, second] = await firstTwoDates(page);
    await page.goto(second);
    await answer(page, page.getByRole("group", { name: "Your reply" }), "Going");
    await expect(page.getByRole("group", { name: "Your reply" }).locator('[aria-pressed="true"]')).toHaveText("Going");

    await page.reload();
    expect(await whosComing(page)).toEqual([leadsB.name]);
    await page.goto(first);
    expect(await whosComing(page)).toEqual([oneGroup.name]);
  });

  test("sees who came to a past event, with no reply buttons", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/calendar/${PAST_ONCE}`);
    await expect(page.getByRole("heading", { name: "Fall supper" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Your reply" })).toHaveCount(0);
    expect(await whosComing(page)).toEqual([leadsB.name]);
  });

  test("sees who came to a past date of a repeating event, with no reply buttons", async ({ page }) => {
    const start = sql(
      `select to_char(start_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.events where id = '${PAST_SERIES}'`,
    );
    await page.goto(`/g/${GROUP_B}/calendar/${PAST_SERIES}?occurrence=${encodeURIComponent(start)}`);
    await expect(page.getByRole("heading", { name: "Weeknight study" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Your reply" })).toHaveCount(0);
    expect(await whosComing(page)).toEqual([leadsB.name]);
  });
});

test.describe("a member choosing their reply again", () => {
  test.use({ persona: "oneGroup", viewport: PHONE });

  test("clears it for that date only", async ({ page }) => {
    const [first, second] = await firstTwoDates(page);
    await page.goto(first);
    const reply = page.getByRole("group", { name: "Your reply" });
    const going = reply.getByRole("button", { name: "Going" });
    await expect(going).toHaveAttribute("aria-pressed", "true");
    await answer(page, reply, "Going");
    await expect(going).toHaveAttribute("aria-pressed", "false");

    await page.reload();
    expect(await whosComing(page)).toEqual([]);
    await page.goto(second);
    expect(await whosComing(page)).toEqual([leadsB.name]);
  });
});

test.describe("a member answering a second date on the calendar list", () => {
  test.use({ persona: "oneGroup", viewport: PHONE });

  // While a person holds one reply per event, the second answer moves the
  // first; the list must show that without a reload.
  test("sees the first date's control follow the save", async ({ page }) => {
    await page.goto(CALENDAR);
    await answer(page, replyGroups(page).nth(0), "Going");
    await expect(chosen(page, 0)).toHaveText("Going");
    await answer(page, replyGroups(page).nth(1), "Can't go");
    await expect(chosen(page, 1)).toHaveText("Can't go");
    await expect(chosen(page, 0)).toHaveCount(0);
  });
});
