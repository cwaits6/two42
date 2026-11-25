// What a dinner club route answers about the emails it sent after a change
// was saved, and what the page tells the leader or host. The change is saved
// either way, so a route answers 200 and this says whether everyone heard.

export interface NotifyResult {
  sent: number;
  failed: number;
  /** True when the church's daily email cap refused the batch: nothing was sent. */
  capped: boolean;
}

export interface EmailOutcome {
  sent: number;
  capped: boolean;
  /** True when someone who should have had an email did not. */
  unsent: boolean;
}

/** The outcome of a send, or of one that threw before it finished (null). */
export function emailOutcome(result: NotifyResult | null): EmailOutcome {
  if (!result) return { sent: 0, capped: false, unsent: true };
  return { sent: result.sent, capped: result.capped, unsent: result.capped || result.failed > 0 };
}

export interface Notice {
  kind: "success" | "warning";
  text: string;
}

function people(n: number): string {
  return `${n} ${n === 1 ? "person was" : "people were"}`;
}

function unsentCount(outcome: EmailOutcome): string {
  return outcome.sent === 0 ? "No emails went out." : "Some emails didn't go out.";
}

/** After a dinner or a season date moved. */
export function movedNotice(saved: string, outcome: EmailOutcome | null): Notice {
  if (!outcome || !outcome.unsent) return { kind: "success", text: saved };
  if (outcome.capped) {
    return { kind: "warning", text: `${saved} Today's email limit was reached, so no emails went out. Let the table know the new date.` };
  }
  return { kind: "warning", text: `${saved} ${unsentCount(outcome)} Let the table know the new date.` };
}

/** After tables were published. */
export function publishedNotice(outcome: EmailOutcome & { changed: number }): Notice {
  if (outcome.capped) {
    return { kind: "warning", text: "Tables published. Today's email limit was reached, so no emails went out." };
  }
  if (outcome.unsent) {
    return { kind: "warning", text: `Tables published. ${unsentCount(outcome)} Let the people at the tables know.` };
  }
  if (outcome.changed === 0) return { kind: "success", text: "Tables published. No one's table changed." };
  if (outcome.sent === 0) return { kind: "success", text: "Tables published." };
  return { kind: "success", text: `Tables published. ${people(outcome.sent)} emailed.` };
}
