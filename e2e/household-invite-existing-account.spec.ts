import { execFileSync } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, openAs, test } from "./fixtures/auth";
import { PASSWORD, PERSONAS } from "./fixtures/personas";

// The household invite for someone who already has an account. The joiner,
// the outsider in another church, their household records and both invites
// are created here through the stack's own Postgres container and removed in
// beforeAll and afterAll; the Seedly household and Isaac come from the seed.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const OTHER_ORG = "0e2e0000-0000-4000-8000-000000000310";

const JOINER = {
  id: "0e2e0000-0000-4000-8000-000000000301",
  email: "robin.seedly.e2e@example.test",
  name: "Robin Seedly",
  member: "0e2e0000-0000-4000-8000-000000000321",
  token: "0e2e0000-0000-4000-8000-000000000331",
};
const OUTSIDER = {
  id: "0e2e0000-0000-4000-8000-000000000302",
  email: "outsider.household.e2e@example.test",
  name: "Outsider Household",
  member: "0e2e0000-0000-4000-8000-000000000322",
  token: "0e2e0000-0000-4000-8000-000000000332",
};
const PEOPLE = [JOINER, OUTSIDER];
const ISAAC = PERSONAS.oneGroup;

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

function createPerson(person: typeof JOINER, org: string) {
  const [first, last] = person.name.split(" ");
  sql(`
    insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
    values ('${org}', '${person.name}', '${person.email}', 'approved', 'member', now());
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current, email_change_confirm_status,
      phone_change, phone_change_token, raw_app_meta_data, raw_user_meta_data
    ) values (
      '${person.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      '${person.email}', crypt('${PASSWORD}', gen_salt('bf', 10)), now(), now(), now(), '', '', '',
      '', '', 0, '', '',
      '{"provider": "email", "providers": ["email"], "org_id": "${org}"}',
      '{"first_name": "${first}", "last_name": "${last}", "full_name": "${person.name}"}'
    );
    update public.profiles
    set setup_completed = true, approved_at = now(), role = 'member', family_id = null
    where id = '${person.id}';`);
}

function removeEverythingCreated() {
  const list = (key: "id" | "email" | "member" | "token") => PEOPLE.map((p) => `'${p[key]}'`).join(",");
  sql(`
    delete from public.family_invites where token in (${list("token")});
    delete from public.family_members where id in (${list("member")});
    delete from auth.users where id in (${list("id")});
    delete from public.access_requests where email in (${list("email")});
    delete from public.organizations where id = '${OTHER_ORG}';`);
}

test.beforeAll(() => {
  removeEverythingCreated();
  const [seedOrg, household, isaacId] = sql(
    `select org_id, family_id, id from public.profiles where email = '${ISAAC.email}';`,
  ).split("|");
  sql(`insert into public.organizations (id, name) values ('${OTHER_ORG}', 'Spec Other Church');`);
  createPerson(JOINER, seedOrg);
  createPerson(OUTSIDER, OTHER_ORG);
  for (const person of PEOPLE) {
    const [first, last] = person.name.split(" ");
    sql(`
      insert into public.family_members (id, org_id, family_id, first_name, last_name, relationship)
      values ('${person.member}', '${seedOrg}', '${household}', '${first}', '${last}', 'other');
      insert into public.family_invites (org_id, family_id, family_member_id, invite_email, token, created_by)
      values ('${seedOrg}', '${household}', '${person.member}', '${person.email}', '${person.token}', '${isaacId}');`);
  }
});

test.afterAll(() => {
  removeEverythingCreated();
});

async function signedOut(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

async function signIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign In" }).click();
}

function card(page: Page, heading: string) {
  return page.locator('[data-slot="card"]', { has: page.getByRole("heading", { name: heading }) });
}

async function isaacsHousehold(browser: Browser, baseURL: string) {
  const { context, page } = await openAs(browser, baseURL, "oneGroup");
  await page.goto("/profile?tab=household");
  await expect(card(page, "Members with an account")).toBeVisible();
  return { context, page };
}

test("before joining, the invited person is listed as a record without an account", async ({ browser, baseURL }) => {
  const { context, page } = await isaacsHousehold(browser, baseURL!);
  await expect(card(page, "Members with an account")).not.toContainText(JOINER.name);
  await expect(card(page, "Others in your household")).toContainText(JOINER.name);
  await context.close();
});

test("a person with an account signs in from the invite, returns to it and joins", async ({ browser, baseURL }) => {
  const { context, page } = await signedOut(browser, baseURL!);
  const invite = `/join/family/${JOINER.token}`;
  await page.goto(invite);
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\?redirect=/);

  await signIn(page, JOINER.email);
  await page.waitForURL((url) => url.pathname === invite);
  await expect(page.getByRole("heading", { name: "Join this household" })).toBeVisible();
  await expect(page.getByText("Seedly household").first()).toBeVisible();

  await page.getByRole("button", { name: "Join household" }).click();
  await page.waitForURL((url) => url.pathname === "/profile");
  await expect(card(page, "Members with an account")).toContainText(ISAAC.name);

  const again = await page.request.post("/api/family-invites/join", { data: { token: JOINER.token } });
  expect(again.status()).toBe(200);
  await context.close();
});

test("after joining, the person is listed once as a member with an account", async ({ browser, baseURL }) => {
  const { context, page } = await isaacsHousehold(browser, baseURL!);
  await expect(card(page, "Members with an account").getByText(JOINER.name, { exact: true })).toHaveCount(1);
  await expect(card(page, "Others in your household")).not.toContainText(JOINER.name);
  await context.close();

  const joiner = await signedOut(browser, baseURL!);
  await joiner.page.goto("/login");
  await signIn(joiner.page, JOINER.email);
  await joiner.page.waitForURL((url) => url.pathname !== "/login");
  await joiner.page.goto(`/join/family/${JOINER.token}`);
  await expect(joiner.page.getByText("This link isn't valid anymore")).toBeVisible();
  await joiner.context.close();
});

test("an invite is refused for another address and for someone in another church", async ({ browser, baseURL }) => {
  const invite = `/join/family/${OUTSIDER.token}`;

  const leo = await openAs(browser, baseURL!, "twoGroups");
  await leo.page.goto(invite);
  await expect(leo.page.getByRole("heading", { name: "This link is for a different account" })).toBeVisible();
  await expect(leo.page.getByRole("button", { name: "Join household" })).toHaveCount(0);
  expect((await leo.page.request.post("/api/family-invites/join", { data: { token: OUTSIDER.token } })).status()).toBe(403);
  await leo.context.close();

  const outsider = await signedOut(browser, baseURL!);
  await outsider.page.goto("/login");
  await signIn(outsider.page, OUTSIDER.email);
  await outsider.page.waitForURL((url) => url.pathname !== "/login");
  await outsider.page.goto(invite);
  await expect(outsider.page.getByRole("heading", { name: "This link is for a different account" })).toBeVisible();
  await expect(outsider.page.getByRole("button", { name: "Join household" })).toHaveCount(0);
  expect((await outsider.page.request.post("/api/family-invites/join", { data: { token: OUTSIDER.token } })).status()).toBe(403);
  await outsider.context.close();

  const { context, page } = await isaacsHousehold(browser, baseURL!);
  await expect(card(page, "Members with an account")).not.toContainText(OUTSIDER.name);
  await context.close();
});
