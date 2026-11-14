import { GITHUB_URL } from "@/components/landing/sections";
import { DOWNLOAD_COVERS, DOWNLOAD_LEAVES_OUT } from "@/lib/account/deletionCopy";
import {
  EXPIRED_RETENTION_DAYS,
  FEEDBACK_RETENTION_MONTHS,
  PRAYER_RETENTION_MONTHS,
  REMINDER_RETENTION_DAYS,
  USAGE_RETENTION_MONTHS,
} from "@/supabase/functions/_shared/retention";
import type { LegalDocument } from "./document";

// Every sentence here must be true of the code on main. Before editing, read
// docs/legal/README.md: it lists what to re-check and the sentences that must
// change when prayer storage changes.

function listOr(values: readonly number[]): string {
  return values.length < 2 ? values.join("") : `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

export const PRIVACY_EMAIL = "privacy@two42.io";

/** Every outside service that receives data from the hosted service. */
export const PROCESSORS: readonly { name: string; does: string }[] = [
  {
    name: "Supabase",
    does: "Stores the database, photos and sign-in, runs the nightly jobs, and sends password reset emails.",
  },
  {
    name: "Vercel",
    does:
      "Hosts the app. Vercel Web Analytics counts page views by page pattern only, such as /g/[groupId]/calendar or /join/[token], plus the site that linked to two42 when the browser reports one. It never receives the real page address, a query string, an invite token, or the id of a group, member or event.",
  },
  {
    name: "Resend",
    does:
      "Sends two42's email: invitations and sign-up links, approvals, event and serving reminders, messages a team lead sends to a team, and feedback copies to church admins. Resend receives each recipient's address and the email's content.",
  },
  {
    name: "Google Maps",
    does:
      "Shows the map on an event with a location and suggests addresses while a leader types one. The map loads in your browser, so Google receives the location shown and your browser's request.",
  },
  {
    name: "YouTube",
    does:
      "Supplies the thumbnail for a lesson with a YouTube recording. The image loads from YouTube in your browser, so YouTube receives your browser's request.",
  },
];

export const PRIVACY: LegalDocument = {
  title: "Privacy policy",
  summary: "How two42 handles the information a church and its members put into it.",
  lastUpdated: "2026-11-13",
  sections: [
    {
      heading: "Who runs two42",
      blocks: [
        "two42 is run by Cody Waits as a solo developer. This policy covers the hosted service at two42.io: the website, the app and the emails it sends.",
        `two42 is [open source](${GITHUB_URL}). A church that runs its own copy of the software is responsible for that copy and its own policies; this policy does not cover it.`,
        "two42 is offered in the United States and is not directed at people outside it.",
        `Questions about this policy, and requests for a copy or removal of your data, go to [${PRIVACY_EMAIL}](mailto:${PRIVACY_EMAIL}).`,
      ],
    },
    {
      heading: "Who decides what is shared",
      blocks: [
        "Each church decides who joins its two42 space and what is shared there, and confirms it has permission to add the people it adds. A church admin answers its members' requests about their data first.",
        "Cody Waits runs and secures the service, and answers for sign-in, security and analytics data. two42 does not sell data and shows no ads.",
      ],
    },
    {
      heading: "What two42 stores",
      blocks: [
        "two42 stores what a church and its members enter so the app can show it back to them:",
        [
          "Your sign-in: your email address and password. The password is stored only as a secure hash by Supabase.",
          "Your profile: name, preferred name, photo, birthday, anniversary, phone numbers, address, occupation and anything else you add. Leave out anything you don't want stored.",
          "Your household: the people listed in it, including children without their own account. A parent chooses what to enter about a child; a child they leave out is not stored at all.",
          "Your groups and teams, your role in each, your RSVPs and your serving turns.",
          "Prayer requests you post, by name or anonymous, and the requests you say you are praying for.",
          "What leaders add for a group: events, announcements, lessons, the group's about page, and funds with their payment handles, such as a Venmo or PayPal name. two42 does not process payments; a gift happens in the payment app.",
          "Requests to join the church or a group, invitations, and feedback you send.",
          "A private calendar link, if you make one. Anyone with that link can see your calendar, so keep it to yourself.",
        ],
        "Your browser keeps a sign-in cookie, a cookie for the last group you opened, and your display choices. two42 sets no advertising or tracking cookies.",
        "Each church keeps usage counts for its church admins: how often each kind of page was opened, and how often one showed an error, per day. They record the page pattern only, never who opened it.",
        "Error logs record what failed, the page pattern and the ids of the rows involved. They never record what you entered.",
      ],
    },
    {
      heading: "Who can see it",
      blocks: [
        "Each church's data is kept apart from every other church's: every read and write in the database is checked against the church of the person asking.",
        [
          "The directory shows what each person entered, except a birth year, which only goes into a phone contact someone saves from the directory. A church admin chooses whether members see everyone in the church or only people they share a group with.",
          "You can leave yourself out of the directory, and hide your email address from everyone but yourself and church admins.",
          "Group content — events, announcements, lessons, prayer requests, funds and the roster — is seen by that group's members. A church admin sees every person and group in the church, but not a group's content unless they are in that group.",
          "A leader can make a group private, so members who aren't in it can't find it.",
          "A prayer request posted by name shows the author to group members who can see that person in the directory. An anonymous request shows no author in the app to anyone but the author: not to other members, leaders or church admins. A leader can edit or delete any prayer request in their group.",
          "Email reminders and team messages go only to the people they are for.",
        ],
      ],
    },
    {
      heading: "What Cody Waits can see",
      blocks: [
        "As the person who runs the service, Cody Waits has administrator access to the database and can read everything stored in it, including prayer requests and who wrote an anonymous one. That access is used only to keep the service running, fix a problem, answer a request you make, or comply with the law.",
        "two42 discloses data to authorities only when the law requires it.",
      ],
    },
    {
      heading: "Services that handle your data",
      blocks: [
        PROCESSORS.map((p) => `${p.name}: ${p.does}`),
        "Like any web host, these services see your IP address and browser details with each request, and keep their own logs for periods they set.",
        "Some links take you to other services by your choice: adding an event to your own calendar, opening a map or a meeting link, or giving through a payment app. What happens there is covered by that service's policy.",
      ],
    },
    {
      heading: "How long it is kept",
      blocks: [
        "What you and your church enter is kept while your account and your church use two42. A nightly job deletes:",
        [
          `Prayer requests older than ${listOr(PRAYER_RETENTION_MONTHS)} months, if a church admin turns that on for the church. It is off unless they do.`,
          `Feedback older than ${FEEDBACK_RETENTION_MONTHS} months.`,
          `Declined requests to join the church, ${EXPIRED_RETENTION_DAYS} days after they were declined.`,
          `Sign-up links never used, household invitations never accepted, and group invite links revoked or expired, ${EXPIRED_RETENTION_DAYS} days later.`,
          `Records of which reminders were sent, after ${REMINDER_RETENTION_DAYS} days.`,
          `Usage counts older than ${USAGE_RETENTION_MONTHS} months.`,
        ],
        "Backups kept by the database host may hold deleted data until they expire.",
      ],
    },
    {
      heading: "Your copy and your account",
      blocks: [
        `In Settings, under Your data, you can download a copy of your data. ${DOWNLOAD_COVERS} ${DOWNLOAD_LEAVES_OUT}`,
        "You can delete your own prayer requests, and change or remove anything in your profile, at any time.",
        "You can delete your account from the same place, and a church admin can delete an account in their church. Deleting an account removes the profile, photo, sign-in, group and team memberships, RSVPs, serving turns, and prayer requests, including anonymous ones. Announcements, events and lessons the person added stay without their name, and feedback stays without a name. A church needs at least one church admin, so the last one adds another before deleting their own account.",
        `For anything you can't do yourself, ask your church admin, or write to [${PRIVACY_EMAIL}](mailto:${PRIVACY_EMAIL}). A church admin can write there to ask for the church's data to be removed.`,
      ],
    },
    {
      heading: "Changes to this policy",
      blocks: [
        `When this policy changes, the date at the top changes too. Every change is public in [the two42 source](${GITHUB_URL}/commits/main/components/legal/privacy.ts).`,
        "The rules for using two42 are in the [Terms of service](/terms).",
      ],
    },
  ],
};
