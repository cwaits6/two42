import { assertEquals } from "jsr:@std/assert@1";
import {
  isOpenDatesRecipient,
  isServingReminderRecipient,
} from "../_shared/serving-recipients.ts";

const approved = { email: "a@example.com", role: "member", email_announcements: true };

Deno.test("serving reminder goes to an approved attendee with an email", () => {
  assertEquals(isServingReminderRecipient(approved), true);
});

Deno.test("serving reminder skips a pending attendee", () => {
  assertEquals(isServingReminderRecipient({ ...approved, role: "pending" }), false);
});

Deno.test("serving reminder skips a missing profile or email", () => {
  assertEquals(isServingReminderRecipient(null), false);
  assertEquals(isServingReminderRecipient({ ...approved, email: null }), false);
});

Deno.test("open-dates email goes to an approved team member", () => {
  assertEquals(isOpenDatesRecipient(approved), true);
});

Deno.test("open-dates email skips a pending team member", () => {
  assertEquals(isOpenDatesRecipient({ ...approved, role: "pending" }), false);
});

Deno.test("open-dates email skips a member who opted out of announcements", () => {
  assertEquals(isOpenDatesRecipient({ ...approved, email_announcements: false }), false);
});
