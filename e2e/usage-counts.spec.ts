import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, openAs, test } from "./fixtures/auth";
import { GROUP_B, ORG_NAME } from "./fixtures/personas";

// Counts are read and written through the stack's Postgres container, the
// name `supabase start` gives it from config.toml's project_id. The fixture
// rows sit 89 days back, inside the 90-day list and outside the 7-day one,
// under patterns usage_count_record() refuses, so no visit can add to them
// and deleting them never removes a real count.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const ORG = `(select id from public.organizations where name = '${ORG_NAME}')`;
const FIXTURE_DATE = "(now() at time zone 'utc')::date - 89";
const FIXTURES: Array<[kind: string, pattern: string, total: number]> = [
  ["view", "/e2e-usage-fixture/large", 4200],
  ["view", "/e2e-usage-fixture/small", 3],
  ["error", "/e2e-usage-fixture/error", 2],
];

function sql(query: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-qAt", "-c", query],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

function removeFixtures() {
  for (const [kind, pattern] of FIXTURES) {
    sql(`delete from public.usage_counts where org_id = ${ORG} and usage_date = ${FIXTURE_DATE}
      and kind = '${kind}' and pattern = '${pattern}'`);
  }
}

function todaysViews(pattern: string): number {
  return Number(sql(`select coalesce(sum(total), 0) from public.usage_counts
    where org_id = ${ORG} and kind = 'view' and pattern = '${pattern}'
      and usage_date = (now() at time zone 'utc')::date`));
}

test.beforeAll(() => {
  removeFixtures();
  for (const [kind, pattern, total] of FIXTURES) {
    sql(`insert into public.usage_counts (org_id, usage_date, kind, pattern, total)
      values (${ORG}, ${FIXTURE_DATE}, '${kind}', '${pattern}', ${total})`);
  }
});
test.afterAll(() => removeFixtures());

test("a member can't open the Usage page", async ({ browser, baseURL }) => {
  const { context, page } = await openAs(browser, baseURL!, "oneGroup");
  await page.goto("/admin/usage");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Most opened pages" })).toHaveCount(0);
  await context.close();
});

test("opening an invite page and a group page counts their patterns and stores no token or id", async ({
  browser,
  baseURL,
}) => {
  const token = randomUUID();
  const before = { invite: todaysViews("/join/[token]"), calendar: todaysViews("/g/[groupId]/calendar") };

  const { context, page } = await openAs(browser, baseURL!, "oneGroup");
  await page.goto(`/join/${token}`);
  await expect.poll(() => todaysViews("/join/[token]")).toBeGreaterThan(before.invite);
  await page.goto(`/g/${GROUP_B}/calendar`);
  await expect.poll(() => todaysViews("/g/[groupId]/calendar")).toBeGreaterThan(before.calendar);
  await context.close();

  expect(sql(`select count(*) from public.usage_counts u
    where u::text like '%${token}%' or u::text like '%${GROUP_B}%'`)).toBe("0");
  expect(sql(`select count(*) from public.usage_counts
    where org_id = ${ORG} and pattern ~ '[0-9a-f]{8}-[0-9a-f]{4}-'`)).toBe("0");
});

for (const width of [390, 1280]) {
  test(`a church admin sees the church's counts at ${width}, with small ones as fewer than 5`, async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await openAs(browser, baseURL!, "admin");
    await page.setViewportSize({ width, height: 900 });

    await page.goto("/admin/usage?days=90");
    await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
    const large = page.getByRole("listitem").filter({ hasText: "/e2e-usage-fixture/large" });
    const small = page.getByRole("listitem").filter({ hasText: "/e2e-usage-fixture/small" });
    const error = page.getByRole("listitem").filter({ hasText: "/e2e-usage-fixture/error" });
    await expect(large).toContainText("4,200");
    await expect(small).toContainText("fewer than 5");
    await expect(error).toContainText("fewer than 5");

    await page.getByRole("link", { name: "Last 7 days" }).click();
    await expect(page).toHaveURL(/days=7$/);
    await expect(small).toHaveCount(0);
    await context.close();
  });
}
