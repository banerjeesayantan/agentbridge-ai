import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "release unused voice holds",
  { minutes: 5 },
  internal.features.voice.internal.voiceWallet.expireHolds,
  {},
);

crons.interval(
  "flag provider reports that never got a verified call binding",
  { minutes: 5 },
  internal.features.voice.internal.voiceWallet.reconcileUnboundReports,
  {},
);

crons.interval("purge abandoned visitor sessions", { hours: 1 }, internal.system.maintenance.purgeExpiredSessions, {});
crons.interval("purge ephemeral operational state", { hours: 1 }, internal.system.maintenance.purgeEphemeral, {});
crons.interval("purge old idempotency records", { hours: 24 }, internal.system.maintenance.purgeOldEvents, {});
crons.interval(
  "reconcile Polar subscriptions with the provider",
  { hours: 24 },
  internal.system.billingReconcile.reconcileSubscriptions,
  {},
);

export default crons;
