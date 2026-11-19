import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, PASSWORD, PERSONAS } from "./fixtures/personas";

// Every seeded person has finished setup, so the member who hasn't is created
// here through the stack's own Postgres container, and the hooks remove them
// and the household they add.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const NEWCOMER = {
  id: "0e2e0000-0000-4000-8000-000000000341",
  email: "newcomer.setup@example.test",
  first: "Nora",
  last: "Setupwell",
};
const HOUSEHOLD = `${NEWCOMER.last} Family`;

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

function removeEverythingCreated() {
  sql(`
    delete from public.family_units where family_name = '${HOUSEHOLD}';
    delete from auth.users where id = '${NEWCOMER.id}';
    delete from public.access_requests where email = '${NEWCOMER.email}';`);
}

test.beforeAll(() => {
  removeEverythingCreated();
  const org = sql(`select org_id from public.profiles where email = '${PERSONAS.admin.email}';`);
  sql(`
    insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
    values ('${org}', '${NEWCOMER.first} ${NEWCOMER.last}', '${NEWCOMER.email}', 'approved', 'member', now());
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current, email_change_confirm_status,
      phone_change, phone_change_token, raw_app_meta_data, raw_user_meta_data
    ) values (
      '${NEWCOMER.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      '${NEWCOMER.email}', crypt('${PASSWORD}', gen_salt('bf', 10)), now(), now(), now(), '', '', '',
      '', '', 0, '', '',
      '{"provider": "email", "providers": ["email"], "org_id": "${org}"}',
      '{"first_name": "${NEWCOMER.first}", "last_name": "${NEWCOMER.last}"}'
    );
    update public.profiles
       set role = 'member', approved_at = now(), setup_completed = false, family_id = null
     where id = '${NEWCOMER.id}';
    insert into public.group_members (org_id, group_id, profile_id)
    values ('${org}', '${GROUP_B}', '${NEWCOMER.id}');`);
});
test.afterAll(() => removeEverythingCreated());

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(NEWCOMER.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign In" }).click();
}

test("a member who hasn't finished setup is sent to it, adds a household and lands on Home", async ({ page }) => {
  await signIn(page);
  await page.waitForURL("**/profile/setup");

  for (const path of ["/dashboard", "/directory", `/g/${GROUP_B}/calendar`, "/profile"]) {
    await page.goto(path);
    expect(new URL(page.url()).pathname, path).toBe("/profile/setup");
  }

  await page.getByLabel("First name").fill(NEWCOMER.first);
  await page.getByLabel("Last name").fill(NEWCOMER.last);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Find my household" }).click();
  await page.getByRole("button", { name: "Add household", exact: true }).click();
  await expect(page.getByText("Household added.")).toBeVisible();
  await expect(page.getByText(HOUSEHOLD)).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto("/directory/families");
  expect(new URL(page.url()).pathname).toBe("/directory/families");
  const household = page.getByRole("button", { name: new RegExp(`^[A-Z] ${HOUSEHOLD}\\b`) });
  await expect(household).toBeVisible();
  await expect(household).toHaveAccessibleName(`S ${HOUSEHOLD} ${NEWCOMER.first}`);
});
