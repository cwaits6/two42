// The Header's signed-out nav links to these ids, so both the page markup
// and the nav read them from here.
export const SECTION_IDS = {
  features: "features",
  members: "members",
  open: "open",
} as const;

export const LANDING_SECTIONS = [
  { id: SECTION_IDS.features, label: "Features" },
  { id: SECTION_IDS.members, label: "For members" },
  { id: SECTION_IDS.open, label: "Open source" },
] as const;

export const GITHUB_URL = "https://github.com/cwaits6/two42";
export const SELF_HOST_URL = `${GITHUB_URL}#deploying-to-production`;
export const CONTACT_EMAIL = "hello@two42.io";
