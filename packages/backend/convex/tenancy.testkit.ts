import { newT, type T } from "./finance.testkit";

export type Tenancy = Awaited<ReturnType<typeof seedTenancy>>;

/** Two active organizations, each with a visitor session and a conversation, plus an expired session. */
export async function seedTenancy(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const day = 24 * 3600_000;
    for (const org of ["org_A", "org_B"]) {
      await ctx.db.insert("organizations", { clerkOrgId: org, name: org, status: "active", updatedAt: now });
    }
    const session = (organizationId: string, expiresAt = now + day) =>
      ctx.db.insert("contactSessions", { name: "Vi Sitor", email: `v@${organizationId}.test`, organizationId, expiresAt });
    const sA = await session("org_A");
    const sA2 = await session("org_A");
    const sB = await session("org_B");
    const sAExpired = await session("org_A", now - 1000);
    const conv = (organizationId: string, contactSessionId: typeof sA, threadId: string, status: "unresolved" | "escalated" | "resolved" = "unresolved") =>
      ctx.db.insert("conversations", { organizationId, contactSessionId, threadId, status });
    const cA = await conv("org_A", sA, "thread_A");
    const cB = await conv("org_B", sB, "thread_B");
    return { sA, sA2, sB, sAExpired, cA, cB, threadA: "thread_A", threadB: "thread_B" };
  });
}

export const identity = (orgId: string | undefined, role: "org:admin" | "org:member" | null = "org:admin", subject = "user_1") => ({
  subject,
  issuer: "https://clerk.test",
  ...(orgId ? { orgId } : {}),
  ...(role ? { orgRole: role } : {}),
});

export type Runner = Pick<T, "query" | "mutation" | "action">;
export { newT };
export type { T };
