import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { decryptBody } from "../lib/prayer/crypto";
import { expect, test } from "./fixtures/auth";
import { GROUP_B, PERSONAS } from "./fixtures/personas";
import { prayerKeys } from "./fixtures/prayerKeys";

// Who sees each comment is decided on the server, which alone can recognise an
// anonymous asker and a hidden-name writer by hash; prayer_comments_suite.sql
// proves no client reaches the table. This guards what each viewer is shown.
// Isaac posts an anonymous request, so the asker is recognised only by hash.
// Both hooks delete this spec's request through the stack's own Postgres
// container, and its comments go with it. Tests run in order.
test.describe.configure({ mode: "serial" });

const DB_CONTAINER = "supabase_db_small-group-hub";
const BODY = "Comment boundary check: please pray for a calm move.";
const GROUP_TEXT = "Praying for a calm move, from all of us.";
const PRIVATE_TEXT = "Only for you: I went through a move like this.";
const HIDDEN_TEXT = "Praying quietly for you.";
const PRAYER_PAGE = `/g/${GROUP_B}/prayer`;

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-q", "-At", "-F", "\t", "-c", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

/** This spec's requests, found by opening each Group B request's text. */
function specRequestIds(): string[] {
  const keys = prayerKeys();
  return sql(`select id, org_id, coalesce(body, ''), coalesce(body_ciphertext, '')
              from public.prayer_requests where group_id = '${GROUP_B}';`)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([id, org, body, sealed]) => (sealed ? decryptBody(keys, org, id, sealed) : body) === BODY)
    .map(([id]) => id);
}

function deleteSpecRequests() {
  const ids = specRequestIds().map((id) => `'${id}'`);
  if (ids.length > 0) sql(`delete from public.prayer_requests where id in (${ids.join(", ")});`);
}

test.beforeAll(() => deleteSpecRequests());
test.afterAll(() => deleteSpecRequests());

const card = (page: Page) => page.getByRole("article").filter({ hasText: BODY });
const comment = (page: Page, text: string) => card(page).getByRole("listitem").filter({ hasText: text });

async function postComment(page: Page, text: string, choices: { onlyAsker?: boolean; hideName?: boolean } = {}) {
  await card(page).getByRole("button", { name: "Comment", exact: true }).click();
  await card(page).getByRole("textbox", { name: "Add a comment" }).fill(text);
  if (choices.onlyAsker) await card(page).getByRole("switch", { name: /Only the person who asked can see this/ }).click();
  if (choices.hideName) await card(page).getByRole("switch", { name: /Hide my name/ }).click();
  await card(page).getByRole("button", { name: "Post comment" }).click();
  await expect(comment(page, text)).toHaveCount(1);
}

test.describe("the person who asks", () => {
  test.use({ persona: "oneGroup" });

  test("posts an anonymous request", async ({ page }) => {
    await page.goto(PRAYER_PAGE);
    await page.getByRole("textbox", { name: "Share a request" }).fill(BODY);
    await page.getByRole("switch", { name: /Share anonymously/ }).click();
    await page.getByRole("button", { name: "Post request" }).click();
    await expect(card(page)).toHaveCount(1);
  });
});

test.describe("a member", () => {
  test.use({ persona: "twoGroups" });

  test("comments for the group and privately, and sees both with their name", async ({ page }) => {
    await page.goto(PRAYER_PAGE);
    await postComment(page, GROUP_TEXT);
    await postComment(page, PRIVATE_TEXT, { onlyAsker: true });

    await page.reload();
    await expect(comment(page, GROUP_TEXT).getByText(PERSONAS.twoGroups.name)).toBeVisible();
    await expect(comment(page, PRIVATE_TEXT).getByText("Private", { exact: true })).toBeVisible();
    await expect(comment(page, PRIVATE_TEXT).getByText("You", { exact: true })).toBeVisible();
  });
});

test.describe("a church admin in the group", () => {
  test.use({ persona: "admin" });

  test("comments with their name hidden, sees it as theirs, and does not see the private comment", async ({ page }) => {
    await page.goto(PRAYER_PAGE);
    await postComment(page, HIDDEN_TEXT, { hideName: true });

    await page.reload();
    await expect(comment(page, HIDDEN_TEXT).getByText("Anonymous", { exact: true })).toBeVisible();
    await expect(comment(page, HIDDEN_TEXT).getByText("You", { exact: true })).toBeVisible();
    await expect(comment(page, GROUP_TEXT)).toHaveCount(1);
    await expect(comment(page, PRIVATE_TEXT)).toHaveCount(0);
  });
});

test.describe("the person who asked", () => {
  test.use({ persona: "oneGroup" });

  test("sees the private comment, and no name on the hidden-name one", async ({ page }) => {
    await page.goto(PRAYER_PAGE);
    await expect(comment(page, GROUP_TEXT).getByText(PERSONAS.twoGroups.name)).toBeVisible();
    await expect(comment(page, PRIVATE_TEXT).getByText("Private", { exact: true })).toBeVisible();
    await expect(comment(page, HIDDEN_TEXT).getByText("Anonymous", { exact: true })).toBeVisible();
    await expect(card(page).getByText(PERSONAS.admin.name)).toHaveCount(0);
  });
});

test.describe("the group's leader", () => {
  test.use({ persona: "leadsB" });

  test("sees the group comment, not the private one, and no name on the hidden-name one", async ({ page }) => {
    await page.goto(PRAYER_PAGE);
    await expect(comment(page, GROUP_TEXT).getByText(PERSONAS.twoGroups.name)).toBeVisible();
    await expect(comment(page, PRIVATE_TEXT)).toHaveCount(0);
    await expect(comment(page, HIDDEN_TEXT).getByText("Anonymous", { exact: true })).toBeVisible();
    await expect(card(page).getByText(PERSONAS.admin.name)).toHaveCount(0);
  });

  test("deletes a member's comment", async ({ page }) => {
    await page.goto(PRAYER_PAGE);
    await comment(page, GROUP_TEXT).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete comment" }).click();
    await expect(comment(page, GROUP_TEXT)).toHaveCount(0);

    await page.reload();
    await expect(comment(page, GROUP_TEXT)).toHaveCount(0);
    await expect(comment(page, HIDDEN_TEXT)).toHaveCount(1);
  });
});
