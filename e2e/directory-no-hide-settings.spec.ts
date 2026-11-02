import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, openAs, test } from "./fixtures/auth";
import { PERSONAS } from "./fixtures/personas";

// The seed's Mockingham household: Henry the primary, Chloe the spouse, sharing
// Group B with the viewer, Isaac. Its seeded numbers aren't valid enough for the
// household form to save, so the hooks give it real ones, then put the seed back.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const HOUSEHOLD = "f0000000-0000-0000-0000-000000000005";
const CHLOE = "a0000000-0000-0000-0000-000000000112";
const { spouse } = PERSONAS;

const HOUSEHOLD_CARD = `/directory/families?family=${HOUSEHOLD}`;
const CHLOE_CARD = `/directory/families?person=${CHLOE}`;
const ANNIVERSARIES = "/directory/anniversaries";
const NOTICE = "Everything you add here shows in the directory. Leave out anything you don't want shown.";
const WIDTHS = [390, 1280];

const SEED_SQL = `
  update public.family_units
     set phone_profile_id = null, phone_home = '555-0105',
         anniversary_month = 10, anniversary_day = 3, anniversary_year = 2009
   where id = '${HOUSEHOLD}';
  update public.profiles
     set phone_mobile = '555-0112', hide_anniversary = false, hide_email = false, is_unlisted = false
   where id = '${CHLOE}';
`;

