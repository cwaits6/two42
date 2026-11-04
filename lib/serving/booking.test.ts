import { describe, expect, it, vi } from "vitest";
import { bookDates, bookingMessage, type BookingOutcome } from "./booking";
import { formatMonthDay } from "./dates";

const short = (d: string) => formatMonthDay(d, "2026-11-04");

describe("bookDates", () => {
  it("books the chosen date and then each following week", async () => {
    const book = vi.fn(async (date: string) => ({ signupId: `s-${date}`, created: true }));
    const outcome = await bookDates(["2026-11-15", "2026-11-22"], book);
    expect(outcome).toEqual({
      booked: [
        { date: "2026-11-15", signupId: "s-2026-11-15", created: true },
        { date: "2026-11-22", signupId: "s-2026-11-22", created: true },
      ],
      stopped: null,
    });
    expect(book.mock.calls.map(([d]) => d)).toEqual(["2026-11-15", "2026-11-22"]);
  });

  it("keeps the first date and says a later one was taken", async () => {
    const book = vi.fn(async (date: string) =>
      date === "2026-11-22" ? { code: "SV001" } : { signupId: `s-${date}`, created: true },
    );
    const outcome = await bookDates(["2026-11-15", "2026-11-22", "2026-11-29"], book);
    expect(outcome).toEqual({
      booked: [{ date: "2026-11-15", signupId: "s-2026-11-15", created: true }],
      stopped: { date: "2026-11-22", reason: "taken" },
    });
    expect(book).toHaveBeenCalledTimes(2);
  });

  it("returns the chosen date's own error untouched", async () => {
    const outcome = await bookDates(["2026-11-15", "2026-11-22"], async () => ({ code: "SV004" }));
    expect(outcome).toEqual({ code: "SV004" });
  });
});

describe("bookingMessage", () => {
  const booked = (...dates: string[]) => dates.map((date) => ({ date, signupId: date, created: true }));

  it("names every date booked", () => {
    expect(bookingMessage({ booked: booked("2026-11-15"), stopped: null }, short)).toBe("You're signed up for Nov 15.");
    expect(bookingMessage({ booked: booked("2026-11-15", "2026-11-22"), stopped: null }, short)).toBe(
      "You're signed up for Nov 15 and Nov 22.",
    );
    expect(bookingMessage({ booked: booked("2026-11-15", "2026-11-22", "2026-11-29"), stopped: null }, short)).toBe(
      "You're signed up for Nov 15, Nov 22 and Nov 29.",
    );
  });

  it("says which date was just taken, or could not be booked", () => {
    const taken: BookingOutcome = { booked: booked("2026-11-15"), stopped: { date: "2026-11-22", reason: "taken" } };
    expect(bookingMessage(taken, short)).toBe("You're signed up for Nov 15. Nov 22 was just taken.");
    const failed: BookingOutcome = { booked: booked("2026-11-15"), stopped: { date: "2026-11-22", reason: "failed" } };
    expect(bookingMessage(failed, short)).toBe("You're signed up for Nov 15. Nov 22 couldn't be booked.");
  });
});
