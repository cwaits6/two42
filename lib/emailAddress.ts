/**
 * The shape of an email address this app accepts. Client-safe on purpose:
 * lib/branding.ts (which re-exports this module's API) imports
 * @/lib/supabase/server and so can never reach a "use client" component.
 * Keep this module free of server imports.
 */

// reply_to becomes an RFC 5322 Reply-To header via the Resend API, which
// rejects malformed addresses — and sendInviteEmail throws on rejection, so
// one bad character in the branding column would 500 every invite send.
// Deliberately conservative: over-rejecting yields no Reply-To header, which
// is the pre-branding behavior and strictly better than a failed send.
export const EMAIL = /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/;

// The longest address RFC 5321 lets a mail server accept.
export const EMAIL_MAX_LENGTH = 254;