// Two days out, so the date falls in This week in any church time zone.
const SOON_SQL = `
  update public.family_units
     set anniversary_month = extract(month from current_date + 2)::int,
         anniversary_day = extract(day from current_date + 2)::int,
         anniversary_year = 2009
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

test.beforeAll(() => {
  runSql(`${SEED_SQL}
    update public.family_units set phone_home = '+15125550105' where id = '${HOUSEHOLD}';
    update public.profiles set phone_mobile = '+15125550112' where id = '${CHLOE}';`);
});
test.afterAll(() => runSql(SEED_SQL));

/** The labels of every hide setting on the page. */
const hideSettings = (page: Page) =>
  page.getByRole("checkbox", { name: /^Hide/ }).evaluateAll((boxes) =>
    boxes.map((box) => (box as HTMLInputElement).labels?.[0]?.textContent?.trim()),
  );

const householdTab = (page: Page) => page.goto("/profile?tab=household");

async function chooseHouseholdPhone(page: Page, option: string | RegExp) {
  await householdTab(page);
  await page.getByRole("combobox", { name: "Household phone" }).click();
  await page.getByRole("option", { name: option }).click();
  await page.getByRole("button", { name: "Save household" }).click();
  await expect(page.getByText("Household saved.")).toBeVisible();
}

test.describe("what a spouse and a church admin can set", () => {
  test.use({ persona: "spouse" });

  for (const width of WIDTHS) {
    test(`no hide setting but email and the listing, at ${width}`, async ({ page, browser, baseURL }) => {
      if (!baseURL) throw new Error("baseURL is not configured");
      await page.setViewportSize({ width, height: 900 });

      await page.goto("/profile");
      await expect(page.getByLabel("First name")).toBeVisible();
      await expect(page.getByText(NOTICE)).toBeVisible();
      expect(await hideSettings(page)).toEqual([
        "Hide my email from the directory",
        "Hide me from the directory",
      ]);

      await householdTab(page);
      await expect(page.getByLabel("Household name")).toBeVisible();
      expect(await hideSettings(page)).toEqual([]);
      await expect(page.getByText("Privacy", { exact: true })).toHaveCount(0);

      const admin = await openAs(browser, baseURL, "admin");
      try {
        await admin.page.setViewportSize({ width, height: 900 });
        await admin.page.goto("/admin/families");
        await admin.page.getByRole("button", { name: /^Edit/ }).first().click();
        await expect(admin.page.getByLabel("Household name")).toBeVisible();
        await expect(admin.page.getByRole("switch")).toHaveCount(0);
        await expect(admin.page.getByText("Household privacy")).toHaveCount(0);
      } finally {
        await admin.context.close();
      }
    });
  }
});

test.describe("what a member in the same group sees", () => {
  test.use({ persona: "oneGroup" });

  test("a yearless anniversary shows its month and day, with no Married", async ({ page }) => {
    runSql(`update public.family_units set anniversary_year = null where id = '${HOUSEHOLD}';`);

    await page.goto(HOUSEHOLD_CARD);
    await expect(page.getByText("Anniversary — October 3", { exact: true })).toBeVisible();

    await page.goto(ANNIVERSARIES);
    const row = page.getByRole("link", { name: /Mockingham/ });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Married/)).toHaveCount(0);
  });

  test("a couple where a spouse hid it through the old app is on no filter", async ({ page }) => {
    runSql(SOON_SQL);
    for (const filter of ["", "?when=week"]) {
      await page.goto(`${ANNIVERSARIES}${filter}`);
      await expect(page.getByRole("link", { name: /Mockingham/ })).toBeVisible();
    }

    runSql(`update public.profiles set hide_anniversary = true where id = '${CHLOE}';`);
    try {
      for (const filter of ["", "?when=week", "?when=month"]) {
        await page.goto(`${ANNIVERSARIES}${filter}`);
        // The list renders only once the directory has loaded, so this count is real.
        await expect(page.getByLabel("Show anniversaries from")).toBeVisible();
        await expect(page.getByRole("link", { name: /Mockingham/ })).toHaveCount(0);
      }
      await page.goto(HOUSEHOLD_CARD);
      await expect(page.getByRole("heading", { name: "Mockingham" })).toBeVisible();
      await expect(page.getByText(/^Anniversary/)).toHaveCount(0);
    } finally {
      runSql(`update public.profiles set hide_anniversary = false where id = '${CHLOE}';`);
    }
  });

  test("the email setting takes the email off the card", async ({ page }) => {
    await page.goto(CHLOE_CARD);
    await expect(page.getByRole("link", { name: spouse.email })).toBeVisible();

    runSql(`update public.profiles set hide_email = true where id = '${CHLOE}';`);
    await page.goto(CHLOE_CARD);
    await expect(page.getByRole("heading", { name: spouse.name })).toBeVisible();
    await expect(page.getByText(spouse.email)).toHaveCount(0);
    runSql(`update public.profiles set hide_email = false where id = '${CHLOE}';`);
  });

  test("the listing setting takes that person out of the directory", async ({ page }) => {
    await page.goto("/directory");
    await expect(page.getByRole("link", { name: /Chloe/ }).or(page.getByRole("button", { name: /Chloe/ })).first()).toBeVisible();

    runSql(`update public.profiles set is_unlisted = true where id = '${CHLOE}';`);
    await page.goto("/directory");
    await expect(page.getByRole("button", { name: /Henry/ }).or(page.getByRole("link", { name: /Henry/ })).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Chloe/ }).or(page.getByRole("button", { name: /Chloe/ }))).toHaveCount(0);
    runSql(`update public.profiles set is_unlisted = false where id = '${CHLOE}';`);
  });

  test("the household phone follows the spouse who chose it, and either spouse can clear it", async ({ page, browser, baseURL }) => {
    if (!baseURL) throw new Error("baseURL is not configured");

    await page.goto(HOUSEHOLD_CARD);
    await expect(page.getByRole("link", { name: "(512) 555-0105" })).toBeVisible();
    await expect(page.getByText("home", { exact: true })).toBeVisible();

    const chloe = await openAs(browser, baseURL, "spouse");
    const henry = await openAs(browser, baseURL, "householdPrimary");
    try {
      await chooseHouseholdPhone(chloe.page, /^My mobile/);
      await page.goto(HOUSEHOLD_CARD);
      await expect(page.getByText("Chloe's mobile", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "(512) 555-0105" })).toHaveCount(0);

      // The other spouse can only keep or clear the choice, never make it.
      await householdTab(henry.page);
      await henry.page.getByRole("combobox", { name: "Household phone" }).click();
      await expect(henry.page.getByRole("option", { name: "Chloe's mobile" })).toBeVisible();
      await henry.page.keyboard.press("Escape");

      // Clearing the number on the profile clears the household phone with it.
      await chloe.page.goto("/profile");
      await chloe.page.getByLabel(/^Mobile phone/).fill("");
      await chloe.page.getByRole("button", { name: "Save changes" }).click();
      await expect(chloe.page.getByText("Profile saved.")).toBeVisible();
      await page.goto(HOUSEHOLD_CARD);
      await expect(page.getByRole("heading", { name: "Mockingham" })).toBeVisible();
      await expect(page.getByText("Chloe's mobile", { exact: true })).toHaveCount(0);

      // With the number back, the other spouse clears the choice for both.
      runSql(`update public.profiles set phone_mobile = '+15125550112' where id = '${CHLOE}';`);
      await page.goto(HOUSEHOLD_CARD);
      await expect(page.getByRole("link", { name: "(512) 555-0112" }).last()).toBeVisible();
      await expect(page.getByText("Chloe's mobile", { exact: true })).toBeVisible();

      await chooseHouseholdPhone(henry.page, "Shared home phone");
      await page.goto(HOUSEHOLD_CARD);
      await expect(page.getByRole("heading", { name: "Mockingham" })).toBeVisible();
      await expect(page.getByText("Chloe's mobile", { exact: true })).toHaveCount(0);
      await expect(page.getByText("home", { exact: true })).toHaveCount(0);
    } finally {
      await chloe.context.close();
      await henry.context.close();
    }
  });
});
