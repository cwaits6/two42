export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordFieldErrors {
  password?: string;
  confirmPassword?: string;
}

/** What to fix on a choose-a-password form, keyed by the field it belongs to. */
export function passwordFieldErrors(password: string, confirmPassword: string): PasswordFieldErrors {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { password: `Enter a password of at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirmPassword) {
    return { confirmPassword: "Enter the same password again." };
  }
  return {};
}

/** Auth error codes whose meaning the person can act on; anything else gets failureMessage(). */
export const PASSWORD_AUTH_ERRORS: Record<string, string> = {
  weak_password: "Choose a stronger password: longer, with letters and numbers.",
  same_password: "Choose a password you haven't used here before.",
};
