/**
 * Centralized authentication / authorization for Convex functions.
 *
 * Tenant = Clerk organization. Staff functions MUST derive the organization
 * from the verified identity (never from arguments). Visitor functions MUST
 * derive it from a valid contact session.
 *
 * Role source: the Clerk JWT template named "convex" must emit the active
 * organization id as `orgId` and its role as `orgRole` (or `org_role`), e.g.
 * "org:admin". A missing role claim is treated as a plain member: the safe
 * default. Use `private.auth.whoami` to inspect what a deployment really emits.
 */
import { ConvexError } from "convex/values";
import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type Role = "admin" | "member";
export interface OrgAuth {
  orgId: string;
  role: Role;
  userId: string;
}

type AuthCtx = { auth: { getUserIdentity(): Promise<UserIdentity | null> } };

const ROLE_RANK: Record<Role, number> = { member: 1, admin: 2 };

export function roleFromIdentity(identity: Record<string, unknown>): Role {
  const raw = identity.orgRole ?? identity.org_role;
  return raw === "org:admin" || raw === "admin" ? "admin" : "member";
}

export function orgIdFromIdentity(identity: Record<string, unknown>): string | null {
  const raw = identity.orgId ?? identity.org_id;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export async function requireOrg(ctx: AuthCtx): Promise<OrgAuth> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHORIZED", message: "Identity not found" });
  const orgId = orgIdFromIdentity(identity as unknown as Record<string, unknown>);
  if (!orgId) throw new ConvexError({ code: "UNAUTHORIZED", message: "Organization not found" });
  return { orgId, role: roleFromIdentity(identity as unknown as Record<string, unknown>), userId: identity.subject };
}

export async function requireRole(ctx: AuthCtx, min: Role): Promise<OrgAuth> {
  const auth = await requireOrg(ctx);
  if (ROLE_RANK[auth.role] < ROLE_RANK[min]) {
    throw new ConvexError({ code: "FORBIDDEN", message: "You do not have permission to perform this action" });
  }
  return auth;
}

/** Valid, unexpired visitor session or UNAUTHORIZED. */
export async function requireSession(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  id: Id<"contactSessions">,
  now: number = Date.now(),
): Promise<Doc<"contactSessions">> {
  const session = await ctx.db.get(id);
  if (!session || session.expiresAt <= now) {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid session" });
  }
  return session;
}

/** Cross-tenant and cross-session mismatches look like "not found" (no existence oracle). */
export function notFound(what = "Resource"): never {
  throw new ConvexError({ code: "NOT_FOUND", message: `${what} not found` });
}
