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

function psql(sql: string) {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

// The seed's mobile number fails the form's phone check, so a save needs a
// valid one; afterAll puts the seed's back.
test.beforeAll(() =>
  psql(`update public.profiles set hide_email = true, phone_mobile = '+15125550112' where id = '${CHLOE}';`),
);
test.afterAll(() =>
  psql(`update public.profiles set hide_email = false, occupation = null, phone_mobile = '555-0112'
        where id = '${CHLOE}';`),
);

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

  test("is shown their spouse's setting and no Email field", async ({ page }) => {
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

  test("opens the person's edit page with the hidden email in its Email field", async ({ page }) => {
    await page.goto(`/admin/members/${CHLOE}`);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(spouse.email);
  });
});

// Last, so every test above sees Chloe's email hidden.
test.describe("the household primary, editing", () => {
  test.use({ persona: "householdPrimary" });

  test("still saves their spouse's profile and hide setting", async ({ page }) => {
    const hide = page.getByRole("checkbox", { name: "Hide email from the directory" });
    const openSpouse = async () => {
      await page.goto("/profile?tab=household");
      await page.getByRole("button", { name: `Edit ${spouse.name}` }).click();
    };
    const save = async () => {
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Profile saved.")).toBeVisible();
    };

    await openSpouse();
    await page.getByLabel(/^Occupation/).fill("Teacher");
    await hide.uncheck();
    await save();

    await openSpouse();
    await expect(page.getByLabel(/^Occupation/)).toHaveValue("Teacher");
    await expect(hide).not.toBeChecked();
    await hide.check();
    await save();

    await openSpouse();
    await expect(hide).toBeChecked();
  });
});
