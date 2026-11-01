export interface ContactVisibility {
  phoneMobile: string;
  phoneHome: string;
  phoneWork: string;
  email: string;
  hidePhoneMobile: boolean;
  hidePhoneHome: boolean;
  hidePhoneWork: boolean;
  hideEmail: boolean;
}

export const UNREACHABLE_MESSAGE =
  "Add a phone number, or keep your email visible so people can reach you.";

/** Members must show at least one phone or their email so others can reach them. */
export function isReachable(c: ContactVisibility): boolean {
  return !!(
    (c.phoneMobile && !c.hidePhoneMobile) ||
    (c.phoneHome && !c.hidePhoneHome) ||
    (c.phoneWork && !c.hidePhoneWork) ||
    (c.email && !c.hideEmail)
  );
}
