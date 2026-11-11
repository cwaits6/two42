// What the two landing capture scripts have in common.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Cornerstone, the group every screenshot shows. */
export const GROUP = "5a3e0000-0000-0000-0000-00000000c001";
export const HIDE = "nextjs-portal{display:none!important}";

export const PAGES = [
  { name: "serving", path: "serving", tiles: "main ul.space-y-4 > li" },
  {
    name: "calendar",
    path: "calendar",
    prepare: (page) => page.getByText("List", { exact: true }).first().click(),
  },
  { name: "directory", path: "directory" },
  {
    name: "prayer",
    path: "prayer",
    // On a phone the form comes first; the screenshot is of the requests.
    preparePhone: (page) =>
      page
        .locator("article p")
        .first()
        .evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 186)),
  },
  // Tall enough at desktop width to take in the series list under the latest lesson.
  { name: "lessons", path: "lectures", maxHeight: 1000 },
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

const SIZES = fileURLToPath(new URL("../../components/landing/shots.json", import.meta.url));

/**
 * Where to end a screenshot so it never cuts through a tile: just under the
 * last card, row or panel that fits whole within `maxHeight` of the viewport,
 * and above the one after it.
 * `tiles` names them when a page's cards carry no border of their own.
 */
export async function wholeTilesHeight(page, { tiles, maxHeight }) {
  const bottom = await page.evaluate(
    ({ tiles, maxHeight }) => {
      const main = document.querySelector("main");
      const bordered = [...main.querySelectorAll("*")].filter((el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return (
          parseFloat(style.borderTopWidth) >= 1 &&
          parseFloat(style.borderRadius) >= 10 &&
          box.width > main.clientWidth * 0.45 &&
          box.height > 40
        );
      });
      const candidates = tiles
        ? [...document.querySelectorAll(tiles)]
        : bordered.filter((el) => !bordered.some((other) => other !== el && other.contains(el)));
      const boxes = candidates.map((el) => el.getBoundingClientRect()).filter((box) => box.top >= 0);
      const whole = boxes.filter((box) => box.bottom <= maxHeight).map((box) => box.bottom);
      if (!whole.length) return null;
      const last = Math.max(...whole);
      // Stop short of the next tile so none of its edge shows.
      const next = Math.min(...boxes.filter((box) => box.top > last).map((box) => box.top), Infinity);
      return Math.min(last + 24, next - 4);
    },
    { tiles, maxHeight },
  );
  if (bottom === null) throw new Error(`no whole tile fits in ${maxHeight}px on ${page.url()}`);
  return Math.round(bottom);
}

/** Records a capture's pixel size, which the landing page reads to lay the image out. */
export async function recordSize(name, kind, width, height) {
  const sizes = JSON.parse(await readFile(SIZES, "utf8").catch(() => "{}"));
  sizes[name] = { ...sizes[name], [kind]: { width, height } };
  const sorted = Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(SIZES, JSON.stringify(sorted, null, 2) + "\n");
}
