import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS } from "./fixtures/personas";

// The seed has no team lead, so both hooks build a Group B team with Leo as
// its lead and Henry as a plain member, through the stack's own Postgres
// container (the name `supabase start` gives it from config.toml's
// project_id), and the afterAll deletes it whatever happens between.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const TEAM_ID = "b0000000-0000-0000-0000-0000000000e2";
const TEAM_NAME = "Greeters";
const LEAD = PERSONAS.twoGroups;
const MEMBER = "Henry Mockingham";
const GROUP_B_ONLY = "Zoe Dummyfield";
const GROUP_C_ONLY = PERSONAS.leadsC.name;

const DROP_SQL = `
  delete from public.serving_team_settings where team_id = '${TEAM_ID}';
  delete from public.teams where id = '${TEAM_ID}';
`;

const SETUP_SQL = `
  ${DROP_SQL}
  insert into public.teams (id, org_id, group_id, name)
    select '${TEAM_ID}', g.org_id, g.id, '${TEAM_NAME}'
    from public.groups g where g.id = '${GROUP_B}';
  insert into public.serving_team_settings (org_id, team_id, enabled)
    select t.org_id, t.id, true from public.teams t where t.id = '${TEAM_ID}';
  insert into public.team_members (org_id, team_id, profile_id, is_leader)
    select t.org_id, t.id, p.id, p.email = '${LEAD.email}'
    from public.teams t
    join public.profiles p on p.org_id = t.org_id
    where t.id = '${TEAM_ID}'
      and (p.email = '${LEAD.email}'
        or (p.first_name, p.last_name) = ('Henry', 'Mockingham'));
`;

function runSql(sql: string) {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(() => runSql(SETUP_SQL));
test.afterAll(() => runSql(DROP_SQL));

const TEAM_PATH = `/g/${GROUP_B}/serving/${TEAM_ID}`;

test.describe("a team lead who does not lead the group", () => {
  test.use({ persona: "twoGroups" });

  test("adds and removes a group member, and is offered only the group's members", async ({ page }) => {
    await page.goto(TEAM_PATH);
    const roster = page.getByRole("region", { name: "Team members" });
    await expect(roster.getByText(LEAD.name)).toBeVisible();
    await expect(roster.getByText(MEMBER)).toBeVisible();
    await expect(roster.getByRole("button", { name: `Remove ${MEMBER} from ${TEAM_NAME}` })).toBeVisible();
    await expect(roster.getByRole("button", { name: `Remove ${LEAD.name} from ${TEAM_NAME}` })).toHaveCount(0);

    await roster.getByRole("button", { name: "Add person" }).click();
    const adding = page.getByRole("region", { name: `Add to ${TEAM_NAME}` });
    await expect(adding.getByRole("button", { name: `Add ${GROUP_B_ONLY} to ${TEAM_NAME}` })).toBeVisible();
    await expect(adding.getByText(GROUP_C_ONLY)).toHaveCount(0);
    await expect(adding.getByText(MEMBER)).toHaveCount(0);
    await expect(adding.getByText(LEAD.name)).toHaveCount(0);

    await adding.getByRole("button", { name: `Add ${GROUP_B_ONLY} to ${TEAM_NAME}` }).click();
    await expect(page.getByText(`Added ${GROUP_B_ONLY} to ${TEAM_NAME}.`)).toBeVisible();
    await expect(adding.getByText(GROUP_B_ONLY)).toHaveCount(0);

    await adding.getByRole("button", { name: "Done" }).click();
    await expect(roster.getByText(GROUP_B_ONLY)).toBeVisible();
    await roster.getByRole("button", { name: `Remove ${GROUP_B_ONLY} from ${TEAM_NAME}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove from team" }).click();
    await expect(page.getByText(`Removed ${GROUP_B_ONLY} from ${TEAM_NAME}.`)).toBeVisible();
    await expect(roster.getByText(GROUP_B_ONLY)).toHaveCount(0);
  });
});

test.describe("a group member who is not on the team", () => {
  test.use({ persona: "oneGroup" });

  test("sees no roster controls", async ({ page }) => {
    await page.goto(TEAM_PATH);
    await expect(page.getByRole("heading", { name: TEAM_NAME })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add person" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Team members" })).toHaveCount(0);
  });
});
