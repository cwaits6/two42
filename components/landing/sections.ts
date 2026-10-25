// Anchor targets on the front door. The Header's signed-out nav links to
// them, so the ids live here rather than in the page markup alone.
export const LANDING_SECTIONS = [
  { id: "features", label: "Features" },
  { id: "members", label: "For members" },
  { id: "open", label: "Open source" },
] as const;

export const GITHUB_URL = "https://github.com/cwaits6/two42";
export const SELF_HOST_URL = `${GITHUB_URL}#deploying-to-production`;
export const CONTACT_EMAIL = "hello@two42.io";
