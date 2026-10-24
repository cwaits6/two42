import { execFileSync } from "node:child_process";
import { expect, openAs, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS } from "./fixtures/personas";

// Isaac's request and the Group A membership that Approve writes are rows
// every other spec assumes absent, so the tests run in order and both hooks
// delete them whatever happens between. Nothing in the UI deletes a reviewed
// request, so the restore goes through the stack's own Postgres container:
// the name `supabase start` gives it from config.toml's project_id, locally
// and in CI alike.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const ISAAC = PERSONAS.oneGroup;
const SWITCHER = "Switch group. Current group: Group B";

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

test.describe("a member of Group B only", () => {
  test.use({ persona: "oneGroup" });

  test("asks to join Group A", async ({ page }) => {
    // One group: the switcher is a static label, so there is no menu yet.
    await page.goto(`/g/${GROUP_B}/dashboard`);
    await expect(page.getByRole("button", { name: SWITCHER })).toHaveCount(0);

    await page.goto("/find-a-group");
    const groupA = page.getByRole("listitem").filter({ hasText: "Group A" });
    await groupA.getByRole("button", { name: "Request to join" }).click();
    await expect(groupA).toContainText("Request sent");
  });
});

test.describe("the org admin", () => {
  test.use({ persona: "admin" });

  test("approves it under Group A on Admin › Groups, and Isaac gains the group", async ({
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
    await expect(page.getByText("No pending join requests.")).toBeVisible();

    const isaac = await openAs(browser, baseURL, "oneGroup");
    try {
      await isaac.page.goto(`/g/${GROUP_B}/dashboard`);
      await isaac.page.getByRole("button", { name: SWITCHER }).click();
      const rows = isaac.page.getByRole("menuitem");
      await expect(rows.filter({ hasText: "Group A" })).toHaveCount(1);
      await expect(rows.filter({ hasText: "Group B" })).toHaveCount(1);
      await expect(rows.filter({ hasText: "Group C" })).toHaveCount(0);
    } finally {
      await isaac.context.close();
    }
  });
});
