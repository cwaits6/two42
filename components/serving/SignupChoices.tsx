"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { formatMonthDay, formatServingDate, listDates } from "@/lib/serving/dates";

export interface SignupChoice {
  includeSpouse: boolean;
  extraDates: string[];
}

interface SignupChoicesProps {
  date: string;
  /** Today in the church's time zone, "YYYY-MM-DD" */
  today: string;
  /** The spouse's first name, or null when there is nobody to ask about */
  spouseName: string | null;
  /** The open dates directly after `date` the team asks about, in order */
  extraDates: string[];
  busy: boolean;
  onSubmit: (choice: SignupChoice) => void;
}

/** The heading over the choices: what is being asked, and nothing more. */
export function signupTitle(
  date: string,
  today: string,
  spouseName: string | null,
  extraDates: string[]
): string {
  if (spouseName && extraDates.length > 0) return formatServingDate(date, today);
  if (spouseName) return `Who's serving ${formatMonthDay(date, today)}?`;
  return alsoServe(extraDates, today);
}

function alsoServe(extraDates: string[], today: string): string {
  return `Also serve ${listDates(extraDates, (d) => formatServingDate(d, today))}?`;
}

function allWeeksLabel(extraDates: string[]): string {
  return extraDates.length === 1 ? "Yes, both weeks" : `Yes, all ${extraDates.length + 1} weeks`;
}

/**
 * The questions a sign-up can ask: who is serving, when the person has a
 * spouse on file, and whether to take the following weeks, when the team
 * asks for them. Both at once share one screen with one Sign up button; one
 * alone is two buttons. With neither, the caller signs up without asking.
 */
export function SignupChoices({ date, today, spouseName, extraDates, busy, onSubmit }: SignupChoicesProps) {
  const [who, setWho] = useState<"both" | "me">("both");
  const [more, setMore] = useState<"yes" | "no">("yes");

  if (spouseName && extraDates.length > 0) {
    return (
      <div className="flex flex-col gap-5">
        <div className="space-y-2">
          <p className="text-base font-semibold">Who&apos;s serving?</p>
          <Segmented
            label="Who's serving?"
            options={[
              { value: "both", label: `Me & ${spouseName}` },
              { value: "me", label: "Just me" },
            ]}
            value={who}
            onChange={setWho}
            className="w-full *:flex-1"
          />
        </div>
        <div className="space-y-2">
          <p className="text-base font-semibold">{alsoServe(extraDates, today)}</p>
          <Segmented
            label={alsoServe(extraDates, today)}
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            value={more}
            onChange={setMore}
            className="w-full *:flex-1"
          />
        </div>
        <Button
          size="lg"
          disabled={busy}
          onClick={() => onSubmit({ includeSpouse: who === "both", extraDates: more === "yes" ? extraDates : [] })}
        >
          Sign up
        </Button>
      </div>
    );
  }

  if (spouseName) {
    return (
      <div className="flex flex-col gap-3">
        <Button size="lg" disabled={busy} onClick={() => onSubmit({ includeSpouse: true, extraDates: [] })}>
          Me &amp; {spouseName}
        </Button>
        <Button size="lg" variant="outline" disabled={busy} onClick={() => onSubmit({ includeSpouse: false, extraDates: [] })}>
          Just me
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button size="lg" disabled={busy} onClick={() => onSubmit({ includeSpouse: false, extraDates })}>
        {allWeeksLabel(extraDates)}
      </Button>
      <Button size="lg" variant="outline" disabled={busy} onClick={() => onSubmit({ includeSpouse: false, extraDates: [] })}>
        Just {formatServingDate(date, today)}
      </Button>
    </div>
  );
}
