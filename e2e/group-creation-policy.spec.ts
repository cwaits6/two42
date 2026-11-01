import type { BrowserContext, Page } from "@playwright/test";
import { expect, openAs, test } from "./fixtures/auth";

// The select mutates the org row every other spec reads, so the tests run
// in order and the hooks leave the setting at the seed default (approval)
// whatever happens between. Nothing here creates a group or files a
// request: that would leave rows on the shared local stack.
test.describe.configure({ mode: "serial" });

const CREATE = "Create a group";
const REQUEST = "Request a group";

type PolicyLabel = "Open" | "Approval required" | "Church admins only";

const SAVED_TOAST: Record<PolicyLabel, string> = {
  Open: "Members can now create groups.",
  "Approval required": "Members now request a group and a church admin approves it.",
  "Church admins only": "Only church admins can create groups now.",
};

let admin: { context: BrowserContext; page: Page };

function policySelect(page: Page) {
  return page.getByRole("combobox", { name: "Who can create groups" });
}

async function setPolicy(page: Page, label: PolicyLabel) {
  await page.goto("/admin/groups");
  const control = policySelect(page);
  await expect(control).toBeVisible();
  if ((await control.innerText()).trim() === label) return;
  await control.click();
  await page.getByRole("option", { name: label }).click();
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText(SAVED_TOAST[label])).toBeVisible();
  await expect(control).toContainText(label);
}

test.beforeAll(async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL is not configured");
  admin = await openAs(browser, baseURL, "admin");
  await setPolicy(admin.page, "Approval required");
});

test.afterAll(async () => {
  if (!admin) return;
  try {
    await setPolicy(admin.page, "Approval required");
  } finally {
    await admin.context.close();
  }
});

test.describe("a member of one group", () => {
  test.use({ persona: "oneGroup" });

  test("requests a group under approval", async ({ page }) => {
    await page.goto("/directory/groups");
    await expect(page.getByRole("button", { name: REQUEST })).toBeVisible();
    await expect(page.getByRole("button", { name: CREATE })).toHaveCount(0);
  });

  test("creates a group once the org opens creation", async ({ page }) => {
    await setPolicy(admin.page, "Open");

    await page.goto("/directory/groups");
    await expect(page.getByRole("button", { name: CREATE })).toBeVisible();
    await expect(page.getByRole("button", { name: REQUEST })).toHaveCount(0);
  });

  test("sees neither when the org leaves creation to its admins", async ({ page }) => {
    await setPolicy(admin.page, "Church admins only");

    await page.goto("/directory/groups");
    await expect(page.getByRole("button", { name: /Group B/ })).toBeVisible();
    await expect(page.getByRole("button", { name: CREATE })).toHaveCount(0);
    await expect(page.getByRole("button", { name: REQUEST })).toHaveCount(0);
  });
});

test.describe("the org admin", () => {
  test.use({ persona: "admin" });

  test("always has the create action, whatever the policy", async ({ page }) => {
    await setPolicy(admin.page, "Church admins only");

    await page.goto("/directory/groups");
    await expect(page.getByRole("button", { name: CREATE })).toBeVisible();
  });
});
