// What the two landing capture scripts have in common.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Cornerstone, the group every screenshot shows. */
export const GROUP = "5a3e0000-0000-0000-0000-00000000c001";
export const HIDE = "nextjs-portal{display:none!important}";

export const PAGES = [
  { name: "serving", path: "serving" },
  {
    name: "calendar",
    path: "calendar",
    prepare: (page) => page.getByText("List", { exact: true }).first().click(),
  },
  { name: "directory", path: "directory" },
  { name: "prayer", path: "prayer" },
  { name: "lessons", path: "lectures" },
  { name: "announcements", path: "announcements" },
  { name: "giving", path: "give" },
];

export async function signIn(page, base) {
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(process.env.USER_EMAIL ?? "david.carter@example.test");
  await page.getByLabel("Password").fill("password123");
  await page.locator("form").getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => u.pathname !== "/login");
}

/**
 * The sample lessons point at recordings that do not exist, so their
 * thumbnails are answered here with the title cards in thumbnails/.
 */
export async function serveThumbnails(context) {
  await context.route(/img\.youtube\.com\/vi\/two42acts0(\d)\//, async (route) => {
    const part = route.request().url().match(/two42acts0(\d)/)[1];
    const file = fileURLToPath(new URL(`./thumbnails/acts-${part}.jpg`, import.meta.url));
    await route.fulfill({ contentType: "image/jpeg", body: await readFile(file) });
  });
}
