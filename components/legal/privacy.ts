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
// docs/legal/README.md: it lists what to re-check when a feature changes.

function listOr(values: readonly number[]): string {
  return values.length < 2 ? values.join("") : `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

export const PRIVACY_EMAIL = "privacy@two42.io";

/** Every outside service that receives data from the hosted service. */
export const PROCESSORS: readonly { name: string; does: string }[] = [
  { name: "Supabase", does: "Stores the database and photos, handles sign-in, runs the nightly jobs, and sends password reset and email change emails." },
  {
    name: "Vercel",
    does: "Hosts the app, and keeps the keys that open prayer requests.",
  },
  {
    name: "Grafana",
    does: "Receives traces of the app's server work to find problems. They never hold what you entered or your IP address.",
  },
  { name: "Resend", does: "Sends two42's email, so it receives each recipient's address and the email's content." },
  { name: "Google Maps", does: "Shows event maps and suggests addresses. The map loads in your browser." },
  { name: "YouTube", does: "Shows the thumbnail for a lesson's video. It loads in your browser." },
];

export const PRIVACY: LegalDocument = {
  title: "Privacy policy",
  summary: "How two42 handles the information a church and its members put into it.",
  lastUpdated: "2026-11-27",
  sections: [
    {
      heading: "What this policy covers",
      blocks: [
        "This policy covers the hosted service at two42.io: the website, the app and the emails it sends.",
        `two42 is [open source](${GITHUB_URL}). A church that runs its own copy of the software is responsible for that copy and its own policies; this policy does not cover it.`,
        "two42 is offered in the United States and is not directed at people outside it.",
        `Questions about this policy, and requests for a copy or removal of your data, go to [${PRIVACY_EMAIL}](mailto:${PRIVACY_EMAIL}).`,
      ],
    },
    {
      heading: "Who decides what is shared",
      blocks: [
        "Each church decides who joins its two42 space and what is shared there, and confirms it has permission to add the people it adds. A church admin answers its members' requests about their data first.",
        "two42 runs the service and is responsible for keeping it secure. two42 does not sell data and shows no ads.",
      ],
    },
    {
      heading: "What two42 stores",
      blocks: [
        "two42 stores what a church and its members enter so the app can show it back to them:",
        [
          "Your sign-in: your email address and password (stored only as a secure hash by Supabase), and the IP address and browser of each signed-in session.",
          "Your profile: name, preferred name, photo, birthday, anniversary, phone numbers, address, occupation and anything else you add. Leave out anything you don't want stored. A church admin, or whoever manages your household, can also add or change these details.",
          "Your household: the people listed in it, including children without their own account. A parent or a church admin chooses what to enter about a child; a child no one adds is not stored in the household, only kept as a suggestion if your church turns on suggesting children, as described below.",
          "Your groups and teams, your role in each, any labels a leader gives you in a group, your RSVPs and your serving turns.",
          "If you sign up for a group's Supper club: who you signed up with, whether you can host and how many seats, the address for the suppers you host, pets, notes on getting in, whether kids are welcome, dates you can't host, your allergies and food needs, your table, what you're asked to bring, and your Going or Not going for each supper. You can turn off Supper club emails in Settings.",
          "Prayer requests you post, by name or anonymous, the requests you say you are praying for, and comments you add to a request. The text of a request or a comment is stored encrypted. An anonymous request, or a comment with your name hidden, stores no author, only a code the app uses to recognize it as yours.",
          "What leaders add for a group: events, announcements, lessons, the group's about page, and funds with their payment handles, such as a Venmo or PayPal name. two42 does not process payments; a gift happens in the payment app.",
          "Requests to join the church or a group, invitations, and feedback you send.",
          "If your church connects the software it keeps its records in, such as Rock RMS: which person in your church's records is you, once a church admin confirms it, and the key the church uses to reach its records, stored encrypted. To suggest a match, two42 reads names, email addresses and birthdays from your church's records and keeps none of them. two42 writes to your church's records only as described next.",
          "If your church turns on sending new people to its records, and you tick Share my details with your church's office when you set up your account or your profile, two42 sends your first and last name, sign-in email and phone (your mobile, or your home phone if you have no mobile) to your church's records once, for the church office to review. It sends nothing else and nothing about your household, and it sends nothing if you leave the box unticked or you are already linked to your church's records. two42 keeps whether and when it sent them, and never changes anything already in your church's records. What happens next is up to your church.",
          "If your church admin chooses to copy details from those records, two42 copies the ones they pick into your profile: your name, preferred name, title, suffix, gender, mobile and work phone, birthday, your household's anniversary, your photo, and a child's grade. It copies them once you are linked, again every night for people whose records changed, and whenever a church admin asks it to. It keeps which details came from your church's records and your church's last value for each, so you can go back to it. It never copies an email address, a phone number marked unlisted, whether you can receive texts, your connection status or your church's own fields, and it never changes your sign-in email. A detail you change or clear is yours from then on, apart from your name, title, suffix, gender or a child's grade when your church locks them. When you are unlinked, or your church disconnects, what was copied stays in your profile and you can change it.",
          "If your church connects its records, two42 also reads how they group people into families: who is in each family, whether each is an adult or a child, whether a couple is married, the family's home address and its adults' listed home phones. From that it suggests households for a church admin to confirm; no household changes until they do, and two42 keeps the suggestions and which household is linked to which family. Once a household is confirmed, two42 copies the family's address and home phone into the household, if your church admin chooses to, and keeps where they came from and your church's last value. Either adult in the household can change or clear them, and a clear stays.",
          "If your church admin turns on suggesting children, two42 also reads, for the children in a confirmed household's family, their first and last name, birthday month and day, grade and photo, never their birth year, and keeps them as suggestions for the household's primary and spouse. Adding a child stores those details in the household, with no birth year, and their photo once the next refresh fetches it. Adding or dismissing a child keeps only that the household decided, so the child isn't suggested again. Turning it off removes every suggestion not yet added.",
          "If your church admin chooses to show details live from those records instead of copying them, two42 keeps only your name, phones, gender and photo from them, alongside your sign-in email. Your birthday, your household's address and anniversary, and the birthday and grade of a child added from a suggestion whose household hasn't set them are read from your church's records each time someone opens the directory, only for the people that person can already see, and are never stored in two42 or kept on its servers. Suggested children then carry only their names and photo. Switching to live removes every one of those details two42 copied earlier that you hadn't changed. A child already added keeps the birthday and grade they were added with, as household details the household can change. You can hide your birthday, or, as your household's primary or spouse, its address or anniversary, from your own directory entry; two42 keeps only that you hid it.",
          "Private calendar links, if you make them: one for your events, and one for your Supper club suppers. Anyone with a link can see what it shows, including the address of each supper on the Supper club link, so keep them to yourself.",
        ],
        "Your browser keeps a sign-in cookie, a cookie for the last group you opened, and your display choices. two42 sets no advertising or tracking cookies.",
        "Each church keeps usage counts for its church admins: how often each kind of page was opened, and how often one showed an error, per day. They record the kind of page only, never who opened it.",
        "two42's own error logs record what failed, the kind of page, and internal record numbers for what was involved. They never record what you entered. The hosting services keep their own request logs, which can include the addresses requested.",
      ],
    },
    {
      heading: "Who can see it",
      blocks: [
        "Each church's data is kept separate from every other church's. People in one church cannot see another church's data.",
        [
          "The directory shows what each person entered, except a birth year. The year goes into a phone contact someone saves from the directory, and church admins see it in the member list they download. A church admin chooses whether members see everyone in the church or only people they share a group with.",
          "You can leave yourself out of the directory, so your name and details don't appear in it. Your household still shows its name, address and home phone while someone else in it with an account is listed. When no one else is, the household leaves the directory too, with everyone listed in it.",
          "You can hide your email address from everyone but yourself and church admins.",
          "Group content — events, announcements, lessons, prayer requests and funds — is seen by that group's members. A church admin sees every person and group in the church, including who is in each group, its teams and labels, and requests to join it. They don't see a group's events, announcements, lessons, prayer requests or funds unless they are in that group.",
          "A leader can make a group private, so members who aren't in it can't find it.",
          "A prayer request posted by name shows the author to group members who can see that person in the directory, and to church admins and the author's household who are in the group. An anonymous request shows no author in the app to anyone but the author: not to other members, leaders or church admins. A leader can edit or delete any prayer request in their group, without learning who wrote an anonymous one.",
          "A comment on a prayer request is seen by everyone who can see the request, or, if you choose, only by you and the person who posted the request. With your name hidden, a comment shows no name to anyone: not to other members, leaders or church admins. You, the person who posted the request, and the group's leaders can delete a comment.",
          "A Supper club sign-up is seen by the people in it, the group's leaders, and, once a leader publishes the tables, the people seated at the same table. The same goes for each person's Going or Not going for a supper.",
          "A host's address for the Supper club is seen by the host, the group's leaders, and the people seated at a table that host has a supper for, only once a leader publishes the tables. Allergies and food needs are seen by the people who signed up together, the group's leaders, and the host of each supper they are seated at. Being a church admin gives no extra access to the Supper club.",
          "Which of your details came from your church's records, and your church's value for each, is seen by you, church admins, and the household's primary or spouse, who can edit your profile. Everyone in your household sees where the household's anniversary, address and home phone came from. Children suggested from your church's records are seen only by the household's primary and spouse, and by no one while your church has suggesting children turned off. The household suggestions are seen only by church admins.",
          "Email reminders and team messages go only to the people they are for.",
        ],
      ],
    },
    {
      heading: "What two42 can see",
      blocks: [
        "two42 has administrator access to the database. Prayer request and comment text is encrypted, and the keys are kept in the hosting settings, apart from the database, so a copy of the database alone shows no request or comment text and no anonymous author. two42 holds those keys, so it can still open a request or comment and work out who wrote an anonymous one. That access is used only to keep the service running, fix a problem, answer a request you make, or comply with the law.",
        "two42 discloses data to authorities only when the law requires it.",
      ],
    },
    {
      heading: "Services that handle your data",
      blocks: [
        PROCESSORS.map((p) => `${p.name}: ${p.does}`),
        "The services your browser connects to see your IP address and browser details with each request, and keep their own logs for periods they set.",
        "Some links take you to other services by your choice: adding an event to your own calendar, opening a map or a meeting link, or giving through a payment app. What happens there is covered by that service's policy.",
      ],
    },
    {
      heading: "How long it is kept",
      blocks: [
        "What you and your church enter is kept while your account and your church use two42. For each active church, a nightly job deletes:",
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
        "You can delete your own prayer requests and comments at any time. You can change anything in your profile, and remove anything except your name and email address.",
        "You can delete your account from the same place, and a church admin can delete an account in their church. Deleting an account:",
        [
          "Removes the profile, photo, sign-in, group and team memberships, RSVPs, serving turns, calendar links, Supper club replies, and prayer requests and comments, including anonymous ones.",
          "Removes the person from their Supper club sign-ups. A sign-up with no one else in it goes, with its address and food notes.",
          "Removes the household and the people listed in it, when no one else is left in it.",
          "Keeps announcements, events and lessons the person added, without their name, and feedback without a name.",
          "Keeps serving dates shared with someone else, with that person.",
          "Keeps a Supper club sign-up shared with someone else, with its address and food notes, with that person.",
          "Moves a fund the person receives to its second person, or to whoever a leader chooses. The fund is hidden from Give until a leader confirms it.",
        ],
        "A church needs at least one church admin, so the last one adds another before deleting their own account.",
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
