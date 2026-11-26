import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { GROUP_B } from "./fixtures/personas";

// Seeded genders in Group B: Henry, Caleb, Isaac and Leo are male; Chloe, Zoe
// and Hannah female; Ruth has none. Oliver is male and in Group C only.
const MALE = ["Henry Mockingham", "Caleb Dummyfield", "Isaac Seedly", "Leo Loremsworth"];
const FEMALE = ["Chloe Mockingham", "Zoe Dummyfield", "Hannah Loremsworth"];
const NO_GENDER = "Ruth Fixtureton";
const OUTSIDE = "Oliver Stubbins";

const genderFilter = (page: Page) => page.getByRole("group", { name: "Gender" });
const option = (page: Page, label: string) =>
  genderFilter(page).getByRole("button", { name: new RegExp(`^${label} \\(\\d+\\)$`) });
const personRows = (page: Page) => page.locator("section h2 + div > button");
const person = (page: Page, name: string) => page.getByRole("button", { name });

async function choose(page: Page, label: string): Promise<number> {
  await option(page, label).click();
  await expect(option(page, label)).toHaveAttribute("aria-pressed", "true");
  const count = Number((await option(page, label).textContent())!.match(/\((\d+)\)/)![1]);
  await expect(personRows(page)).toHaveCount(count);
  return count;
}

test.describe("the directory's gender filter", () => {
  test.use({ persona: "oneGroup" });

  for (const route of ["/directory", `/g/${GROUP_B}/directory`]) {
    test(`counts match the people shown at ${route.replace(GROUP_B, "<group>")}`, async ({ page }) => {
      await page.goto(route);
      await expect(person(page, "Zoe Dummyfield")).toBeVisible();

      const male = await choose(page, "Male");
      for (const name of MALE) await expect(person(page, name)).toBeVisible();
      for (const name of [...FEMALE, NO_GENDER, OUTSIDE]) await expect(person(page, name)).toHaveCount(0);

      const female = await choose(page, "Female");
      for (const name of FEMALE) await expect(person(page, name)).toBeVisible();
      for (const name of [...MALE, NO_GENDER, OUTSIDE]) await expect(person(page, name)).toHaveCount(0);

      const all = await choose(page, "All");
      for (const name of [...MALE, ...FEMALE, NO_GENDER]) await expect(person(page, name)).toBeVisible();
      await expect(person(page, OUTSIDE)).toHaveCount(0);
      expect(all).toBeGreaterThan(male + female);
    });
  }
});
