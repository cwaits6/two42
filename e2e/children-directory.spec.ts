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

function removeAddedChild() {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c",
      `delete from public.family_members where family_id = '${HOUSEHOLD}' and first_name = '${ADDED_CHILD}';`],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(removeAddedChild);
test.afterAll(removeAddedChild);

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
