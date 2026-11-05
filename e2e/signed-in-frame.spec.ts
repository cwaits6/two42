import { expect, test } from "./fixtures/auth";
import { GROUP_B, type PersonaKey } from "./fixtures/personas";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const OWN = ["My profile", "Settings"];
const INFO = ["Help", "Privacy", "Terms", "Sign out"];
const ACCOUNT = { name: /^Account menu\. Signed in as \S/ };

// The page a persona's frame is checked on, the page list they get there, and
// every row of their account menu in order. Church admin is offered to the
// church admin alone and Platform to the operator alone.
const CASES: { persona: PersonaKey; path: string; nav: string; rows: string[] }[] = [
  { persona: "oneGroup", path: "/dashboard", nav: "Main navigation", rows: [...OWN, ...INFO] },
  { persona: "twoGroups", path: `/g/${GROUP_B}/dashboard`, nav: "Main navigation", rows: [...OWN, ...INFO] },
  { persona: "leadsB", path: `/g/${GROUP_B}/dashboard`, nav: "Main navigation", rows: [...OWN, ...INFO] },
  { persona: "admin", path: "/admin", nav: "Admin navigation", rows: [...OWN, "Church admin", ...INFO] },
  { persona: "operator", path: "/platform", nav: "Platform navigation", rows: ["Platform", ...INFO] },
];

for (const { persona, path, nav, rows } of CASES) {
  test.describe(`the frame for ${persona}, on a phone`, () => {
    test.use({ persona, viewport: PHONE });

    // Where an operator lands after signing in is not the frame's to decide.
    if (persona !== "operator") {
      test("the sign-in forms send them to Home", async ({ page }) => {
        for (const route of ["/login", "/forgot-password"]) {
          await page.goto(route);
          expect(new URL(page.url()).pathname, route).toBe("/dashboard");
          await expect(page.getByLabel("Password")).toHaveCount(0);
        }
      });
    }

    test("the bar holds the wordmark and one Menu button; the menu holds their pages and their account", async ({ page }) => {
      await page.goto(path);
      const header = page.getByRole("banner");
      await expect(header.getByRole("link", { name: "two42" })).toBeVisible();
      await expect(header.getByRole("button")).toHaveText(["Menu"]);
      await expect(page.getByRole("contentinfo")).toHaveCount(0);

      await header.getByRole("button", { name: "Menu" }).click();
      const menu = page.getByRole("dialog", { name: "Menu" });
      await expect(menu.getByRole("navigation")).toHaveCount(1);
      await expect(menu.getByRole("navigation", { name: nav })).toBeVisible();

      await menu.getByRole("button", ACCOUNT).click();
      await expect(page.getByRole("menuitem")).toHaveText(rows);
    });
  });

  test.describe(`the frame for ${persona}, on a computer`, () => {
    test.use({ persona, viewport: DESKTOP });

    test("there is no Menu button; their pages and their account are on the page", async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Menu", exact: true })).toHaveCount(0);
      await expect(page.getByRole("contentinfo")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "two42" })).toBeVisible();
      await expect(page.getByRole("navigation")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: nav })).toBeVisible();

      await page.getByRole("button", ACCOUNT).click();
      await expect(page.getByRole("menuitem")).toHaveText(rows);
    });
  });
}

test.describe("a member of two groups, on a phone", () => {
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

test.describe("a member of two groups, on a computer", () => {
  test.use({ persona: "twoGroups", viewport: DESKTOP });

  test("has one Home inside a group, and reaches all groups from the switcher and the wordmark", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/dashboard`);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const home = nav.getByRole("link", { name: "Home", exact: true });
    await expect(home).toHaveCount(1);
    await expect(home).toHaveAttribute("href", `/g/${GROUP_B}/dashboard`);
    await expect(page.getByRole("link", { name: "two42" })).toHaveAttribute("href", "/dashboard");

    await nav.getByRole("button", { name: "Switch group. Current group: Group B" }).click();
    const first = page.getByRole("menuitem").first();
    await expect(first).toHaveText("All groups");
    await first.click();
    await page.waitForURL("/dashboard");

    await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveCount(1);
    await expect(nav.getByRole("button", { name: "Switch group. Showing all groups" })).toBeVisible();
  });
});

test("a signed-out visitor keeps the sign-in form and the footer", async ({ page }) => {
  await page.goto("/login");
  expect(new URL(page.url()).pathname).toBe("/login");
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
});
