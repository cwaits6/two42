// Locks the escaping contract every email relies on, and the copy of the
// reminder emails, which only the edge functions send. Layout parity with the
// app's emails is pinned on the other side, in lib/email/layout.test.ts.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  emailLayout,
  escapeHtml,
  eventReminderEmail,
  openDatesEmail,
  servingReminderEmail,
} from "../_shared/email-html.ts";

const BASE = { orgName: "Grace <b>Fellowship</b>", accent: "#B85C38", name: "Ava <i>S</i>" };

const reminders = [
  servingReminderEmail({
    ...BASE,
    teamName: "Welcome & <u>Team</u>",
    dateLabel: "Monday, November 9, 2026",
    cancelUrl: "https://two42.example/serving/go?token=a&x=1",
  }),
  openDatesEmail({
    ...BASE,
    teamName: "Welcome & <u>Team</u>",
    dates: [{ dateLabel: "Monday, November 9, 2026", url: "https://two42.example/go?t=a&x=1" }],
    scheduleUrl: "https://two42.example/g/g1/serving/t1",
  }),
  eventReminderEmail({
    ...BASE,
    title: "Fall <u>potluck</u>",
    dateLabel: "Monday, November 9 at 7:00 PM",
    location: "Hall <u>B</u>",
    eventUrl: "https://two42.example/g/g1/calendar/e1",
  }),
];

Deno.test("escapeHtml neutralizes markup-significant characters", () => {
  assertEquals(
    escapeHtml(`<a href="https://evil.example">Click & 'win'</a>`),
    "&lt;a href=&quot;https://evil.example&quot;&gt;Click &amp; &#39;win&#39;&lt;/a&gt;",
  );
});

Deno.test("escapeHtml escapes & first so entities are not double-mangled", () => {
  assertEquals(escapeHtml("&lt;"), "&amp;lt;");
});

Deno.test("escapeHtml passes plain text through unchanged", () => {
  assertEquals(escapeHtml("Fall Potluck 2026"), "Fall Potluck 2026");
});

Deno.test("reminder emails escape every supplied value", () => {
  for (const { html } of reminders) {
    assert(!/<(b|i|u)>/.test(html), html);
    assertStringIncludes(html, "Grace &lt;b&gt;Fellowship&lt;/b&gt;");
    assertStringIncludes(html, "Ava &lt;i&gt;S&lt;/i&gt;");
  }
});

Deno.test("reminder copy carries the real date and none of the retired wording", () => {
  for (const { subject, html } of reminders) {
    const copy = `${subject} ${html}`;
    assert(!/sunday|volunteer|click here|!|—/i.test(copy), copy);
    assertStringIncludes(html, "Monday, November 9");
  }
});

Deno.test("the serving reminder drops the article before the team name", () => {
  const { subject } = servingReminderEmail({
    ...BASE,
    teamName: "Hospitality",
    dateLabel: "Monday, November 9, 2026",
    cancelUrl: "https://two42.example/go",
  });
  assertEquals(subject, "Reminder: you're serving with Hospitality on Monday, November 9, 2026");
});

Deno.test("the event reminder leaves out the place when the event has none", () => {
  const { html } = eventReminderEmail({
    ...BASE,
    title: "Fall potluck",
    dateLabel: "Monday, November 9 at 7:00 PM",
    location: null,
    eventUrl: "https://two42.example/g/g1/calendar/e1",
  });
  assert(!html.includes("Where:"));
});

Deno.test("the layout signs off with the church's name alone", () => {
  const html = emailLayout("Grace Fellowship", "");
  assertStringIncludes(html, ">Grace Fellowship</p>");
  assert(!html.includes("Team"));
});
