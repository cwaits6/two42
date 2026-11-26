import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures/auth";
import { PERSONAS } from "./fixtures/personas";
import { requireRecordsSecret } from "./fixtures/recordsSecret";

// What a member sees once their church copies their details from its records,
// and what a household's primary sees of their spouse's. No records are
// called: the connection, Isaac's and Chloe's links, the church's settings and
// where each value came from are written here as fixture rows through the
// stack's own Postgres container, and afterAll removes them with the
// connection and puts Isaac's seeded mobile number back.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const ISAAC = PERSONAS.oneGroup.email;
const CHLOE = PERSONAS.spouse.email;
const CHURCH_MOBILE = "+15125550199";
// Undefined until captured, so a failed setup never writes over the seeded number.
let seededMobile: string | undefined;

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

const isaac = `(select id from public.profiles where email = '${ISAAC}')`;
const chloe = `(select id from public.profiles where email = '${CHLOE}')`;
const org = `(select org_id from public.profiles where email = '${ISAAC}')`;

function removeFixtures() {
  sql(`delete from public.records_connections where org_id = ${org};
       delete from public.records_field_settings where org_id = ${org};`);
}

test.beforeAll(() => {
  requireRecordsSecret();
  seededMobile = sql(`select coalesce(phone_mobile, '') from public.profiles where email = '${ISAAC}';`);
  removeFixtures();
  sql(`
    insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint)
      values (${org}, 'rock', 'https://records.example.test', 'k1.fixture.fixture.fixture', 'test');
    insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
      select org_id, connection_id, l.profile_id, l.person from public.records_connections,
             (values (${isaac}, 'e2e-1001'), (${chloe}, 'e2e-1002')) l(profile_id, person)
       where org_id = ${org};
    insert into public.records_field_settings (org_id, field, mode)
      values (${org}, 'name', 'locked'), (${org}, 'phone_mobile', 'member'), (${org}, 'anniversary', 'member');
    insert into public.records_field_values (org_id, profile_id, field, state, church_value)
      values (${org}, ${isaac}, 'name', 'records', '{"first_name": "Isaac", "last_name": "Seedly"}'),
             (${org}, ${isaac}, 'phone_mobile', 'changed', '{"phone_mobile": "${CHURCH_MOBILE}"}'),
             (${org}, ${chloe}, 'name', 'records',
              (select jsonb_build_object('first_name', first_name, 'last_name', last_name) from public.profiles where email = '${CHLOE}')),
             (${org}, ${chloe}, 'anniversary', 'records',
              (select jsonb_build_object('anniversary_month', f.anniversary_month, 'anniversary_day', f.anniversary_day,
                                         'anniversary_year', f.anniversary_year)
                 from public.family_units f join public.profiles p on p.family_id = f.id where p.email = '${CHLOE}'));
    insert into public.records_person_state (org_id, profile_id, copied_at, notice_filled_at)
      values (${org}, ${isaac}, now(), now());`);
});

test.afterAll(() => {
  if (seededMobile === undefined) return;
  removeFixtures();
  sql(`update public.profiles set phone_mobile = nullif('${seededMobile}', '') where email = '${ISAAC}';`);
});

test.describe("a linked member", () => {
  test.use({ persona: "oneGroup" });

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
});

test.describe("a household's primary editing their linked spouse", () => {
  test.use({ persona: "householdPrimary" });

  test("sees the spouse's locked name as managed by the church, and where the anniversary came from", async ({ page }) => {
    await page.goto("/profile?tab=household");
    await expect(page.getByText("From your church's records")).toBeVisible();
    await page.getByRole("button", { name: `Edit ${PERSONAS.spouse.name}` }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Managed by your church").first()).toBeVisible();
    await expect(sheet.getByRole("textbox", { name: "First name" })).toHaveCount(0);
  });
});
