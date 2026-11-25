import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, GROUP_C, PERSONAS } from "./fixtures/personas";

// The seed has no dinner club, so the hooks turn Group B's on and build a
// published season through the stack's own Postgres container: Henry and
// Chloe host Isaac at one table, Leo hosts his own, and the church admin, a
// member of Group B, is at none. afterAll deletes the season, which takes
// every row under it, and turns the switch back off.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const SEASON = "d1000000-0000-4000-8000-000000000001";
const DATE = "d1000000-0000-4000-8000-000000000002";
const HOSTS = "d1000000-0000-4000-8000-000000000011";
const GUEST = "d1000000-0000-4000-8000-000000000012";
const OTHER_HOST = "d1000000-0000-4000-8000-000000000013";
const TABLE_ONE = "d1000000-0000-4000-8000-000000000021";
const TABLE_TWO = "d1000000-0000-4000-8000-000000000022";
const TITLE = "Fixture Supper Club";
const OWN_ADDRESS = "12 Fixture Lane";
const OTHER_ADDRESS = "48 Sample Row";
const PAGE = `/g/${GROUP_B}/dinner-club`;

const DROP_SQL = `
  delete from public.dinner_seasons where id = '${SEASON}';
  update public.group_settings set dinner_club_enabled = false where group_id = '${GROUP_B}';
  delete from public.dinner_feed_tokens
    where profile_id = (select id from public.profiles where email = '${PERSONAS.oneGroup.email}');
`;

const SETUP_SQL = `
  ${DROP_SQL}
  insert into public.group_settings (org_id, group_id, dinner_club_enabled)
    select org_id, id, true from public.groups where id = '${GROUP_B}'
    on conflict (group_id) do update set dinner_club_enabled = true;
  insert into public.dinner_seasons (id, org_id, group_id, title, format, status, starts_on, ends_on,
      repeat_kind, repeat_weeks, weekday, signup_closes_on, published_at)
    select '${SEASON}', org_id, id, '${TITLE}', 'same_table_one_host', 'published', current_date - 1,
      current_date + 60, 'weeks', 4, 6, current_date - 1, now()
    from public.groups where id = '${GROUP_B}';
  insert into public.dinner_season_dates (id, org_id, season_id, group_id, starts_at)
    select '${DATE}', org_id, '${SEASON}', group_id, date_trunc('day', now()) + interval '10 days 23 hours'
    from public.dinner_seasons where id = '${SEASON}';
  insert into public.dinner_parties (id, org_id, season_id, group_id, can_host, seats)
    select v.id::uuid, s.org_id, s.id, s.group_id, v.host, case when v.host then 8 end
    from public.dinner_seasons s
    cross join (values ('${HOSTS}', true), ('${GUEST}', false), ('${OTHER_HOST}', true)) v(id, host)
    where s.id = '${SEASON}';
  insert into public.dinner_party_members (org_id, party_id, profile_id, season_id, group_id)
    select s.org_id, v.party::uuid, p.id, s.id, s.group_id
    from public.dinner_seasons s
    cross join (values
      ('${HOSTS}', '${PERSONAS.householdPrimary.email}'),
      ('${HOSTS}', '${PERSONAS.spouse.email}'),
      ('${GUEST}', '${PERSONAS.oneGroup.email}'),
      ('${OTHER_HOST}', '${PERSONAS.twoGroups.email}')) v(party, email)
    join public.profiles p on p.email = v.email and p.org_id = s.org_id
    where s.id = '${SEASON}';
  insert into public.dinner_party_addresses (org_id, party_id, season_id, group_id, address_line1, city)
    select s.org_id, v.party::uuid, s.id, s.group_id, v.line, 'Springfield'
    from public.dinner_seasons s
    cross join (values ('${HOSTS}', '${OWN_ADDRESS}'), ('${OTHER_HOST}', '${OTHER_ADDRESS}')) v(party, line)
    where s.id = '${SEASON}';
  insert into public.dinner_tables (id, org_id, season_id, group_id, position)
    select v.id::uuid, s.org_id, s.id, s.group_id, v.pos
    from public.dinner_seasons s
    cross join (values ('${TABLE_ONE}', 1), ('${TABLE_TWO}', 2)) v(id, pos)
    where s.id = '${SEASON}';
  insert into public.dinner_seats (org_id, table_id, party_id, season_id, group_id)
    select s.org_id, v.tbl::uuid, v.party::uuid, s.id, s.group_id
    from public.dinner_seasons s
    cross join (values ('${TABLE_ONE}', '${HOSTS}'), ('${TABLE_ONE}', '${GUEST}'), ('${TABLE_TWO}', '${OTHER_HOST}')) v(tbl, party)
    where s.id = '${SEASON}';
  insert into public.dinners (org_id, season_id, group_id, table_id, season_date_id, starts_at, host_party_id)
    select s.org_id, s.id, s.group_id, v.tbl::uuid, d.id, d.starts_at, v.host::uuid
    from public.dinner_seasons s
    join public.dinner_season_dates d on d.season_id = s.id
    cross join (values ('${TABLE_ONE}', '${HOSTS}'), ('${TABLE_TWO}', '${OTHER_HOST}')) v(tbl, host)
    where s.id = '${SEASON}';
`;

