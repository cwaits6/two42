import { expect, test } from "./fixtures/auth";
import { GROUP_B, type PersonaKey } from "./fixtures/personas";

const PHONE = { width: 390, height: 844 };

// The page a persona's header is checked on: inside a group for everyone who
// has one, and the admin area for the church admin.
const CASES: { persona: PersonaKey; path: string; nav: string }[] = [
  { persona: "oneGroup", path: "/dashboard", nav: "Main navigation" },
  { persona: "twoGroups", path: `/g/${GROUP_B}/dashboard`, nav: "Main navigation" },
  { persona: "admin", path: "/admin", nav: "Admin navigation" },
];

for (const { persona, path, nav } of CASES) {
  test.describe(`signed in as ${persona}`, () => {
    test.use({ persona, viewport: PHONE });

    test("the sign-in forms send them to Home", async ({ page }) => {
      for (const route of ["/login", "/forgot-password"]) {
        await page.goto(route);
        expect(new URL(page.url()).pathname, route).toBe("/dashboard");
        await expect(page.getByLabel("Password")).toHaveCount(0);
      }
    });

    test("the header holds the wordmark and the menu, and nothing else", async ({ page }) => {
      await page.goto(path);
      const header = page.getByRole("banner");
      await expect(header.getByRole("link", { name: "two42" })).toBeVisible();
      await expect(header.getByRole("button")).toHaveText(["Menu"]);
      await expect(page.getByRole("contentinfo")).toHaveCount(0);

      await header.getByRole("button", { name: "Menu" }).click();
      const menu = page.getByRole("dialog", { name: "Menu" });
      await expect(menu.getByRole("navigation", { name: nav })).toBeVisible();
      for (const name of ["Privacy", "Terms", "Help"]) {
        await expect(menu.getByRole("link", { name, exact: true })).toBeVisible();
      }
      await expect(menu.getByRole("button", { name: "Sign out" })).toHaveCount(1);
    });
  });
}

test.describe("a member of two groups", () => {
  test.use({ persona: "twoGroups", viewport: PHONE });

  test("switches group from inside the menu", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/dashboard`);
    await expect(page.getByRole("banner").getByText("Group B")).toHaveCount(0);
    await page.getByRole("banner").getByRole("button", { name: "Menu" }).click();
    await page
      .getByRole("dialog", { name: "Menu" })
      .getByRole("button", { name: "Switch group. Current group: Group B" })
      .click();
    await expect(page.getByRole("menuitem").filter({ hasText: "Group C" })).toHaveCount(1);
  });
});

test("a signed-out visitor keeps the sign-in form and the footer", async ({ page }) => {
  await page.goto("/login");
  expect(new URL(page.url()).pathname).toBe("/login");
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
});
