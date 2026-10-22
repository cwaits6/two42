import type { BrowserContext, Page } from "@playwright/test";
import { expect, openAs, test } from "./fixtures/auth";
import { ORG_NAME } from "./fixtures/personas";

// The switch mutates the org row every other spec reads, so the two tests
// run in order and the hooks leave the setting off whatever happens between.
test.describe.configure({ mode: "serial" });

const EVERYONE = `Everyone in ${ORG_NAME}`;
const ON_TOAST = "Members can now see everyone in the organization.";
const OFF_TOAST = "Members now see only people who share a group with them.";

let admin: { context: BrowserContext; page: Page };

function visibilitySwitch(page: Page) {
  return page.getByRole("switch", { name: "Directory visible to the whole organization" });
}

async function setOrgWide(page: Page, on: boolean) {
  await page.goto("/admin/settings");
  const control = visibilitySwitch(page);
  await expect(control).toBeVisible();
  if ((await control.isChecked()) === on) return;
  await control.click();
  await expect(page.getByText(on ? ON_TOAST : OFF_TOAST)).toBeVisible();
  await expect(control).toBeChecked({ checked: on });
}

test.beforeAll(async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL is not configured");
  admin = await openAs(browser, baseURL, "admin");
  await setOrgWide(admin.page, false);
});

test.afterAll(async () => {
  await setOrgWide(admin.page, false);
  await admin.context.close();
});

test.describe("a member of one group", () => {
  test.use({ persona: "oneGroup" });

  test("gains everyone when the org opens its directory, with outsiders marked", async ({ page }) => {
    await setOrgWide(admin.page, true);

    await page.goto("/directory");
    const scope = page.getByRole("combobox", { name: "Show people from" });
    await scope.click();
    await page.getByRole("option", { name: EVERYONE }).click();
    await expect(scope).toContainText(EVERYONE);

    const outsider = page.getByRole("button", { name: "Ava Sampleton" });
    await expect(outsider).toBeVisible();
    await expect(outsider).toContainText("Not in any of your groups");

    const groupmate = page.getByRole("button", { name: "Zoe Dummyfield" });
    await expect(groupmate).toBeVisible();
    await expect(groupmate).not.toContainText("Not in any of your groups");
  });

  test("loses the option, not just the ability, when the org closes it again", async ({ page }) => {
    await setOrgWide(admin.page, false);

    await page.goto("/directory");
    await expect(page.getByRole("button", { name: "Zoe Dummyfield" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Show people from" })).toHaveCount(0);
    await expect(page.getByText(EVERYONE)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ava Sampleton" })).toHaveCount(0);
  });
});
