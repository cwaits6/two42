import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { GROUP_B } from "./fixtures/personas";

// Assumes the org is at its seeded directory_visibility of shared_groups;
// the visibility-toggle spec forces it to that seed default before and after
// its own tests, even when they fail.

const scopeControl = (page: Page) =>
  page.getByRole("combobox", { name: "Show people from" });

async function chooseScope(page: Page, label: string) {
  await scopeControl(page).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(scopeControl(page)).toContainText(label);
}

test.describe("a member of one group", () => {
  test.use({ persona: "oneGroup" });

  for (const route of ["/directory", `/g/${GROUP_B}/directory`]) {
    test(`sees no scope control at ${route.replace(GROUP_B, "<group>")}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("button", { name: "Zoe Dummyfield" })).toBeVisible();
      await expect(scopeControl(page)).toHaveCount(0);
      await expect(page.getByText("Show people from")).toHaveCount(0);
    });
  }
});

test.describe("a member of two groups", () => {
  test.use({ persona: "twoGroups" });

  test("is offered this group, the other group, and all my groups — never everyone", async ({
    page,
  }) => {
    await page.goto(`/g/${GROUP_B}/directory`);
    await expect(scopeControl(page)).toContainText("This group");
    await scopeControl(page).click();
    await expect(page.getByRole("option")).toHaveText(["This group", "Group C", "All my groups"]);
    await page.keyboard.press("Escape");

    await page.goto("/directory");
    await expect(scopeControl(page)).toContainText("All my groups");
    await scopeControl(page).click();
    await expect(page.getByRole("option")).toHaveText(["All my groups", "Group B", "Group C"]);
    await expect(page.getByRole("option", { name: /Everyone/ })).toHaveCount(0);
  });

  test("switching scope changes the roster", async ({ page }) => {
    const zoe = page.getByRole("button", { name: "Zoe Dummyfield" });
    const amelia = page.getByRole("button", { name: "Amelia Demoski" });

    await page.goto(`/g/${GROUP_B}/directory`);
    await expect(zoe).toBeVisible();
    await expect(amelia).toHaveCount(0);

    await chooseScope(page, "Group C");
    await expect(amelia).toBeVisible();
    await expect(zoe).toHaveCount(0);

    await chooseScope(page, "All my groups");
    await expect(amelia).toBeVisible();
    await expect(zoe).toBeVisible();
  });

  test("the chosen scope carries from Members to Households", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/directory`);
    await chooseScope(page, "Group C");

    await page.getByRole("navigation", { name: "Directory sections" }).getByRole("link", { name: "Households" }).click();
    await expect(page).toHaveURL(`/g/${GROUP_B}/directory/families`);
    await expect(scopeControl(page)).toContainText("Group C");
    await expect(page.getByRole("button", { name: "Demoski" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dummyfield" })).toHaveCount(0);
  });

  test("search never escapes the scope", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/directory`);
    await chooseScope(page, "Group C");

    const search = page.getByRole("searchbox", { name: "Search members" });
    await search.fill("Demoski");
    await expect(page.getByRole("button", { name: "Amelia Demoski" })).toBeVisible();

    await search.fill("Dummyfield");
    await expect(page.getByText("No members match your search.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoe Dummyfield" })).toHaveCount(0);
  });
});
