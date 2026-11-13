import { execFileSync } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { storedForm } from "../lib/prayer/crypto";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, PASSWORD, PERSONAS } from "./fixtures/personas";
import { prayerKeys } from "./fixtures/prayerKeys";

// Every person deleted here is created here, through the stack's own Postgres
// container, and afterAll removes any a failed test left behind. A seeded person
// is never the target of a delete: the church admin below only opens the
// confirmation, which the last-admin rule stops before it appears.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const STORAGE_CONTAINER = "supabase_storage_small-group-hub";
const OTHER_ORG = "0e2e0000-0000-4000-8000-000000000154";

const LEAVER = {
  id: "0e2e0000-0000-4000-8000-000000000001",
  email: "leaver.e2e@example.test",
  name: "Leaver Spec",
};
const REMOVED = {
  id: "0e2e0000-0000-4000-8000-000000000002",
  email: "removed.e2e@example.test",
  name: "Removed Spec",
};
const OUTSIDER = {
  id: "0e2e0000-0000-4000-8000-000000000003",
  email: "outsider.e2e@example.test",
  name: "Outsider Spec",
};
const FUND = "Spec fund for the leaver";
const SECOND_FUND = "Spec fund with a second person";
const SECOND_PERSON = PERSONAS.oneGroup;
const OLD_ADDRESS = "leaver.old@deletion.spec.test";
const SPOUSE_NAME = "Spec Spouse";
const SPOUSE_SETUP_LINK = "deletion-spec-spouse-setup-link";
const HOUSEHOLD = "Spec household for the leaver";
const STORAGE_API = "http://127.0.0.1:54321/storage/v1/object/avatars";
const ANONYMOUS_BODY = "Account deletion check: an anonymous request.";
// No foreign key reaches a request stored this way, only the author hash.
const HASHED = { id: "0e2e0000-0000-4000-8000-000000000157", body: "Account deletion check: a hashed request." };

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

function createPerson(person: typeof LEAVER, org: string) {
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
    update public.profiles set setup_completed = true, approved_at = now(), role = 'member'
    where id = '${person.id}';`);
}

function photoKey(org: string) {
  return `${org}/profiles/${LEAVER.id}/avatar.jpg`;
}

async function photo(method: "POST" | "DELETE", org: string) {
  const key = execFileSync("docker", ["exec", STORAGE_CONTAINER, "printenv", "SERVICE_KEY"], {
    encoding: "utf8",
  }).trim();
  const res = await fetch(`${STORAGE_API}/${photoKey(org)}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      ...(method === "POST" ? { "Content-Type": "image/jpeg", "x-upsert": "true" } : {}),
    },
    ...(method === "POST" ? { body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) } : {}),
  });
  if (method === "POST" && !res.ok) throw new Error(`photo upload: ${res.status}`);
}

function photoCount(org: string) {
  return sql(`select count(*) from storage.objects where bucket_id = 'avatars' and name = '${photoKey(org)}';`);
}

function removeEverythingCreated() {
  const ids = [LEAVER, REMOVED, OUTSIDER].map((p) => `'${p.id}'`).join(",");
  const emails = [LEAVER, REMOVED, OUTSIDER].map((p) => `'${p.email}'`).join(",");
  sql(`
    delete from public.giving_funds where name in ('${FUND}', '${SECOND_FUND}');
    delete from public.prayer_requests where id = '${HASHED.id}';
    delete from auth.users where id in (${ids});
    delete from public.access_requests where email in (${emails}, '${OLD_ADDRESS}');
    delete from public.family_units where family_name = '${HOUSEHOLD}';
    delete from public.organizations where id = '${OTHER_ORG}';`);
}

let seedOrg: string;

