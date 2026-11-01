import { Resend } from "resend";
import {
  formatFromHeader,
  resolveRequestEmailBranding,
  type EmailBranding,
} from "@/lib/email/identity";
import {
  emailLayout,
  escapeHtml,
  factLines,
  heading,
  panel,
  paragraph,
  primaryAction,
  smallPrint,
  strong,
} from "@/supabase/functions/_shared/email-html";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendInviteEmail(
  email: string,
  name: string,
  magicLink: string,
  branding?: EmailBranding
) {
  const b = branding ?? (await resolveRequestEmailBranding());
  const safeMagicLink = sanitizeLink(magicLink);
  const { error } = await getResend().emails.send({
    from: formatFromHeader(b.orgName, b.fromAddress),
    to: email,
    ...(b.replyTo ? { replyTo: b.replyTo } : {}),
    subject: `You're invited to ${b.orgName}`,
    html: emailLayout(
      b.orgName,
      `${heading(`Welcome, ${name}`)}
${paragraph(`Your request to join ${strong(b.orgName)} was approved.`)}
${paragraph("Set up your account to get started.")}
${primaryAction(safeMagicLink, "Set up account", b.accent)}`,
    ),
  });

  if (error) {
    console.error("Failed to send invite email:", error);
    throw error;
  }
}

/**
 * The invitation a church admin sends, one person at a time or from the
 * importer. Unlike sendInviteEmail() there was no request to approve, so the
 * copy never says there was.
 */
export async function sendMemberInviteEmail(
  email: string,
  setupLink: string,
  branding: EmailBranding
) {
  const b = branding;
  const safeSetupLink = sanitizeLink(setupLink);

  const { error } = await getResend().emails.send({
    from: formatFromHeader(b.orgName, b.fromAddress),
    to: email,
    ...(b.replyTo ? { replyTo: b.replyTo } : {}),
    subject: `You're invited to join ${b.orgName}`,
    html: emailLayout(
      b.orgName,
      `${heading("You're invited")}
${paragraph(`${strong(b.orgName)} invited you to join its two42 space.`)}
${paragraph("Set up your account to get started.")}
${primaryAction(safeSetupLink, "Set up account", b.accent)}`,
    ),
  });

  if (error) {
    console.error("Failed to send member invite email:", error);
    throw error;
  }
}

/**
 * Free text destined for a Subject: header. Subject is an RFC 5322 header,
 * not markup — escapeHtml() there renders literally ("O&#39;Brien"), so the
 * only sanitization it needs (and must have) is the CR/LF strip that stops a
 * name from injecting a second header. Never use this for HTML bodies.
 */
function headerText(str: string): string {
  return str.replace(/[\r\n]/g, "");
}

function sanitizeLink(link: string): string {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsafe scheme");
    }
    return url.href;
  } catch {
    throw new Error(`Invalid or unsafe joinLink: ${link}`);
  }
}

export async function sendFamilyInviteEmail(
  email: string,
  inviterName: string,
  familyMemberName: string,
  joinLink: string,
  branding?: EmailBranding
) {
  const b = branding ?? (await resolveRequestEmailBranding());
  const safeJoinLink = sanitizeLink(joinLink);

  const { error } = await getResend().emails.send({
    from: formatFromHeader(b.orgName, b.fromAddress),
    to: email,
    ...(b.replyTo ? { replyTo: b.replyTo } : {}),
    subject: `${headerText(inviterName)} added you to their household at ${b.orgName}`,
    html: emailLayout(
      b.orgName,
      `${heading("You're invited")}
${paragraph(`${strong(inviterName)} added ${strong(familyMemberName)} to their household at ${strong(b.orgName)} and invited you to create your own account.`)}
${paragraph("Create your account to join your household.")}
${primaryAction(safeJoinLink, "Create account", b.accent)}`,
    ),
  });

  if (error) {
    console.error("Failed to send family invite email:", error);
    throw error;
  }
}

/**
 * The setup link for a person who followed a group invite link. Branding is
 * required: the caller holds the invite's org id, and a request-scoped
 * fallback would resolve nothing for the anonymous visitor who triggered
 * this send.
 */
export async function sendGroupInviteEmail(
  email: string,
  name: string,
  groupName: string,
  setupLink: string,
  branding: EmailBranding
) {
  const b = branding;
  const safeSetupLink = sanitizeLink(setupLink);

  const { error } = await getResend().emails.send({
    from: formatFromHeader(b.orgName, b.fromAddress),
    to: email,
    ...(b.replyTo ? { replyTo: b.replyTo } : {}),
    subject: `You're invited to ${headerText(groupName)} at ${b.orgName}`,
    html: emailLayout(
      b.orgName,
      `${heading(`Welcome, ${name}`)}
${paragraph(`You&#39;re invited to join ${strong(groupName)} at ${strong(b.orgName)}.`)}
${paragraph("Set up your account, and you&#39;ll go straight to the group.")}
${primaryAction(safeSetupLink, "Set up account", b.accent)}`,
    ),
  });

  if (error) {
    console.error("Failed to send group invite email:", error);
    throw error;
  }
}

export async function sendFeedbackEmail(
  to: string[],
  senderName: string,
  senderEmail: string | null,
  type: "idea" | "problem",
  message: string,
  branding?: EmailBranding
) {
  const b = branding ?? (await resolveRequestEmailBranding());
  const kind = type === "problem" ? "Something's broken" : "An idea";
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br />");
  // The member's own address must win over the org reply_to — admins answer
  // the sender directly by replying to this email.
  const replyTo = senderEmail ?? b.replyTo;

  const { error } = await getResend().emails.send({
    from: formatFromHeader(b.orgName, b.fromAddress),
    to,
    ...(replyTo ? { replyTo } : {}),
    subject: `${b.orgName} feedback from ${headerText(senderName)}: ${kind}`,
    html: emailLayout(
      b.orgName,
      `${heading("Member feedback")}
${paragraph(`${strong(senderName)}${senderEmail ? ` (${escapeHtml(senderEmail)})` : ""} sent feedback from the Settings page.`)}
${panel(`${factLines([["Type", kind]])}<br /><br />${safeMessage}`)}
${smallPrint(
  senderEmail
    ? "Reply to this email to answer them directly."
    : "They don&#39;t have an email address on file, so this email can&#39;t be replied to directly."
)}`,
    ),
  });

  if (error) {
    console.error("Failed to send feedback email:", error);
    throw error;
  }
}
