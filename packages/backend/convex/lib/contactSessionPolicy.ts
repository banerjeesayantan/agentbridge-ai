export interface ContactSessionDetails {
  name: string;
  email: string;
}

/** Normalize and validate visitor-controlled contact details on the server. */
export function normalizeContactDetails(
  name: string,
  email: string,
): ContactSessionDetails {
  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedName || normalizedName.length > 120) {
    throw new Error("Name must contain between 1 and 120 characters.");
  }

  if (
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    throw new Error("A valid email address is required.");
  }

  return { name: normalizedName, email: normalizedEmail };
}

/** Session validity is strict: a session expires at its expiry timestamp. */
export function isContactSessionActive(expiresAt: number, now: number): boolean {
  return expiresAt > now;
}
