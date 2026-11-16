/**
 * Platform-admin authorization for financial operations. Enforced on the
 * server for every admin function; the UI never decides who is an admin.
 *
 * PLATFORM_ADMIN_USER_IDS is a comma-separated list of Clerk user IDs. An
 * unset or empty list means NOBODY is an admin (fail closed).
 */
import { ConvexError } from "convex/values";

type Env = Record<string, string | undefined>;

export function platformAdminIds(env: Env): Set<string> {
  return new Set(
    (env.PLATFORM_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isPlatformAdmin(userId: string | undefined | null, env: Env): boolean {
  return typeof userId === "string" && userId.length > 0 && platformAdminIds(env).has(userId);
}

interface AuthCtx {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}

/** Returns the authenticated Clerk user ID, or throws FORBIDDEN / UNAUTHORIZED. */
export async function requirePlatformAdmin(ctx: AuthCtx, env: Env = process.env): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new ConvexError({ code: "UNAUTHORIZED", message: "Identity not found" });
  if (!isPlatformAdmin(identity.subject, env)) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Platform administrator access required" });
  }
  return identity.subject;
}
