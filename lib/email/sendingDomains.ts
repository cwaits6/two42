// Per-org custom sending domains stay off until there is a paid tier: a
// volunteer admin maintaining SPF/DKIM/DMARC is the most support-heavy thing
// the app could hand them. The schema, the send-path gate and the platform
// operator's per-org toggle are unaffected; this hides only the admin surface.
export const CUSTOM_SENDING_DOMAINS_ENABLED: boolean = false;
