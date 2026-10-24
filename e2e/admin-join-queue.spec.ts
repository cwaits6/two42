import { execFileSync } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, openAs, test } from "./fixtures/auth";
import { GROUP_B, GROUP_C, PERSONAS } from "./fixtures/personas";

// The request goes to Group C, which the admin does not lead: an approval
// that only worked for leaders would fail here. Isaac's request and the
// Group C membership that Approve writes are rows every other spec assumes
// absent, so the tests run in order and both hooks delete them whatever
// happens between. Nothing in the UI deletes a reviewed request, so the
// restore goes through the stack's own Postgres container: the name
// `supabase start` gives it from config.toml's project_id, locally and in
// CI alike.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const ISAAC = PERSONAS.oneGroup;
const SWITCHER = "Switch group. Current group: Group B";
const ONE_WAITING = "1 join request waiting.";
const NONE_WAITING = "No pending join requests.";
const REVIEW_ACTION = "Review join requests";

// Scoped to Isaac's rows on Group C only: the stack is shared, and another
// spec may hold rows of its own for him.
const RESTORE_SQL = `
  delete from public.group_members m
    using public.profiles p
    where p.id = m.profile_id and p.email = '${ISAAC.email}'
      and m.group_id = '${GROUP_C}';
  delete from public.group_join_requests r
    using public.profiles p
    where p.id = r.profile_id and p.email = '${ISAAC.email}'
      and r.group_id = '${GROUP_C}';
`;

function restoreSeed() {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c", RESTORE_SQL],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(() => restoreSeed());
test.afterAll(() => restoreSeed());

function groupCRow(page: Page) {
  return page.getByRole("listitem").filter({ hasText: "Group C" });
}

async function askToJoinGroupC(page: Page) {
  await page.goto("/find-a-group");
  await groupCRow(page).getByRole("button", { name: "Request to join" }).click();
  await expect(groupCRow(page)).toContainText("Request sent");
}

/** Isaac's own view, opened beside the admin's page in the same test. */
async function withIsaac(browser: Browser, baseURL: string, check: (page: Page) => Promise<void>) {
  const isaac = await openAs(browser, baseURL, "oneGroup");
  try {
    await check(isaac.page);
  } finally {
    await isaac.context.close();
  }
}

test.describe("a member of Group B only", () => {
  test.use({ persona: "oneGroup" });

  test("asks to join Group C", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/dashboard`);
    await expect(page.getByRole("button", { name: SWITCHER })).toHaveCount(0);
    await askToJoinGroupC(page);
  });
});

test.describe("the org admin, who does not lead Group C, declining", () => {
  test.use({ persona: "admin" });

  test("sees it counted on the overview and declines it under Group C; Isaac stays out", async ({
    page,
    browser,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL is not configured");

    await page.goto("/admin");
    await expect(page.getByText(ONE_WAITING)).toBeVisible();
    await page.getByRole("button", { name: REVIEW_ACTION }).click();
    await expect(page).toHaveURL(/\/admin\/groups$/);

    const queue = page.getByRole("region", { name: "Group C" });
    await expect(queue.getByText(ISAAC.name)).toBeVisible();
    await queue.getByRole("button", { name: "Decline" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Decline ${ISAAC.name}'s request to join Group C?`);
    await dialog.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("Request declined.")).toBeVisible();
    await expect(queue).toHaveCount(0);
    await expect(page.getByText(NONE_WAITING)).toBeVisible();

    await withIsaac(browser, baseURL, async (isaac) => {
      // Still one group, so the switcher is still a static label; and a
      // declined requester may ask again, which a member could not.
      await isaac.goto(`/g/${GROUP_B}/dashboard`);
      await expect(isaac.getByRole("button", { name: SWITCHER })).toHaveCount(0);
      await isaac.goto("/find-a-group");
      await expect(groupCRow(isaac).getByRole("button", { name: "Request to join" })).toBeVisible();
    });
  });
});

test.describe("a member of Group B only, declined once", () => {
  test.use({ persona: "oneGroup" });

  test("can ask again", async ({ page }) => {
    await askToJoinGroupC(page);
  });
});

test.describe("the org admin, who does not lead Group C, approving", () => {
  test.use({ persona: "admin" });

  test("approves it under Group C, Isaac gains the group, and the overview count clears", async ({
    page,
    browser,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL is not configured");

    await page.goto("/admin/groups");
    const queue = page.getByRole("region", { name: "Group C" });
    await expect(queue.getByText(ISAAC.name)).toBeVisible();
    await queue.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(`${ISAAC.name} joined Group C.`)).toBeVisible();
    await expect(queue).toHaveCount(0);
    await expect(page.getByText(NONE_WAITING)).toBeVisible();

    await page.goto("/admin");
    await expect(page.getByText(NONE_WAITING)).toBeVisible();
    await expect(page.getByRole("button", { name: REVIEW_ACTION })).toHaveCount(0);

    await withIsaac(browser, baseURL, async (isaac) => {
      await isaac.goto(`/g/${GROUP_B}/dashboard`);
      await isaac.getByRole("button", { name: SWITCHER }).click();
      const rows = isaac.getByRole("menuitem");
      await expect(rows.filter({ hasText: "Group A" })).toHaveCount(0);
      await expect(rows.filter({ hasText: "Group B" })).toHaveCount(1);
      await expect(rows.filter({ hasText: "Group C" })).toHaveCount(1);
    });
  });
});
