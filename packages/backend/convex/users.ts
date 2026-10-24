import { query } from "./_generated/server";

// Scaffold leftover: restrict to signed-in users. The `users` table is not
// otherwise used by the product.
export const getMany = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new Error("Not authenticated");
    }
    return await ctx.db.query("users").collect();
  },
});