test.beforeAll(async () => {
  removeEverythingCreated();
  seedOrg = sql(`select org_id from public.profiles where email = '${PERSONAS.admin.email}';`);
  sql(`insert into public.organizations (id, name) values ('${OTHER_ORG}', 'Spec Other Church');`);
  createPerson(LEAVER, seedOrg);
  createPerson(REMOVED, seedOrg);
  createPerson(OUTSIDER, OTHER_ORG);
  const hashed = storedForm(prayerKeys(), {
    id: HASHED.id,
    orgId: seedOrg,
    text: HASHED.body,
    author: { anonymous: true, authorId: LEAVER.id },
  });
  sql(`
    insert into public.prayer_requests (id, org_id, group_id, is_anonymous, body_ciphertext, author_hash)
    values ('${HASHED.id}', '${seedOrg}', '${GROUP_B}', true, '${hashed.body_ciphertext}', '${hashed.author_hash}');`);
  sql(`
    insert into public.group_members (org_id, group_id, profile_id)
    values ('${seedOrg}', '${GROUP_B}', '${LEAVER.id}')
    on conflict (group_id, profile_id) do nothing;
    insert into public.prayer_requests (org_id, group_id, author_id, body, is_anonymous)
    values ('${seedOrg}', '${GROUP_B}', '${LEAVER.id}', '${ANONYMOUS_BODY}', true);
    insert into public.giving_funds (org_id, group_id, name, steward_id)
    values ('${seedOrg}', '${GROUP_B}', '${FUND}', '${LEAVER.id}');
    insert into public.giving_funds (org_id, group_id, name, steward_id, co_steward_id, steward_role)
    select '${seedOrg}', '${GROUP_B}', '${SECOND_FUND}', '${LEAVER.id}', m.profile_id, 'Treasurer'
    from public.group_members m join public.profiles p on p.id = m.profile_id
    where m.group_id = '${GROUP_B}' and p.email = '${SECOND_PERSON.email}';
    insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at, signup_token)
    values ('${seedOrg}', '${LEAVER.name}', '${LEAVER.email}', 'approved', 'member', now(), null),
           ('${seedOrg}', '${SPOUSE_NAME}', '${OLD_ADDRESS}', 'approved', 'member', now(), '${SPOUSE_SETUP_LINK}');
    with household as (
      insert into public.family_units (org_id, family_name) values ('${seedOrg}', '${HOUSEHOLD}') returning id
    ), own as (
      insert into public.family_members (org_id, family_id, first_name, relationship, claimed_profile_id)
      select '${seedOrg}', id, 'Leaver', 'primary', '${LEAVER.id}' from household returning id, family_id
    ), child as (
      insert into public.family_members (org_id, family_id, first_name, relationship)
      select '${seedOrg}', id, 'Invited', 'other' from household returning id, family_id
    )
    insert into public.family_invites (org_id, family_id, family_member_id, invite_email, accepted_at)
    select '${seedOrg}'::uuid, family_id, id, '${OLD_ADDRESS}', now() from own
    union all
    select '${seedOrg}'::uuid, family_id, id, '${LEAVER.email}', null from child;
    insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at, invite_token)
    select '${seedOrg}', '${LEAVER.name}', '${OLD_ADDRESS}', 'approved', 'member', now(), token
    from public.family_invites where invite_email = '${OLD_ADDRESS}' and org_id = '${seedOrg}';`);
  await photo("POST", seedOrg);
});
test.afterAll(async () => {
  try {
    await photo("DELETE", seedOrg);
  } finally {
    removeEverythingCreated();
  }
});

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign In" }).click();
}

async function signedInAs(browser: Browser, baseURL: string, email: string) {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await signIn(page, email);
  await page.waitForURL((url) => url.pathname !== "/login");
  return page;
}

function countOf(table: string, column: string, id: string) {
  return sql(`select count(*) from ${table} where ${column} = '${id}';`);
}

test("a member's download holds their own data and no other member's", async ({ browser, baseURL }) => {
  const page = await signedInAs(browser, baseURL!, LEAVER.email);
  await page.goto("/settings");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");

  expect(text).toContain(LEAVER.email);
  expect(text).toContain(ANONYMOUS_BODY);
  expect(text).toContain(HASHED.body);
  expect(JSON.parse(text).funds_you_receive.map((f: { fund: string }) => f.fund)).toContain(FUND);
  for (const other of Object.values(PERSONAS)) {
    expect(text).not.toContain(other.name);
    expect(text).not.toContain(other.email);
  }
  await page.context().close();
});

