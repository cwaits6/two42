import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures/auth";
import { PERSONAS } from "./fixtures/personas";
import { requireRecordsSecret } from "./fixtures/recordsSecret";

// What a member sees once their church copies their details from its records.
// No records are called: the connection, Isaac's link, the church's settings
// and where each of his values came from are written here as fixture rows
// through the stack's own Postgres container, and afterAll removes them with
// the connection and puts his seeded mobile number back.
test.describe.configure({ mode: "serial" });
test.use({ persona: "oneGroup" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const ISAAC = PERSONAS.oneGroup.email;
const CHURCH_MOBILE = "+15125550199";
let seededMobile = "";

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

const isaac = `(select id from public.profiles where email = '${ISAAC}')`;
const org = `(select org_id from public.profiles where email = '${ISAAC}')`;

function removeFixtures() {
  sql(`delete from public.records_connections where org_id = ${org};
       delete from public.records_field_settings where org_id = ${org};`);
}

test.beforeAll(() => {
  requireRecordsSecret();
  removeFixtures();
  seededMobile = sql(`select coalesce(phone_mobile, '') from public.profiles where email = '${ISAAC}';`);
  sql(`
    insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint)
      values (${org}, 'rock', 'https://records.example.test', 'k1.fixture.fixture.fixture', 'test');
    insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
      select org_id, connection_id, ${isaac}, 'e2e-1001' from public.records_connections where org_id = ${org};
    insert into public.records_field_settings (org_id, field, mode)
      values (${org}, 'name', 'locked'), (${org}, 'phone_mobile', 'member');
    insert into public.records_field_values (org_id, profile_id, field, state, church_value)
      values (${org}, ${isaac}, 'name', 'records', '{"first_name": "Isaac", "last_name": "Seedly"}'),
             (${org}, ${isaac}, 'phone_mobile', 'changed', '{"phone_mobile": "${CHURCH_MOBILE}"}');
    insert into public.records_person_state (org_id, profile_id, copied_at, notice_filled_at)
      values (${org}, ${isaac}, now(), now());`);
});

test.afterAll(() => {
  removeFixtures();
  sql(`update public.profiles set phone_mobile = nullif('${seededMobile}', '') where email = '${ISAAC}';`);
});

test("the one-time notice shows until the member says they've seen it", async ({ page }) => {
  await page.goto("/profile");
  const notice = page.getByRole("region", { name: "Your church filled in some of your details from its records." });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Got it" }).click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
  await expect(notice).toBeHidden();
});

test("a locked name is managed by the church and has no field to edit", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByText("Managed by your church").first()).toBeVisible();
  await expect(page.getByText("Seedly", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "First name" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Last name" })).toHaveCount(0);
});

test("a mobile number the member changed offers the church's value back", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByText("Changed in two42")).toBeVisible();
  await page.getByRole("button", { name: "Use your church's value" }).click();
  await expect(page.getByRole("textbox", { name: "Mobile phone (optional)" })).toHaveValue("(512) 555-0199");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Mobile phone (optional)" })).toHaveValue("(512) 555-0199");
  await expect(page.getByText("From your church's records")).toBeVisible();
  await expect(page.getByText("Changed in two42")).toHaveCount(0);
});
