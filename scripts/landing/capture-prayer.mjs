// Captures the landing page's prayer screenshot of the First Redeemer demo
// org (supabase/demo/first-redeemer.sql, applied through the shared local
// container) into public/landing/prayer.png.
//
//   npm run dev -- -p 3486
//   node scripts/landing/capture-prayer.mjs
//
// BASE (default http://localhost:3486), OUT (default public/landing) and
// USER_EMAIL (default karen.thompson@example.test) are the knobs.
import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:3486";
const out = process.env.OUT ?? "public/landing";
const email = process.env.USER_EMAIL ?? "karen.thompson@example.test";
const YF = "de3c0000-0000-0000-0000-00000000c001";
const HIDE = "nextjs-portal{display:none!important}";
const CONTENT = { x: 240, y: 70, width: 940, height: 700 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password").fill("password123");
await page.locator("form").getByRole("button", { name: "Sign In" }).click();
await page.waitForURL((u) => u.pathname !== "/login");

await page.goto(`${base}/g/${YF}/prayer`, { waitUntil: "networkidle" });
// Prayer categories are being removed from the product; the shot shows the
// page as it will look without them. Delete this block, and re-shoot, once
// the category chips and filter are gone from the Prayer page.
const removed = await page.evaluate(() => {
  const labels = new Set(["Health", "Family", "Thanksgiving", "Prodigal", "Guidance", "Grief"]);
  let n = 0;
  for (const el of Array.from(document.querySelectorAll("span"))) {
    if (labels.has(el.textContent.trim()) && el.getAttribute("style")) { el.remove(); n++; }
  }
  const filter = document.querySelector('[aria-label="Filter by prayer type"]');
  if (filter) { filter.remove(); n++; }
  for (const el of Array.from(document.querySelectorAll("div"))) {
    if (el.textContent.trim() === "Category" && el.className.includes("uppercase")) {
      el.nextElementSibling?.remove(); el.remove(); n++;
    }
  }
  return n;
});
console.log("removed", removed);
await page.addStyleTag({ content: HIDE });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/prayer.png`, clip: CONTENT });
console.log("saved prayer", page.url());
await browser.close();
