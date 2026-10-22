import { expect, openAs, test } from "./fixtures/auth";

// Household ids follow the seed's row order: Sampleton is the first
// household (Group A), Dummyfield the sixth (Group B).
const SAMPLETON_HOUSEHOLD = "f0000000-0000-0000-0000-000000000001";
const DUMMYFIELD_HOUSEHOLD = "f0000000-0000-0000-0000-000000000006";

test.describe("a member of one group", () => {
  test.use({ persona: "oneGroup" });

  test("lists only the households that share a group", async ({ page }) => {
    await page.goto("/directory/families");
    for (const shared of ["Dummyfield", "Fixtureton", "Loremsworth", "Mockingham", "Seedly"]) {
      await expect(page.getByRole("button", { name: shared })).toBeVisible();
    }
    for (const other of ["Sampleton", "Testwell", "Demoski", "Stubbins", "Nullington"]) {
      await expect(page.getByRole("button", { name: other })).toHaveCount(0);
    }
  });

  test("a deep link to another group's household opens nothing", async ({ page, browser, baseURL }) => {
    if (!baseURL) throw new Error("baseURL is not configured");

    // The barred id must be a real household someone can open, or the
    // negative assertions below would pass against a stale id.
    const admin = await openAs(browser, baseURL, "admin");
    await admin.page.goto(`/directory/families?family=${SAMPLETON_HOUSEHOLD}`);
    await expect(admin.page.getByRole("heading", { name: "Sampleton" })).toBeVisible();
    await admin.context.close();

    await page.goto(`/directory/families?family=${DUMMYFIELD_HOUSEHOLD}`);
    await expect(page.getByRole("heading", { name: "Dummyfield" })).toBeVisible();

    await page.goto(`/directory/families?family=${SAMPLETON_HOUSEHOLD}`);
    await expect(page.getByRole("button", { name: "Dummyfield" })).toBeVisible();
    await expect(page.getByText("Choose a family from the list to see their details.")).toBeVisible();
    await expect(page.getByText("Sampleton")).toHaveCount(0);
  });
});
