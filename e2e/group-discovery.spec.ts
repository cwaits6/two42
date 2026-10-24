import type { BrowserContext, Page } from "@playwright/test";
import { expect, openAs, test } from "./fixtures/auth";
import { GROUP_B, GROUP_C } from "./fixtures/personas";

// The org switch and Group C's private flag are rows every other spec
// reads, so the tests run in order and the hooks leave both at the seed
// defaults (discovery on, Group C public) whatever happens between.
// Nothing here joins a group or files a request: that would leave rows on
// the shared local stack.
test.describe.configure({ mode: "serial" });

const DISCOVERY_SWITCH = "Members can find and request to join groups";
const DISCOVERY_ON_TOAST = "Members can now find and request to join groups.";
const DISCOVERY_OFF_TOAST = "Members now see only the groups they belong to.";
const PRIVATE_SWITCH = "Private group";
const PRIVATE_ON_TOAST = "Group is now private.";
const PRIVATE_OFF_TOAST = "Group can be found again.";
const PRIVATE_TAG = "Private · invite only";
const REQUEST = "Request to join";

let admin: { context: BrowserContext; page: Page };
let leaderC: { context: BrowserContext; page: Page };

async function setSwitch(page: Page, url: string, name: string, on: boolean, toastText: string) {
  await page.goto(url);
  const control = page.getByRole("switch", { name });
  await expect(control).toBeVisible();
  if ((await control.isChecked()) === on) return;
  await control.click();
  await expect(page.getByText(toastText)).toBeVisible();
  await expect(control).toBeChecked({ checked: on });
}

function setDiscovery(on: boolean) {
  return setSwitch(
    admin.page,
    "/admin/groups",
    DISCOVERY_SWITCH,
    on,
    on ? DISCOVERY_ON_TOAST : DISCOVERY_OFF_TOAST,
  );
}

function setGroupCPrivate(on: boolean) {
  return setSwitch(
    leaderC.page,
    `/g/${GROUP_C}/settings/privacy`,
    PRIVATE_SWITCH,
    on,
    on ? PRIVATE_ON_TOAST : PRIVATE_OFF_TOAST,
  );
}

function row(page: Page, groupName: string) {
  return page.getByRole("listitem").filter({ hasText: groupName });
}

test.beforeAll(async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL is not configured");
  admin = await openAs(browser, baseURL, "admin");
  leaderC = await openAs(browser, baseURL, "leadsC");
  await setDiscovery(true);
  await setGroupCPrivate(false);
});

test.afterAll(async () => {
  try {
    // Separate pages, so one failed restore never skips the other.
    const results = await Promise.allSettled([
      leaderC ? setGroupCPrivate(false) : Promise.resolve(),
      admin ? setDiscovery(true) : Promise.resolve(),
    ]);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
  } finally {
    await leaderC?.context.close();
    await admin?.context.close();
  }
});

test.describe("a member of Group B only", () => {
  test.use({ persona: "oneGroup" });

  test("can ask to join the other groups while both are public", async ({ page }) => {
    await page.goto("/find-a-group");
    await expect(page.getByRole("link", { name: "Find a group" })).toBeVisible();
    await expect(row(page, "Group A").getByRole("button", { name: REQUEST })).toBeVisible();
    await expect(row(page, "Group C").getByRole("button", { name: REQUEST })).toBeVisible();
    await expect(row(page, "Group B")).toContainText("You are a member");
  });

  test("loses a group that goes private, and its deep link stays a 404", async ({ page }) => {
    await setGroupCPrivate(true);

    await page.goto("/find-a-group");
    await expect(row(page, "Group A").getByRole("button", { name: REQUEST })).toBeVisible();
    await expect(row(page, "Group C")).toHaveCount(0);
    await expect(page.getByText(PRIVATE_TAG)).toHaveCount(0);

    await page.goto("/directory/groups");
    await expect(page.getByRole("button", { name: /Group B/ })).toBeVisible();
    await expect(row(page, "Group C")).toHaveCount(0);

    // Control: a group the member belongs to resolves, so the 404 is
    // specific to Group C rather than every /g/* route failing.
    expect((await page.goto(`/g/${GROUP_B}/dashboard`))?.status()).toBe(200);
    expect((await page.goto(`/g/${GROUP_C}/dashboard`))?.status()).toBe(404);
  });

  test("sees only their own group once the org turns discovery off", async ({ page }) => {
    await setDiscovery(false);

    expect((await page.goto("/find-a-group"))?.status()).toBe(404);

    await page.goto("/directory/groups");
    await expect(page.getByRole("button", { name: /Group B/ })).toBeVisible();
    await expect(row(page, "Group A")).toHaveCount(0);
    await expect(page.getByRole("button", { name: REQUEST })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Find a group" })).toHaveCount(0);
  });
});

test.describe("the org admin, in Group A and Group B", () => {
  test.use({ persona: "admin" });

  test("sees the private group tagged, with no way to join it", async ({ page }) => {
    await setDiscovery(true);
    await setGroupCPrivate(true);

    await page.goto("/directory/groups");
    const groupC = row(page, "Group C");
    await expect(groupC).toContainText(PRIVATE_TAG);
    await expect(groupC.getByRole("button")).toHaveCount(0);
    await expect(row(page, "Group A")).toContainText("You lead this group");
  });
});

test.describe("a member of Group B and Group C", () => {
  test.use({ persona: "twoGroups" });

  test("still sees the private group they belong to", async ({ page }) => {
    await setGroupCPrivate(true);

    await page.goto("/find-a-group");
    await expect(row(page, "Group C")).toContainText("You are a member");
    await expect(page.getByText(PRIVATE_TAG)).toHaveCount(0);
  });
});
