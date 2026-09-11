// Per-org attachment entitlement — the future billing gate.
//
// Verification is free; *attachment* is the paid event once Stripe lands.
// Today every org is entitled, so this returns true unconditionally. When the
// gate becomes real it must keep the contract the attach loop relies on: a
// `false` here means the worker never claims a lease, never calls Vercel, and
// never stamps attached_at for that org — a refused org is silently skipped,
// not failed, so the run summary stays clean and the row stays `verified`
// (ownership proven) until the entitlement appears.

export function isAttachmentEntitled(org: { id: string }): boolean {
  // The org is part of the signature now so the call site does not change
  // when the gate starts consulting it; nothing reads it yet.
  void org;
  return true;
}
