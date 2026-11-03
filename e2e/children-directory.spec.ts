import { execFileSync } from "node:child_process";
import { expect, openAs, test } from "./fixtures/auth";

// The seed's Mockingham household: Henry the primary, Chloe the spouse, and Jack,
// Sophie and Ben with no accounts, sharing Group B with the viewer, Isaac.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const HOUSEHOLD = "f0000000-0000-0000-0000-000000000005";
const HOUSEHOLD_CARD = `/directory/families?family=${HOUSEHOLD}`;
const ADDED_CHILD = "Nameonly";
const NOTICE = "Everything you add here shows in the directory. Leave out anything you don't want shown.";
const CHILD_NOTICE = /You don't have to list a child\. .*can't be invited to their own account/;
const AGE_NOTICE = "You must be 13 or older to have an account.";
const INVITED_ADULT = "Invitedadult";
const FAMILY_INVITE_TOKEN = "e2e00000-0000-4000-8000-000000000156";
const SIGNUP_TOKEN = "e2e-children-directory-signup-token";

function runSql(sql: string) {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

// Deleting the household member takes their invite with it.
function removeAddedRows() {
  runSql(`
    delete from public.access_requests where signup_token = '${SIGNUP_TOKEN}';
    delete from public.family_members where family_id = '${HOUSEHOLD}'
      and first_name in ('${ADDED_CHILD}', '${INVITED_ADULT}');
  `);
}

test.beforeAll(removeAddedRows);
test.afterAll(removeAddedRows);

test.describe("a parent adding a child", () => {
  test.use({ persona: "householdPrimary" });

  test("the form says what's shown, asks for no year, and keeps the year for an adult", async ({ page }) => {
    await page.goto("/household");
    for (const child of ["Jack Mockingham", "Sophie Mockingham", "Ben Mockingham"]) {
      await expect(page.getByText(child).first()).toBeVisible();
    }

    await page.getByRole("button", { name: "Add someone without an account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(NOTICE)).toBeVisible();
    await expect(dialog.getByText(CHILD_NOTICE)).toBeVisible();
    await expect(dialog.getByLabel("Year")).toHaveCount(0);
    // Leaving someone out is the only way to keep them out of the directory.
    await expect(dialog.getByRole("switch")).toHaveCount(0);
    await expect(dialog.getByRole("checkbox", { name: /^Hide/ })).toHaveCount(0);

    await dialog.getByRole("combobox", { name: "Relationship" }).click();
    await page.getByRole("option", { name: "Spouse" }).click();
    await expect(dialog.getByLabel("Year")).toBeVisible();
    await expect(dialog.getByText(CHILD_NOTICE)).toHaveCount(0);

    await dialog.getByRole("combobox", { name: "Relationship" }).click();
    await page.getByRole("option", { name: "Child" }).click();
    await expect(dialog.getByLabel("Year")).toHaveCount(0);

    await dialog.getByLabel("First name").fill(ADDED_CHILD);
    await dialog.getByRole("button", { name: "Add to household" }).click();
    await expect(page.getByText(`${ADDED_CHILD} added.`, { exact: false })).toBeVisible();
    await expect(page.getByText(`${ADDED_CHILD} Mockingham`).first()).toBeVisible();
  });
});

test.describe("another member in the same group", () => {
  test.use({ persona: "oneGroup" });

  test("sees a name-only child by name, and nothing else about a child", async ({ page }) => {
    await page.goto(HOUSEHOLD_CARD);
    await expect(page.getByRole("heading", { name: "Mockingham" })).toBeVisible();
    for (const child of [`${ADDED_CHILD} Mockingham`, "Jack Mockingham", "Sophie Mockingham", "Ben Mockingham"]) {
      await expect(page.getByText(child, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Child", { exact: true })).toHaveCount(0);
    for (const year of ["2012", "2014", "2017"]) {
      await expect(page.getByText(year)).toHaveCount(0);
    }
  });

  test("sees a child's birthday only if a parent entered one, with no year", async ({ page }) => {
    await page.goto("/directory/birthdays");
    await page.getByRole("switch", { name: "Also show household members" }).click();
    const jack = page.getByRole("link", { name: /Jack Mockingham/ });
    await expect(jack).toBeVisible();
    await expect(jack).toContainText("March 3");
    await expect(jack).not.toContainText("2012");
    await expect(page.getByText(`${ADDED_CHILD} Mockingham`)).toHaveCount(0);
  });
});

test("a church admin still lists a household's children with their labels", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not configured");
  const admin = await openAs(browser, baseURL, "admin");
  try {
    await admin.page.goto("/admin/families");
    await admin.page.getByRole("button", { name: "Edit Mockingham" }).click();
    const dialog = admin.page.getByRole("dialog");
    await expect(dialog.getByText("Jack Mockingham").first()).toBeVisible();
    await expect(dialog.getByText(`${ADDED_CHILD} Mockingham`).first()).toBeVisible();
    await expect(dialog.getByText("· Child").first()).toBeVisible();
    await dialog.getByRole("button", { name: "Add someone" }).click();
    await expect(dialog.getByText(CHILD_NOTICE)).toBeVisible();
    await expect(dialog.getByLabel("Birthday year")).toHaveCount(0);
  } finally {
    await admin.context.close();
  }
});

test("every form that creates an account states the 13 or older requirement", async ({ browser, baseURL }) => {
  runSql(`
    with household as (
      select id, org_id from public.family_units where id = '${HOUSEHOLD}'
    ), adult as (
      insert into public.family_members (family_id, org_id, first_name, relationship)
      select id, org_id, '${INVITED_ADULT}', 'other' from household
      returning id, family_id, org_id
    )
    insert into public.family_invites (family_member_id, family_id, org_id, invite_email, token)
    select id, family_id, org_id, 'invited-adult@example.test', '${FAMILY_INVITE_TOKEN}' from adult;
    insert into public.access_requests (name, email, status, signup_token, token_expires_at, org_id)
    select '${INVITED_ADULT}', 'signup-notice@example.test', 'approved', '${SIGNUP_TOKEN}',
      now() + interval '1 hour', org_id
    from public.family_units where id = '${HOUSEHOLD}';
  `);

  const anonymous = await browser.newContext({ baseURL });
  try {
    const page = await anonymous.newPage();
    await page.goto(`/join/family/${FAMILY_INVITE_TOKEN}`);
    await expect(page.getByRole("heading", { name: "Join your household" })).toBeVisible();
    await expect(page.getByText(AGE_NOTICE)).toBeVisible();

    await page.goto(`/setup-account?token=${SIGNUP_TOKEN}`);
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await expect(page.getByText(AGE_NOTICE)).toBeVisible();
  } finally {
    await anonymous.close();
  }
});
