import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { PASSWORD, PERSONAS } from "./fixtures/personas";
import { requireRecordsSecret } from "./fixtures/recordsSecret";

// The consent box a person joining two42 sees at profile setup when their
// church sends new people to its records, and its absence when the church
// doesn't. No records are called: the connection and the setting are fixture
// rows written through the stack's own Postgres container, and nothing is
// ticked or finished, so nothing is ever sent. The newcomer is created here,
// since every seeded person has finished setup. A connection someone made by
// hand on the shared stack stops the spec rather than being replaced.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const FIXTURE_URL = "https://records.example.test";
const NEWCOMER = {
  id: "0e2e0000-0000-4000-8000-000000000342",
  email: "newcomer.share@example.test",
  first: "Owen",
  last: "Sharewell",
};

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

const org = `(select org_id from public.profiles where email = '${PERSONAS.admin.email}')`;

// The stack is shared, so only this spec's own rows are ever removed; the setting goes with its connection.
function removeFixtures() {
  sql(`delete from public.records_connections where org_id = ${org} and base_url = '${FIXTURE_URL}';
       delete from auth.users where id = '${NEWCOMER.id}';
       delete from public.access_requests where email = '${NEWCOMER.email}';`);
}

let church = "";

test.beforeAll(() => {
  requireRecordsSecret();
  const existing = sql(`select count(*) from public.records_connections
                         where org_id = ${org} and base_url <> '${FIXTURE_URL}';`);
  if (existing !== "0") {
    throw new Error("The seeded church already has a records connection on this stack; this spec won't replace it.");
  }
  removeFixtures();
  church = sql(`select coalesce(nullif(trim(branding->>'display_name'), ''), name)
                  from public.organizations where id = ${org};`);
  sql(`
    insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint)
      values (${org}, 'rock', '${FIXTURE_URL}', 'k1.fixture.fixture.fixture', 'test');
    insert into public.records_intake_settings (org_id, connection_id, key_ciphertext, key_hint, destination_id, destination_name)
      select org_id, connection_id, 'k1.fixture.fixture.write', 'test', '9999', 'New people from two42'
        from public.records_connections where org_id = ${org};
    insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
      values (${org}, '${NEWCOMER.first} ${NEWCOMER.last}', '${NEWCOMER.email}', 'approved', 'member', now());
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current, email_change_confirm_status,
      phone_change, phone_change_token, raw_app_meta_data, raw_user_meta_data
    ) values (
      '${NEWCOMER.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      '${NEWCOMER.email}', crypt('${PASSWORD}', gen_salt('bf', 10)), now(), now(), now(), '', '', '',
      '', '', 0, '', '',
      json_build_object('provider', 'email', 'providers', json_build_array('email'), 'org_id', ${org}),
      '{"first_name": "${NEWCOMER.first}", "last_name": "${NEWCOMER.last}"}'
    );
    update public.profiles
       set role = 'member', approved_at = now(), setup_completed = false, family_id = null,
           first_name = '${NEWCOMER.first}', last_name = '${NEWCOMER.last}'
     where id = '${NEWCOMER.id}';`);
});
test.afterAll(() => removeFixtures());

async function openContactStep(page: Page) {
  await page.goto("/profile/setup");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByLabel("Mobile phone", { exact: false })).toBeVisible();
}

test("with sending new people on, profile setup offers the consent box unticked; with it off, there is none", async ({
  page,
}) => {
  expect(church).not.toBe("");
  await page.goto("/login");
  await page.getByLabel("Email").fill(NEWCOMER.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/profile/setup");

  await openContactStep(page);
  const box = page.getByRole("checkbox", { name: `Share my details with ${church}'s office` });
  await expect(box).toBeVisible();
  await expect(box).not.toBeChecked();
  await expect(page.getByText("Sends your name, email and phone to the church office once")).toBeVisible();

  sql(`delete from public.records_intake_settings where org_id = ${org};`);
  await openContactStep(page);
  await expect(page.getByRole("checkbox", { name: /Share my details/ })).toHaveCount(0);
});
