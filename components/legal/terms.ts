import { CONTACT_EMAIL, GITHUB_URL } from "@/components/landing/sections";
import type { LegalDocument } from "./document";
import { PRIVACY_EMAIL } from "./privacy";

// Before editing, read docs/legal/README.md.

export const SECURITY_EMAIL = "security@two42.io";
const AGPL_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

export const TERMS: LegalDocument = {
  title: "Terms of service",
  summary: "The agreement between two42 and the churches and people that use the hosted service at two42.io.",
  lastUpdated: "2026-11-13",
  sections: [
    {
      heading: "Who these terms are with",
      blocks: [
        "two42 is run by Cody Waits as a solo developer. These terms cover the hosted service at two42.io. By using it, you agree to them and to the [Privacy policy](/privacy).",
        "\"You\" means a church that uses two42 and each person with an account in it.",
        "two42 is offered in the United States and is not directed at people outside it.",
      ],
    },
    {
      heading: "The software and the service",
      blocks: [
        `The two42 software is [open source](${GITHUB_URL}) under the [GNU Affero General Public License, version 3](${AGPL_URL}). That license, not these terms, covers copying, changing and running the code.`,
        "These terms cover the hosted service at two42.io only. A church that runs its own copy sets its own terms for it.",
      ],
    },
    {
      heading: "Your account",
      blocks: [
        [
          "You must be 13 or older to have an account. A parent may list a child in their household without giving the child an account.",
          "An account is for one person. Keep your password to yourself, and tell your church admin if you think someone else has used your account.",
          "You are responsible for what you post and do in two42.",
          "Accounts must belong to real people, not automated programs.",
        ],
      ],
    },
    {
      heading: "Churches and church admins",
      blocks: [
        "A church decides who joins its two42 space and what is shared there. Its church admins:",
        [
          "Confirm they have permission to add each person they invite, import or list, and to share what they enter about them.",
          "Answer their members' questions and requests about their data first, and pass on what they can't handle.",
          "Keep at least one church admin on the church, and keep the church's details current.",
          "Make sure the church's leaders and members use two42 as these terms allow.",
        ],
        "A leader is responsible for what they publish in their group.",
      ],
    },
    {
      heading: "Acceptable use",
      blocks: [
        "Don't use two42 to:",
        [
          "Break the law, or help someone else break it.",
          "Harass, threaten or abuse anyone, or post content that does.",
          "Post someone else's private information without their permission.",
          "Send spam, or collect people's details to contact them outside the church's purpose.",
          "Upload malware, probe for weaknesses without permission, or try to reach another church's data.",
          "Overload the service or get around its limits.",
        ],
        `If you find a security problem, write to [${SECURITY_EMAIL}](mailto:${SECURITY_EMAIL}) instead of testing it further, and don't touch real members' data.`,
      ],
    },
    {
      heading: "Your content",
      blocks: [
        "What you and your church put into two42 stays yours. You give two42 permission to store it and show it to the people your church and your settings allow, only to run the service.",
        "If content, an account or a church breaks these terms or puts the service or other people at risk, Cody Waits may remove the content, delete the account or suspend the church.",
      ],
    },
    {
      heading: "Giving",
      blocks: [
        "Funds in two42 show payment handles, such as a Venmo or PayPal name, and link to the payment app. two42 does not process, hold or track payments. A gift is between the giver, the person it goes to and the payment app.",
      ],
    },
    {
      heading: "Changes and ending",
      blocks: [
        "two42 is built by one person. Features can change or be removed, and the service may be down at times.",
        `You can stop using two42 at any time. You can delete your own account in Settings, and a church admin can ask for the church's data to be removed by writing to [${PRIVACY_EMAIL}](mailto:${PRIVACY_EMAIL}).`,
      ],
    },
    {
      heading: "No warranty",
      blocks: [
        "two42 is provided as is and as available, without any warranty, express or implied, including that it will meet your needs, be available without interruption, or be free of errors. Keep your own copy of anything you can't afford to lose.",
        "To the fullest extent the law allows, Cody Waits is not liable for any indirect, incidental, special or consequential damages, or for lost data, arising from your use of two42 or your inability to use it.",
      ],
    },
    {
      heading: "Changes to these terms",
      blocks: [
        `When these terms change, the date at the top changes too. Every change is public in [the two42 source](${GITHUB_URL}/commits/main/components/legal/terms.ts). Using two42 after a change means you accept it.`,
        `Questions about these terms go to [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). Privacy questions and requests go to [${PRIVACY_EMAIL}](mailto:${PRIVACY_EMAIL}).`,
      ],
    },
  ],
};
