import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures/auth";
import { PERSONAS } from "./fixtures/personas";

// Chloe hides her email. Isaac shares Group B with her, Henry is the primary
// of her household, and the church admin is in Group B too.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const CHLOE = "a0000000-0000-0000-0000-000000000112";
const HENRY = "a0000000-0000-0000-0000-000000000111";
const { spouse, householdPrimary } = PERSONAS;

const card = (id: string) => `/directory/families?person=${id}`;

function setHidden(hidden: boolean) {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c",
      `update public.profiles set hide_email = ${hidden} where id = '${CHLOE}';`],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(() => setHidden(true));
test.afterAll(() => setHidden(false));

test.describe("another member", () => {
  test.use({ persona: "oneGroup" });

  test("sees the person without their hidden email, and still sees a visible one", async ({ page }) => {
    await page.goto(card(CHLOE));
    await expect(page.getByRole("heading", { name: spouse.name })).toBeVisible();
    await expect(page.getByText(spouse.email)).toHaveCount(0);

    await page.goto(card(HENRY));
    await expect(page.getByRole("link", { name: householdPrimary.email })).toBeVisible();
  });
});

test.describe("the household primary", () => {
  test.use({ persona: "householdPrimary" });

  test("can change the setting for their spouse but is not shown the email", async ({ page }) => {
    await page.goto("/profile?tab=household");
    await page.getByRole("button", { name: `Edit ${spouse.name}` }).click();

    await expect(page.getByRole("checkbox", { name: "Hide email from the directory" })).toBeChecked();
    await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
    await expect(page.getByText(spouse.email)).toHaveCount(0);
  });
});

test.describe("the person themselves", () => {
  test.use({ persona: "spouse" });

  test("still sees their own email on My profile", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(spouse.email);
    await expect(page.getByRole("checkbox", { name: "Hide my email from the directory" })).toBeChecked();
  });
});

test.describe("a church admin", () => {
  test.use({ persona: "admin" });

  test("sees the hidden email in Members", async ({ page }) => {
    await page.goto("/admin/members");
    await expect(page.getByText(spouse.email)).toBeVisible();
    await expect(page.getByText(householdPrimary.email)).toBeVisible();
  });
});
