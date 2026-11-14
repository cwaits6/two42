import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { decryptBody } from "../lib/prayer/crypto";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS, type PersonaKey } from "./fixtures/personas";
import { prayerKeys } from "./fixtures/prayerKeys";

// The card masks on is_anonymous by itself, so this guards the rendered result;
// prayer_anonymity_suite.sql is what proves the column stays out of reach.
// The request is stored sealed with no author, so the server's own key match
// is what still shows it to its author as theirs. Both hooks remove this spec's
// row through the stack's own Postgres container, in case a test stops before
// the author deletes it. Tests run in order: the author posts, the readers
// look, and the author marks it answered and deletes it last.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const BODY = "Anonymity boundary check: please pray for a quiet week.";
const BY_NAME_BODY = "Ruth has a follow-up";
const BY_NAME_AUTHOR = PERSONAS.leadsB.name;
const AUTHOR = PERSONAS.oneGroup.name;
const PRAYER_PAGE = `/g/${GROUP_B}/prayer`;

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-At", "-F", "\t", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

type StoredRow = { id: string; body: string; sealed: string; authorId: string; authorHash: string };

/** This spec's rows as stored, found by opening each Group B request's text. */
function specRows(): StoredRow[] {
  const keys = prayerKeys();
  const out = sql(`select id, org_id, coalesce(body, ''), coalesce(body_ciphertext, ''),
                          coalesce(author_id::text, ''), coalesce(author_hash, '')
                   from public.prayer_requests where group_id = '${GROUP_B}';`);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([id, org, body, sealed]) => (sealed ? decryptBody(keys, org, id, sealed) : body) === BODY)
    .map(([id, , body, sealed, authorId, authorHash]) => ({ id, body, sealed, authorId, authorHash }));
}

function deleteSpecRow() {
  const ids = specRows().map((r) => `'${r.id}'`);
  if (ids.length > 0) sql(`delete from public.prayer_requests where id in (${ids.join(", ")});`);
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

    const [stored] = specRows();
    expect(stored).toMatchObject({ body: "", authorId: "" });
    expect(stored.authorHash).not.toBe("");
    expect(stored.sealed).not.toContain("quiet week");

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
      await expect(card(page).getByRole("button", { name: "Delete" })).toHaveCount(0);

      await showMyRequests(page);
      await expect(card(page)).toHaveCount(0);
    });

    test("still sees the name on a request shared by name", async ({ page }) => {
      await page.goto(PRAYER_PAGE);
      await expect(card(page, BY_NAME_BODY).getByText(BY_NAME_AUTHOR)).toBeVisible();
    });

    test("sees Delete on a by-name request only as its author", async ({ page }) => {
      await page.goto(PRAYER_PAGE);
      await expect(card(page, BY_NAME_BODY).getByRole("button", { name: "Delete" })).toHaveCount(
        persona === "leadsB" ? 1 : 0,
      );
    });
  });
}

test.describe("the author on the group's dashboard", () => {
  test.use({ persona: "oneGroup" });

  test("is not asked to pray for their own anonymous request", async ({ page }) => {
    await page.goto(`/g/${GROUP_B}/dashboard`);
    await expect(page.getByRole("heading", { name: "Prayer" }).first()).toBeVisible();
    await expect(page.getByText(BODY)).toHaveCount(0);
  });
});

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

  test("deletes their anonymous request after a confirmation", async ({ page }) => {
    await page.goto(PRAYER_PAGE);
    await card(page).getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(card(page)).toHaveCount(1);

    await card(page).getByRole("button", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Delete request" }).click();
    await expect(card(page)).toHaveCount(0);

    await page.reload();
    await expect(card(page)).toHaveCount(0);
  });
});
