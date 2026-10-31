import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS } from "./fixtures/personas";

// Isaac is moved to pending and back inside the test, after the fixture has
// signed him in: a cold storage-state cache signs in through /login, which a
// pending account would leave for the pending card. Every other spec reads
// him as a member, so both hooks put him back whatever happens between. The
// role change goes through the stack's own Postgres container, the name
// `supabase start` gives it from config.toml's project_id.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const ISAAC = PERSONAS.oneGroup;
const ANNOUNCEMENT = "Parking lot repaving next week";

function setIsaacRole(role: "pending" | "member") {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c",
      `update public.profiles set role = '${role}' where email = '${ISAAC.email}';`],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(() => setIsaacRole("member"));
test.afterAll(() => setIsaacRole("member"));

test.describe("a member of Group B moved back to pending", () => {
  test.use({ persona: "oneGroup" });

  test("loses the group while pending and has it back once approved", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/announcements`);
    await expect(page.getByText(ANNOUNCEMENT)).toBeVisible();

    setIsaacRole("pending");

    for (const route of ["/dashboard", "/announcements", "/calendar", "/directory"]) {
      const response = await page.goto(`/g/${GROUP_B}${route}`);
      expect(response?.status(), route).toBe(404);
      await expect(page.getByText(ANNOUNCEMENT)).toHaveCount(0);
    }
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Pending Approval" })).toBeVisible();

    setIsaacRole("member");

    expect((await page.goto(`/g/${GROUP_B}/announcements`))?.status()).toBe(200);
    await expect(page.getByText(ANNOUNCEMENT)).toBeVisible();
  });
});
