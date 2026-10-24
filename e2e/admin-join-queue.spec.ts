import { execFileSync } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, openAs, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS } from "./fixtures/personas";

// Isaac's requests and the Group A membership that Approve writes are rows
// every other spec assumes absent, so the tests run in order and both hooks
// delete them whatever happens between. Nothing in the UI deletes a reviewed
// request, so the restore goes through the stack's own Postgres container:
// the name `supabase start` gives it from config.toml's project_id, locally
// and in CI alike.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const ISAAC = PERSONAS.oneGroup;
const SWITCHER = "Switch group. Current group: Group B";
const ONE_WAITING = "1 join request waiting.";
const NONE_WAITING = "No pending join requests.";
const REVIEW_ACTION = "Review join requests";

const RESTORE_SQL = `
  delete from public.group_members m
    using public.profiles p, public.groups g
    where p.id = m.profile_id and p.email = '${ISAAC.email}'
      and g.id = m.group_id and g.org_id = m.org_id and g.name = 'Group A';
  delete from public.group_join_requests r
    using public.profiles p
    where p.id = r.profile_id and p.email = '${ISAAC.email}';
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

function groupARow(page: Page) {
  return page.getByRole("listitem").filter({ hasText: "Group A" });
}

async function askToJoinGroupA(page: Page) {
  await page.goto("/find-a-group");
  await groupARow(page).getByRole("button", { name: "Request to join" }).click();
  await expect(groupARow(page)).toContainText("Request sent");
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

  test("asks to join Group A", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/dashboard`);
    await expect(page.getByRole("button", { name: SWITCHER })).toHaveCount(0);
    await askToJoinGroupA(page);
  });
});

test.describe("the org admin, declining", () => {
  test.use({ persona: "admin" });

  test("sees it counted on the overview and declines it under Group A; Isaac stays out", async ({
    page,
    browser,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL is not configured");

    await page.goto("/admin");
    await expect(page.getByText(ONE_WAITING)).toBeVisible();
    await page.getByRole("button", { name: REVIEW_ACTION }).click();
    await expect(page).toHaveURL(/\/admin\/groups$/);

    const queue = page.getByRole("region", { name: "Group A" });
    await expect(queue.getByText(ISAAC.name)).toBeVisible();
    await queue.getByRole("button", { name: "Decline" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Decline ${ISAAC.name}'s request to join Group A?`);
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
      await expect(groupARow(isaac).getByRole("button", { name: "Request to join" })).toBeVisible();
    });
  });
});

test.describe("a member of Group B only, declined once", () => {
  test.use({ persona: "oneGroup" });

  test("can ask again", async ({ page }) => {
    await askToJoinGroupA(page);
  });
});

test.describe("the org admin, approving", () => {
  test.use({ persona: "admin" });

  test("approves it under Group A, Isaac gains the group, and the overview count clears", async ({
    page,
    browser,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL is not configured");

    await page.goto("/admin/groups");
    const queue = page.getByRole("region", { name: "Group A" });
    await expect(queue.getByText(ISAAC.name)).toBeVisible();
    await queue.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(`${ISAAC.name} joined Group A.`)).toBeVisible();
    await expect(queue).toHaveCount(0);
    await expect(page.getByText(NONE_WAITING)).toBeVisible();

    await page.goto("/admin");
    await expect(page.getByText(NONE_WAITING)).toBeVisible();
    await expect(page.getByRole("button", { name: REVIEW_ACTION })).toHaveCount(0);

    await withIsaac(browser, baseURL, async (isaac) => {
      await isaac.goto(`/g/${GROUP_B}/dashboard`);
      await isaac.getByRole("button", { name: SWITCHER }).click();
      const rows = isaac.getByRole("menuitem");
      await expect(rows.filter({ hasText: "Group A" })).toHaveCount(1);
      await expect(rows.filter({ hasText: "Group B" })).toHaveCount(1);
      await expect(rows.filter({ hasText: "Group C" })).toHaveCount(0);
    });
  });
});
