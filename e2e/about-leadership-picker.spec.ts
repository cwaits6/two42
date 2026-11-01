import { execFileSync } from "node:child_process";
import { expect, openAs, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS } from "./fixtures/personas";

function profileId(email: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_small-group-hub",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      `select id from public.profiles where email = '${email}';`,
    ],
    { encoding: "utf8" },
  ).trim();
}

test("the leadership picker offers this group's members, and the save refuses anyone else", async ({
  browser,
}) => {
  const baseURL = test.info().project.use.baseURL!;
  const admin = await openAs(browser, baseURL, "admin");
  try {
    // Group A is the migration-created group with no fixed id: reach it
    // through the switcher and read the id off the URL.
    await admin.page.goto(`/g/${GROUP_B}/dashboard`);
    await admin.page.getByRole("button", { name: "Switch group. Current group: Group B" }).click();
    await admin.page.getByRole("menuitem").filter({ hasText: "Group A" }).click();
    await admin.page.waitForURL(
      (url) => /^\/g\/[0-9a-f-]{36}\//.test(url.pathname) && !url.pathname.includes(GROUP_B),
    );
    const groupAId = new URL(admin.page.url()).pathname.split("/")[2];

    await admin.page.goto(`/g/${groupAId}/settings/about`);
    await admin.page.getByRole("button", { name: "Add member" }).click();
    const picker = admin.page.getByRole("dialog");
    await expect(picker.getByRole("button", { name: "Add Mia Fakeworth" })).toBeVisible();
    await expect(picker.getByText(PERSONAS.oneGroup.name)).toHaveCount(0);

    const res = await admin.page.request.post(`/g/${groupAId}/settings/about/save`, {
      data: {
        leaders: {
          list: [{ profile_id: profileId(PERSONAS.oneGroup.email), title: "", bio: "" }],
          removed: [],
        },
      },
    });
    expect(res.status()).toBe(409);
  } finally {
    await admin.context.close();
  }
});
