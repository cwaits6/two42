import { expect, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS } from "./fixtures/personas";

const DIRECTORY = `/g/${GROUP_B}/directory`;
const MEMBER = PERSONAS.oneGroup.name;
const LEADER = PERSONAS.leadsB.name;

test.describe("a member of the group who is not a leader", () => {
  test.use({ persona: "oneGroup" });

  test("never sees Edit members or a row's Edit and Remove", async ({ page }) => {
    await page.goto(DIRECTORY);
    await expect(page.getByRole("button", { name: LEADER }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit members" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  });
});

test.describe("the group's leader", () => {
  test.use({ persona: "leadsB" });

  test("sees Edit and Remove on rows only while Edit members is on", async ({ page }) => {
    await page.goto(DIRECTORY);
    await expect(page.getByRole("button", { name: MEMBER }).first()).toBeVisible();

    const toggle = page.getByRole("button", { name: "Edit members" });
    const editMember = page.getByRole("button", { name: `Edit ${MEMBER}` });
    const removeMember = page.getByRole("button", { name: new RegExp(`^Remove ${MEMBER} from `) });
    const removeSelf = page.getByRole("button", { name: new RegExp(`^Remove ${LEADER} from `) });

    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(editMember).toHaveCount(0);
    await expect(removeMember).toHaveCount(0);

    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(editMember).toBeVisible();
    await expect(removeMember).toBeVisible();
    await expect(removeSelf).toBeDisabled();

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toBeFocused();
    await expect(editMember).toHaveCount(0);
    await expect(removeMember).toHaveCount(0);
  });
});
