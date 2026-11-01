import { expect, test } from "./fixtures/auth";
import { GROUP_B, GROUP_C, PERSONAS } from "./fixtures/personas";

test.describe("the org admin, in Group A and Group B", () => {
  test.use({ persona: "admin" });

  test("the switcher lists only the admin's own groups", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/dashboard`);
    await page.getByRole("button", { name: "Switch group. Current group: Group B" }).click();
    const rows = page.getByRole("menuitem");
    await expect(rows.filter({ hasText: "Group A" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Group B" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Group C" })).toHaveCount(0);
  });

  test("a group the admin is not in is a 404, not a 403", async ({ page }) => {
    // Control: a group the admin belongs to resolves, so the 404s below are
    // specific to Group C rather than every /g/* route failing.
    expect((await page.goto(`/g/${GROUP_B}/dashboard`))?.status()).toBe(200);
    for (const route of ["/dashboard", "/directory", "/calendar", "/announcements"]) {
      const response = await page.goto(`/g/${GROUP_C}${route}`);
      expect(response?.status(), route).toBe(404);
    }
  });

  test("Admin › Groups still opens a group the admin is not in, with its people", async ({ page }) => {
    await page.goto("/admin/groups");
    await page.getByRole("link", { name: "Group C", exact: true }).click();
    await page.waitForURL(`/admin/groups/${GROUP_C}`);

    await expect(page.getByRole("heading", { name: "Group C", level: 1 })).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: PERSONAS.leadsC.name }).getByText("Leader"),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: PERSONAS.twoGroups.name })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open group" })).toHaveCount(0);
  });
});

test.describe("a member of Group B only", () => {
  test.use({ persona: "oneGroup" });

  test("reads only Group B's announcements and calendar", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/announcements`);
    await expect(page.getByText("Parking lot repaving next week")).toBeVisible();
    await expect(page.getByText("Potluck sign-up is open")).toHaveCount(0);

    await page.goto(`/g/${GROUP_B}/calendar`);
    await expect(page.getByText("Sunday Class").first()).toBeVisible();
    await expect(page.getByText("Weekly Group Meeting")).toHaveCount(0);
    await expect(page.getByText("Sunday Afternoon Meeting")).toHaveCount(0);
  });
});

test.describe("a member of Group B and Group C", () => {
  test.use({ persona: "twoGroups" });

  test("each group's calendar shows that group's events only", async ({ page }) => {
    await page.goto(`/g/${GROUP_C}/calendar`);
    await expect(page.getByText("Sunday Afternoon Meeting").first()).toBeVisible();
    await expect(page.getByText("Sunday Class")).toHaveCount(0);

    await page.goto(`/g/${GROUP_C}/announcements`);
    await expect(page.getByText("No announcements yet.")).toBeVisible();
    await expect(page.getByText("Parking lot repaving next week")).toHaveCount(0);
  });
});
