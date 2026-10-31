import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Releases abandoned voice-demo reservations and settles unreported calls.
crons.interval("settle stale voice demo sessions", { minutes: 5 }, internal.system.voiceDemo.expireStale, {});

export default crons;
