import { execFileSync } from "node:child_process";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, GROUP_C, PERSONAS } from "./fixtures/personas";

// Zoe leads Group B; for these tests she also leads Group C, so one person
// leads two groups. Amelia asks to join Group B and Isaac asks to join Group
// C. Those rows, and the Group C membership Approve gives Isaac, are ones
// every other spec assumes absent, so the tests run in order and both hooks
// delete them through the stack's Postgres container whatever happens
// between. People are matched by their sign-in address in auth.users.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const ZOE = PERSONAS.leadsB;
const AMELIA = PERSONAS.leadsC;
const ISAAC = PERSONAS.oneGroup;

const person = (email: string) => `(select id from auth.users where email = '${email}')`;

const RESTORE_SQL = `
  delete from public.group_join_requests
    where (group_id = '${GROUP_B}' and profile_id = ${person(AMELIA.email)})
       or (group_id = '${GROUP_C}' and profile_id = ${person(ISAAC.email)});
  delete from public.group_members
    where group_id = '${GROUP_C}'
      and profile_id in (${person(ISAAC.email)}, ${person(ZOE.email)});
`;

const FIXTURE_SQL = `
  insert into public.group_members (org_id, group_id, profile_id, role)
    select org_id, id, ${person(ZOE.email)}, 'leader' from public.groups where id = '${GROUP_C}';
  insert into public.group_join_requests (org_id, group_id, profile_id, status)
    select org_id, id, ${person(AMELIA.email)}, 'pending' from public.groups where id = '${GROUP_B}';
  insert into public.group_join_requests (org_id, group_id, profile_id, status)
    select org_id, id, ${person(ISAAC.email)}, 'pending' from public.groups where id = '${GROUP_C}';
`;

function psql(sql: string) {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(() => {
  psql(RESTORE_SQL);
  psql(FIXTURE_SQL);
});
test.afterAll(() => psql(RESTORE_SQL));

const SECTIONS = ["Details", "Requests", "Privacy and joining", "Invite links", "Teams", "Labels"];

const settingsNav = (page: Page) => page.getByRole("navigation", { name: "Group settings navigation" });

/** A row's name as a screen reader reads it, with its waiting count when there is one. */
const waiting = (label: string, count: number) => new RegExp(`^${label} ?, ${count} waiting$`);

async function expectLinkNames(links: Locator, names: (string | RegExp)[]) {
  await expect(links).toHaveCount(names.length);
  for (const [i, name] of names.entries()) await expect(links.nth(i)).toHaveAccessibleName(name);
}

test.describe("a leader of two groups", () => {
  test.use({ persona: "leadsB" });

  test("sees Group B's waiting count on its Group settings row, and its sections one click from there", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/dashboard`);
    const row = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Group settings/ });
    await expect(row).toHaveAccessibleName(waiting("Group settings", 1));
    await row.click();
    await page.waitForURL(`/g/${GROUP_B}/settings/details`);
    await expectLinkNames(settingsNav(page).getByRole("link"), [
      "Back to Group B",
      "Details",
      waiting("Requests", 1),
      ...SECTIONS.slice(2),
    ]);
  });

  test("sees each group's own requests to join, and no other group's", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/settings/requests`);
    await expect(page.getByText(AMELIA.name)).toBeVisible();
    await expect(page.getByText(ISAAC.name)).toHaveCount(0);

    await page.goto(`/g/${GROUP_C}/settings/requests`);
    await expect(page.getByText(ISAAC.name)).toBeVisible();
    await expect(page.getByText(AMELIA.name)).toHaveCount(0);
    await expect(settingsNav(page).getByRole("link", { name: /^Back to/ })).toHaveAccessibleName("Back to Group C");
    await expect(settingsNav(page).getByRole("link", { name: /^Requests/ })).toHaveAccessibleName(waiting("Requests", 1));
  });

  test("opens Group settings on Details, and the old serving settings address on Teams", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/settings`);
    await page.waitForURL(`/g/${GROUP_B}/settings/details`);
    await page.goto(`/g/${GROUP_B}/settings/serving`);
    await page.waitForURL(`/g/${GROUP_B}/settings/teams`);
    await expect(page.getByRole("heading", { name: "Serving emails" })).toBeVisible();
  });
});

test.describe("a member of Group B who does not lead it", () => {
  test.use({ persona: "oneGroup" });

  test("lands on the group's Home from every Group settings address, with no row and no request", async ({ page }) => {
    for (const path of ["", "/details", "/requests", "/privacy", "/invites", "/teams", "/labels", "/serving"]) {
      await page.goto(`/g/${GROUP_B}/settings${path}`);
      await page.waitForURL(`/g/${GROUP_B}/dashboard`);
      await expect(page.getByRole("link", { name: /^Group settings/ }), path).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Group settings navigation" }), path).toHaveCount(0);
      await expect(page.getByText(AMELIA.name), path).toHaveCount(0);
    }
  });
});

test.describe("the same leader reviewing", () => {
  test.use({ persona: "leadsB" });

  test("declines on Group B and approves on Group C, and each group's count goes", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/settings/requests`);
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("Request declined.")).toBeVisible();
    await expect(page.getByText(AMELIA.name)).toHaveCount(0);
    await expect(settingsNav(page).getByRole("link", { name: /^Requests/ })).toHaveAccessibleName("Requests");

    await page.goto(`/g/${GROUP_C}/settings/requests`);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(`${ISAAC.name} joined Group C.`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(settingsNav(page).getByRole("link", { name: /^Requests/ })).toHaveAccessibleName("Requests");

    await page.goto(`/g/${GROUP_B}/dashboard`);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Group settings/ }),
    ).toHaveAccessibleName("Group settings");
  });
});
