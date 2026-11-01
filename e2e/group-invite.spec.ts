import type { BrowserContext, Page } from "@playwright/test";
import { expect, openAs, test } from "./fixtures/auth";
import { GROUP_B } from "./fixtures/personas";

// An invite link is a row on the shared local stack, so the spec tracks the
// one it creates and revokes it in afterAll whatever happened between.
test.describe.configure({ mode: "serial" });


let admin: { context: BrowserContext; page: Page };
let groupAId: string;
let inviteUrl: string | null = null;
let revoked = false;

function linkCard(page: Page, url: string) {
  return page.getByRole("listitem").filter({ hasText: url });
}

async function revokeCreatedLink() {
  if (!inviteUrl || revoked) return;
  await admin.page.goto(`/g/${groupAId}/settings/invites`);
  // The list loads client-side; a count taken before it settles reads as
  // "already gone" and would leave the link live.
  await expect(admin.page.getByText("Loading...")).toHaveCount(0);
  const revokeButton = linkCard(admin.page, inviteUrl).getByRole("button", { name: "Revoke link" });
  if ((await revokeButton.count()) === 0) return;
  await revokeButton.click();
  await admin.page.getByRole("dialog").getByRole("button", { name: "Revoke link" }).click();
  await expect(admin.page.getByText("Link revoked.")).toBeVisible();
  revoked = true;
}

test.beforeAll(async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL is not configured");
  admin = await openAs(browser, baseURL, "admin");
  // Group A is the migration-created group with no fixed id: reach it
  // through the switcher and read the id off the URL.
  await admin.page.goto(`/g/${GROUP_B}/dashboard`);
  await admin.page.getByRole("button", { name: "Switch group. Current group: Group B" }).click();
  await admin.page.getByRole("menuitem").filter({ hasText: "Group A" }).click();
  await admin.page.waitForURL(
    (url) => /^\/g\/[0-9a-f-]{36}\//.test(url.pathname) && !url.pathname.includes(GROUP_B),
  );
  groupAId = new URL(admin.page.url()).pathname.split("/")[2];
});

test.afterAll(async () => {
  try {
    if (admin) await revokeCreatedLink();
  } finally {
    await admin?.context.close();
  }
});

test("a leader creates a link, a stranger can use it until it is revoked, and a non-member cannot reach the page", async ({
  browser,
}) => {
  const baseURL = test.info().project.use.baseURL!;

  await admin.page.goto(`/g/${groupAId}/settings/invites`);
  await admin.page.getByRole("button", { name: "Create link" }).click();
  await admin.page.getByRole("dialog").getByRole("button", { name: "Create link" }).click();
  await expect(admin.page.getByText("Link created.")).toBeVisible();
  const firstLink = admin.page.locator("section", { hasText: "Active links" }).getByRole("listitem").first();
  inviteUrl = (await firstLink.locator("p.font-mono").innerText()).trim();
  expect(inviteUrl).toMatch(/\/join\/[0-9a-f-]{36}$/);
  const invitePath = new URL(inviteUrl).pathname;

  // Anonymous: the group is named and the signup form is offered.
  const anonymous = await browser.newContext({ baseURL });
  try {
    const page = await anonymous.newPage();
    await page.goto(invitePath);
    await expect(page.getByRole("heading", { name: /Group A/ })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
  } finally {
    await anonymous.close();
  }

  await revokeCreatedLink();

  // Anonymous again: the one dead-link message, and no form.
  const after = await browser.newContext({ baseURL });
  try {
    const page = await after.newPage();
    await page.goto(invitePath);
    await expect(page.getByRole("heading", { name: "This link isn't valid anymore" })).toBeVisible();
    await expect(page.getByText("Ask a leader of the group for a new one.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
  } finally {
    await after.close();
  }

  // A member of Group B only never sees Group A's invite page.
  const outsider = await openAs(browser, baseURL, "oneGroup");
  try {
    expect((await outsider.page.goto(`/g/${groupAId}/settings/invites`))?.status()).toBe(404);
  } finally {
    await outsider.context.close();
  }
});
