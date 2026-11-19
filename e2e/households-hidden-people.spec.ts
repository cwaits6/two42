import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, openAs, test } from "./fixtures/auth";
import { ORG_NAME } from "./fixtures/personas";

// The seed's Mockingham household (Henry primary, Chloe spouse, three children
// without accounts) and Placeholder household (Ethan alone). The seed has no
// household record claimed by a spouse, nor a household with no one with an
// account, so the hooks add Chloe's record and the Accountless household and
// delete them.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const MOCKINGHAM = "f0000000-0000-0000-0000-000000000005";
const CHLOE = "a0000000-0000-0000-0000-000000000112";
const HENRY = "a0000000-0000-0000-0000-000000000111";
const ETHAN = "a0000000-0000-0000-0000-000000000108";
const CLAIMED_RECORD = "d0000000-0000-0000-0000-0000000e2e04";
const NO_ACCOUNT_HOUSEHOLD = "f0000000-0000-0000-0000-0000000e2e05";
const NO_ACCOUNT_PERSON = "d0000000-0000-0000-0000-0000000e2e05";

const ORG = `(select org_id from public.family_units where id = '${MOCKINGHAM}')`;

const SEED_SQL = `
  delete from public.family_members where id in ('${CLAIMED_RECORD}', '${NO_ACCOUNT_PERSON}');
  delete from public.family_units where id = '${NO_ACCOUNT_HOUSEHOLD}';
  update public.profiles set is_unlisted = false where id in ('${HENRY}', '${CHLOE}', '${ETHAN}');
  update public.organizations set directory_visibility = 'shared_groups' where id = ${ORG};
`;

const SETUP_SQL = `
  insert into public.family_members
    (id, org_id, family_id, first_name, last_name, relationship, claimed_profile_id)
  values
    ('${CLAIMED_RECORD}', ${ORG}, '${MOCKINGHAM}', 'Chloe', 'Mockingham', 'spouse', '${CHLOE}');
  insert into public.family_units (id, org_id, family_name)
  values ('${NO_ACCOUNT_HOUSEHOLD}', ${ORG}, 'Accountless');
  insert into public.family_members (id, org_id, family_id, first_name, last_name, relationship)
  values ('${NO_ACCOUNT_PERSON}', ${ORG}, '${NO_ACCOUNT_HOUSEHOLD}', 'Rosie', 'Accountless', 'child');
  update public.organizations set directory_visibility = 'org' where id = ${ORG};
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

/** Opens Households with everyone in the church showing, the widest list a member gets. */
async function openEveryone(page: Page) {
  await page.goto("/directory/families");
  const scope = page.getByRole("combobox", { name: "Show people from" });
  await scope.click();
  await page.getByRole("option", { name: `Everyone in ${ORG_NAME}` }).click();
  await expect(scope).toContainText(`Everyone in ${ORG_NAME}`);
  await expect(row(page, "Seedly")).toBeVisible();
}

// A household row's name is its initial, the household name, then its adults.
const ROW_NAMES = {
  Accountless: /^[A-Z] Accountless\b/,
  Mockingham: /^[A-Z] Mockingham\b/,
  Placeholder: /^[A-Z] Placeholder\b/,
  Seedly: /^[A-Z] Seedly\b/,
} as const;

function row(page: Page, household: keyof typeof ROW_NAMES) {
  return page.getByRole("button", { name: ROW_NAMES[household] });
}

test.describe("what a member sees under Households", () => {
  test.use({ persona: "oneGroup" });

  test("a listed couple's row names both, and either name finds it", async ({ page }) => {
    await openEveryone(page);
    await expect(row(page, "Mockingham")).toContainText("Henry & Chloe");
    await page.getByLabel("Search households").fill("Chloe");
    await expect(row(page, "Mockingham")).toHaveCount(1);
  });

  test("a hidden spouse is not named and does not find the household", async ({ page }) => {
    runSql(`update public.profiles set is_unlisted = true where id = '${CHLOE}';`);
    await openEveryone(page);
    await expect(row(page, "Mockingham")).toHaveCount(1);
    await expect(row(page, "Mockingham")).not.toContainText("Chloe");
    await page.getByLabel("Search households").fill("Chloe");
    await expect(page.getByText("No households match your search.")).toBeVisible();
  });

  test("a household whose only person is hidden has no row", async ({ page }) => {
    await openEveryone(page);
    await expect(row(page, "Placeholder")).toHaveCount(1);
    runSql(`update public.profiles set is_unlisted = true where id = '${ETHAN}';`);
    await openEveryone(page);
    await expect(row(page, "Placeholder")).toHaveCount(0);
  });

  test("a household whose people with an account are all hidden has no row, and its children don't find it", async ({ page }) => {
    runSql(`update public.profiles set is_unlisted = true where id in ('${HENRY}', '${CHLOE}');`);
    await openEveryone(page);
    await expect(row(page, "Mockingham")).toHaveCount(0);
    await page.getByLabel("Search households").fill("Jack");
    await expect(page.getByText("No households match your search.")).toBeVisible();
  });

  test("its children's birthdays are not listed", async ({ page }) => {
    runSql(`update public.profiles set is_unlisted = true where id in ('${HENRY}', '${CHLOE}');`);
    await page.goto("/directory/birthdays");
    const scope = page.getByRole("combobox", { name: "Show people from" });
    await scope.click();
    await page.getByRole("option", { name: `Everyone in ${ORG_NAME}` }).click();
    await expect(scope).toContainText(`Everyone in ${ORG_NAME}`);
    await page.getByRole("switch", { name: "Also show household members" }).click();
    // Another household's child, so the list has loaded and a count of 0 is real.
    await expect(page.getByRole("link", { name: /Lily Sampleton/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Jack Mockingham/ })).toHaveCount(0);
  });

  test("a household with no one with an account keeps its row, and its child finds it", async ({ page }) => {
    await openEveryone(page);
    await expect(row(page, "Accountless")).toHaveCount(1);
    await page.getByLabel("Search households").fill("Rosie");
    await expect(row(page, "Accountless")).toHaveCount(1);
  });
});

test("a church admin still manages a household whose people with an account are all hidden", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not configured");
  runSql(`update public.profiles set is_unlisted = true where id in ('${HENRY}', '${CHLOE}');`);
  const admin = await openAs(browser, baseURL, "admin");
  try {
    await admin.page.goto("/admin/families");
    await admin.page.getByRole("button", { name: "Edit Mockingham" }).click();
    const dialog = admin.page.getByRole("dialog");
    await expect(dialog.getByText("Jack Mockingham").first()).toBeVisible();
  } finally {
    await admin.context.close();
  }
});
