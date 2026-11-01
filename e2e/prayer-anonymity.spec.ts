import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS, type PersonaKey } from "./fixtures/personas";

// The card masks on is_anonymous by itself, so this guards the rendered result;
// prayer_anonymity_suite.sql is what proves the column stays out of reach.
// Nothing in the UI deletes a request, so both hooks remove this spec's row
// through the stack's own Postgres container. Tests run in order: the author
// posts, the readers look, and the author marks it answered last so the
// dashboard still lists it.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const BODY = "Anonymity boundary check: please pray for a quiet week.";
const BY_NAME_BODY = "Ruth has a follow-up";
const BY_NAME_AUTHOR = PERSONAS.leadsB.name;
const AUTHOR = PERSONAS.oneGroup.name;
const PRAYER_PAGE = `/g/${GROUP_B}/prayer`;

function deleteSpecRow() {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-c",
      `delete from public.prayer_requests where body = '${BODY.replaceAll("'", "''")}';`],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.beforeAll(() => deleteSpecRow());
test.afterAll(() => deleteSpecRow());

function card(page: Page, body = BODY) {
  return page.getByRole("article").filter({ hasText: body });
}

async function showMyRequests(page: Page) {
  await page.getByRole("button", { name: "My requests", exact: true }).click();
}

test.describe("the author", () => {
  test.use({ persona: "oneGroup" });

  test("posts anonymously and still sees the request as theirs", async ({ page }) => {
    await page.goto(PRAYER_PAGE);
    await page.getByRole("textbox", { name: "Share a request" }).fill(BODY);
    await page.getByRole("switch", { name: /Share anonymously/ }).click();
    await page.getByRole("button", { name: "Post request" }).click();
    await expect(card(page)).toHaveCount(1);

    await page.reload();
    await expect(card(page).getByText("Anonymous", { exact: true })).toBeVisible();
    await expect(card(page).getByText("You", { exact: true })).toBeVisible();

    await showMyRequests(page);
    await expect(card(page)).toHaveCount(1);
  });
});

const READERS: { persona: PersonaKey; who: string }[] = [
  { persona: "twoGroups", who: "a member" },
  { persona: "leadsB", who: "the group's leader" },
  { persona: "admin", who: "a church admin in the group" },
];

for (const { persona, who } of READERS) {
  test.describe(who, () => {
    test.use({ persona });

    test("sees an anonymous request with no author", async ({ page }) => {
      await page.goto(PRAYER_PAGE);
      await expect(card(page).getByText("Anonymous", { exact: true })).toBeVisible();
      await expect(card(page).getByText("You", { exact: true })).toHaveCount(0);
      await expect(card(page).getByText(AUTHOR)).toHaveCount(0);
      await expect(card(page).getByRole("button", { name: "Mark answered" })).toHaveCount(0);

      await showMyRequests(page);
      await expect(card(page)).toHaveCount(0);
    });

    test("still sees the name on a request shared by name", async ({ page }) => {
      await page.goto(PRAYER_PAGE);
      await expect(card(page, BY_NAME_BODY).getByText(BY_NAME_AUTHOR)).toBeVisible();
    });
  });
}

test.describe("a member on the group's dashboard", () => {
  test.use({ persona: "twoGroups" });

  test("sees the anonymous request labelled Anonymous", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/dashboard`);
    const row = page.getByRole("listitem").filter({ hasText: BODY });
    await expect(row.getByText("Anonymous", { exact: true })).toBeVisible();
    await expect(row.getByText(AUTHOR)).toHaveCount(0);
  });
});

test.describe("the author, afterwards", () => {
  test.use({ persona: "oneGroup" });

  test("marks their anonymous request answered", async ({ page }) => {
    await page.goto(PRAYER_PAGE);
    await card(page).getByRole("button", { name: "Mark answered" }).click();
    await expect(card(page).getByRole("button", { name: "Answered" })).toBeVisible();

    await page.reload();
    await expect(card(page).getByRole("button", { name: "Answered" })).toBeVisible();
    await expect(card(page).getByText("You", { exact: true })).toBeVisible();
  });
});
