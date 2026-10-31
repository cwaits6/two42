// The platform API answers 400 and 409 with a sentence written for the
// operator to act on. Anything else (auth, a server failure) gets the
// caller's fixed copy, so no internal error text reaches a toast.
export function operatorMessage(
  status: number,
  data: { error?: unknown } | null,
  fallback: string
): string {
  if ((status === 400 || status === 409) && typeof data?.error === "string" && data.error) {
    return data.error;
  }
  return fallback;
}

export const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";
