import { expect, test } from "./fixtures/auth";
import { GROUP_B } from "./fixtures/personas";

test("the directory sends a signed-out visitor to the login page", async ({ page }) => {
  for (const route of ["/directory", `/g/${GROUP_B}/directory`]) {
    await page.goto(route);
    expect(new URL(page.url()).pathname, route).toBe("/login");
    await expect(page.getByLabel("Password")).toBeVisible();
  }
});
