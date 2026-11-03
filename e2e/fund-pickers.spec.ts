import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, openAs, test } from "./fixtures/auth";
import { GROUP_B, GROUP_C, PERSONAS } from "./fixtures/personas";

const OTHER_ORG = "f0000000-0000-4000-8000-0000000000f1";
const OTHER_PERSON = {
  id: "f0000000-0000-4000-8000-0000000000f2",
  email: "fund.picker.other@example.test",
  name: "Otto Otherchurch",
};
const IN_REVIEW = "Spec fund in review";
const NO_RECIPIENT = "Spec fund with no recipient";

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "supabase_db_small-group-hub", "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

function removeEverythingCreated() {
  sql(`
    delete from public.giving_funds where name in ('${IN_REVIEW}', '${NO_RECIPIENT}');
    delete from public.group_members where group_id = '${GROUP_B}'
      and profile_id = (select id from public.profiles where email = '${PERSONAS.leadsC.email}');
    delete from auth.users where id = '${OTHER_PERSON.id}';
    delete from public.access_requests where email = '${OTHER_PERSON.email}';
    delete from public.organizations where id = '${OTHER_ORG}';`);
}

test.beforeAll(() => {
  removeEverythingCreated();
  const profile = (email: string) => `(select id from public.profiles where email = '${email}')`;
  const orgId = sql(`select org_id from public.groups where id = '${GROUP_B}';`);
  sql(`
    insert into public.organizations (id, name) values ('${OTHER_ORG}', 'Spec Other Church');
    insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
      values ('${OTHER_ORG}', '${OTHER_PERSON.name}', '${OTHER_PERSON.email}', 'approved', 'member', now());
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
      values ('${OTHER_PERSON.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              '${OTHER_PERSON.email}', 'x', now(), now(),
              '{"org_id": "${OTHER_ORG}"}', '{"first_name": "Otto", "last_name": "Otherchurch"}');
    insert into public.group_members (org_id, group_id, profile_id, role)
      values ('${orgId}', '${GROUP_B}', ${profile(PERSONAS.leadsC.email)}, 'leader');
    insert into public.giving_funds (org_id, group_id, name, steward_id, needs_review)
      values ('${orgId}', '${GROUP_B}', '${IN_REVIEW}', ${profile(PERSONAS.twoGroups.email)}, true),
             ('${orgId}', '${GROUP_B}', '${NO_RECIPIENT}', null, true);
    insert into public.giving_fund_methods (fund_id, org_id, group_id, method, custom_handle)
      select id, org_id, group_id, 'venmo', '@spec' from public.giving_funds
      where name in ('${IN_REVIEW}', '${NO_RECIPIENT}');`);
});

test.afterAll(removeEverythingCreated);

async function optionsIn(page: Page, label: string): Promise<string[]> {
  const input = page.getByLabel(label);
  await input.click();
  await input.fill("");
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  const names = (await options.allTextContents()).map((text) => text.trim());
  await page.keyboard.press("Escape");
  return names;
}

const RECIPIENT = "Who receives it?";
const SECOND_PERSON = "Second person (optional)";

test("a leader of two groups is offered only the current group's members in both pickers", async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL!;
  const leader = await openAs(browser, baseURL, "leadsC");
  try {
    await leader.page.goto(`/g/${GROUP_C}/give/new`);
    for (const label of [RECIPIENT, SECOND_PERSON]) {
      const names = await optionsIn(leader.page, label);
      expect(names).toContain("Walter Nullington");
      expect(names).not.toContain(PERSONAS.oneGroup.name);
      expect(names).not.toContain(OTHER_PERSON.name);
    }

    await leader.page.goto(`/g/${GROUP_B}/give/new`);
    for (const label of [RECIPIENT, SECOND_PERSON]) {
      const names = await optionsIn(leader.page, label);
      expect(names).toContain(PERSONAS.oneGroup.name);
      expect(names).not.toContain("Walter Nullington");
      expect(names).not.toContain(OTHER_PERSON.name);
    }
  } finally {
    await leader.context.close();
  }
});

test("a church admin is offered only the current group's members, not everyone they can read", async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL!;
  const admin = await openAs(browser, baseURL, "admin");
  try {
    await admin.page.goto(`/g/${GROUP_B}/dashboard`);
    await admin.page.getByRole("button", { name: "Switch group. Current group: Group B" }).click();
    await admin.page.getByRole("menuitem").filter({ hasText: "Group A" }).click();
    await admin.page.waitForURL(
      (url) => /^\/g\/[0-9a-f-]{36}\//.test(url.pathname) && !url.pathname.includes(GROUP_B),
    );
    const groupAId = new URL(admin.page.url()).pathname.split("/")[2];

    await admin.page.goto(`/g/${groupAId}/give/new`);
    for (const label of [RECIPIENT, SECOND_PERSON]) {
      const names = await optionsIn(admin.page, label);
      expect(names).toContain("Mia Fakeworth");
      expect(names).not.toContain(PERSONAS.oneGroup.name);
      expect(names).not.toContain(PERSONAS.leadsC.name);
      expect(names).not.toContain(OTHER_PERSON.name);
    }
  } finally {
    await admin.context.close();
  }
});

test("a member adding their own fund is offered only the current group's members as second person", async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL!;
  const member = await openAs(browser, baseURL, "oneGroup");
  try {
    await member.page.goto(`/g/${GROUP_B}/give/new`);
    const names = await optionsIn(member.page, SECOND_PERSON);
    expect(names).toContain(PERSONAS.leadsB.name);
    expect(names).not.toContain("Walter Nullington");
    expect(names).not.toContain(OTHER_PERSON.name);
  } finally {
    await member.context.close();
  }
});

test("a paused fund is off Give for a member, and a leader can reach it with its status", async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL!;
  const member = await openAs(browser, baseURL, "oneGroup");
  const leader = await openAs(browser, baseURL, "leadsB");
  try {
    await member.page.goto(`/g/${GROUP_B}/give`);
    await expect(member.page.getByRole("heading", { name: "Give" })).toBeVisible();
    await expect(member.page.getByText(IN_REVIEW)).toHaveCount(0);
    await expect(member.page.getByText(NO_RECIPIENT)).toHaveCount(0);

    await leader.page.goto(`/g/${GROUP_B}/give`);
    const hidden = leader.page.getByRole("region", { name: "Hidden from members" });
    await expect(hidden.getByText(IN_REVIEW)).toBeVisible();
    await expect(hidden.getByText("Needs review")).toBeVisible();
    await expect(hidden.getByText(NO_RECIPIENT)).toBeVisible();
    await expect(hidden.getByText("Needs a recipient")).toBeVisible();
    await expect(hidden.getByLabel(`Review ${NO_RECIPIENT}`)).toBeVisible();
  } finally {
    await member.context.close();
    await leader.context.close();
  }
});