function runSql(sql: string) {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(() => runSql(SETUP_SQL));
test.afterAll(() => runSql(DROP_SQL));

test.describe("a guest at a published table", () => {
  test.use({ persona: "oneGroup" });

  test("sees their own host's address and not another table's", async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
    await expect(page.getByText(OWN_ADDRESS)).toBeVisible();
    await expect(page.getByText(/^(Henry and Chloe|Chloe and Henry)$/)).toBeVisible();
    await expect(page.getByText(OTHER_ADDRESS)).toHaveCount(0);
    await expect(page.getByText(PERSONAS.twoGroups.name)).toHaveCount(0);
  });

  test("finds no dinner on the group calendar", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/calendar`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(TITLE)).toHaveCount(0);
    await expect(page.getByText(OWN_ADDRESS)).toHaveCount(0);
  });

  test("gets their own dinners in their calendar link, and nothing once it is reset", async ({ page }) => {
    await page.goto(PAGE);
    await page.getByRole("button", { name: "Get calendar link" }).click();
    const link = page.getByRole("textbox", { name: "Your calendar link" });
    await expect(link).toHaveValue(/\/api\/dinner-club\/feed\.ics\?token=/);
    const first = await link.inputValue();

    const feed = await page.request.get(first);
    expect(feed.status()).toBe(200);
    expect(feed.headers()["cache-control"]).toMatch(/^private/);
    const body = await feed.text();
    expect(body).toContain(OWN_ADDRESS);
    expect(body).not.toContain(OTHER_ADDRESS);

    await page.getByRole("button", { name: "Reset link" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset link" }).click();
    await expect(link).not.toHaveValue(first);

    const old = await page.request.get(first);
    expect(old.status()).toBe(401);
    expect(await old.text()).not.toContain("VEVENT");
  });
});

test.describe("a member of the group at no table", () => {
  test.use({ persona: "admin" });

  test("sees no address at all", async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.getByText("You're not at a table this season.")).toBeVisible();
    await expect(page.getByText(OWN_ADDRESS)).toHaveCount(0);
    await expect(page.getByText(OTHER_ADDRESS)).toHaveCount(0);
  });
});

test.describe("someone outside the group", () => {
  test.use({ persona: "leadsC" });

  test("gets a 404 for the group's dinner club", async ({ page }) => {
    const response = await page.goto(PAGE);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(OWN_ADDRESS)).toHaveCount(0);
  });
});

test.describe("the group switch", () => {
  test.use({ persona: "twoGroups" });

  test("puts Dinner club in the menu of the group that turned it on only", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await page.goto(`/g/${GROUP_B}/announcements`);
    await expect(nav.getByRole("link", { name: "Dinner club", exact: true })).toBeVisible();
    await page.goto(`/g/${GROUP_C}/announcements`);
    await expect(nav.getByRole("link", { name: "Group settings" }).or(nav.getByRole("link", { name: "About" }))).toBeVisible();
    await expect(nav.getByRole("link", { name: "Dinner club", exact: true })).toHaveCount(0);
    expect((await page.goto(`/g/${GROUP_C}/dinner-club`))?.status()).toBe(404);
  });

  test("turned off, hides the page and keeps the season", async ({ page }) => {
    runSql(`update public.group_settings set dinner_club_enabled = false where group_id = '${GROUP_B}';`);
    try {
      expect((await page.goto(PAGE))?.status()).toBe(404);
    } finally {
      runSql(`update public.group_settings set dinner_club_enabled = true where group_id = '${GROUP_B}';`);
    }
    await page.goto(PAGE);
    await expect(page.getByText(OTHER_ADDRESS)).toBeVisible();
  });
});