test("a person deletes their own account and can't sign in afterwards", async ({ browser, baseURL }) => {
  const page = await signedInAs(browser, baseURL!, LEAVER.email);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete my account" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Your prayer requests, including anonymous ones")).toBeVisible();
  await expect(dialog.getByText(new RegExp(`The ${FUND} fund in .*payment methods, off Give`))).toBeVisible();
  await expect(
    dialog.getByText(new RegExp(`The ${SECOND_FUND} fund in .*goes to ${SECOND_PERSON.name}, off Give`)),
  ).toBeVisible();
  await expect(dialog.getByText(/doesn't include your photo/)).toBeVisible();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(countOf("public.profiles", "id", LEAVER.id)).toBe("1");
  expect(photoCount(seedOrg)).toBe("1");

  await page.getByRole("button", { name: "Delete my account" }).click();
  await dialog.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL("**/login");

  expect(countOf("auth.users", "id", LEAVER.id)).toBe("0");
  expect(countOf("public.profiles", "id", LEAVER.id)).toBe("0");
  expect(photoCount(seedOrg)).toBe("0");
  expect(sql(`select count(*) from public.prayer_requests where body = '${ANONYMOUS_BODY}';`)).toBe("0");
  expect(countOf("public.prayer_requests", "id", HASHED.id)).toBe("0");
  expect(
    sql(`select concat_ws('|', steward_id is null, needs_review) from public.giving_funds where name = '${FUND}';`),
  ).toBe("t|t");
  expect(
    sql(`select concat_ws('|', p.email, f.co_steward_id is null, f.steward_role is null, f.is_active, f.needs_review)
         from public.giving_funds f join public.profiles p on p.id = f.steward_id
         where f.name = '${SECOND_FUND}';`),
  ).toBe(`${SECOND_PERSON.email}|t|t|t|t`);
  expect(sql(`select count(*) from public.access_requests where email = '${LEAVER.email}';`)).toBe("0");
  expect(sql(`select name from public.access_requests where email = '${OLD_ADDRESS}';`)).toBe(SPOUSE_NAME);
  expect(sql(`select count(*) from public.family_invites where invite_email in ('${LEAVER.email}', '${OLD_ADDRESS}');`)).toBe("0");

  await signIn(page, LEAVER.email);
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/login");
  await page.context().close();
});

test.describe("a member", () => {
  test.use({ persona: "oneGroup" });

  test("is refused the admin route, and the person stays", async ({ page }) => {
    const res = await page.request.delete(`/api/admin/members/${REMOVED.id}`);
    expect(res.status()).toBe(403);
    expect((await page.request.get(`/api/admin/members/${REMOVED.id}`)).status()).toBe(403);
    expect(countOf("public.profiles", "id", REMOVED.id)).toBe("1");
  });
});

test.describe("a church admin", () => {
  test.use({ persona: "admin" });

  test("can't reach someone in another church", async ({ page }) => {
    const res = await page.request.delete(`/api/admin/members/${OUTSIDER.id}`);
    expect(res.status()).toBe(404);
    expect((await page.request.get(`/api/admin/members/${OUTSIDER.id}`)).status()).toBe(404);
    expect(countOf("auth.users", "id", OUTSIDER.id)).toBe("1");
    expect(countOf("public.profiles", "id", OUTSIDER.id)).toBe("1");
  });

  test("is told a church needs an admin, with no confirmation offered", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByText(/A church needs at least one church admin/)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("is refused their own id on the admin route", async ({ page }) => {
    const id = sql(`select id from public.profiles where email = '${PERSONAS.admin.email}';`);
    expect((await page.request.delete(`/api/admin/members/${id}`)).status()).toBe(403);
    expect(countOf("auth.users", "id", id)).toBe("1");
  });

  test("deletes a member's account, who leaves no row behind", async ({ page }) => {
    await page.goto("/admin/members");
    const search = page.getByLabel("Search members");
    await search.fill(PERSONAS.admin.email);
    const ownMenu = page.getByRole("button", { name: /^More actions for / });
    await expect(ownMenu).toHaveCount(1);
    await ownMenu.click();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete account" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await search.fill(REMOVED.email);
    await page.getByRole("button", { name: `More actions for ${REMOVED.name}` }).click();
    await page.getByRole("menuitem", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Delete ${REMOVED.name}'s account?` })).toBeVisible();
    await dialog.getByRole("button", { name: "Delete account" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("No members match that search.")).toBeVisible();
    expect(countOf("auth.users", "id", REMOVED.id)).toBe("0");
    expect(sql(`select count(*) from public.access_requests where email = '${REMOVED.email}';`)).toBe("0");
  });
});
