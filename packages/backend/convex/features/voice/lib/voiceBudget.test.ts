import { describe, expect, it } from "vitest";
import {
  allowedOriginsAreSecure,
  readVoiceBudgetConfig,
} from "./voiceBudget";

describe("voice token origin security", () => {
  it("allows HTTPS origins in production", () => {
    expect(
      allowedOriginsAreSecure({
        NODE_ENV: "production",
        VOICE_ALLOWED_ORIGINS: "https://widget.example.com",
      }),
    ).toBe(true);
  });

  it("rejects HTTP-only and mixed origins in production", () => {
    for (const origins of [
      "http://widget.example.com",
      "https://widget.example.com,http://localhost:3000",
    ]) {
      expect(
        allowedOriginsAreSecure({
          NODE_ENV: "production",
          VOICE_ALLOWED_ORIGINS: origins,
        }),
      ).toBe(false);
    }
  });

  it("keeps local HTTP origins available outside production", () => {
    expect(
      allowedOriginsAreSecure({
        NODE_ENV: "development",
        VOICE_ALLOWED_ORIGINS: "http://localhost:3000",
      }),
    ).toBe(true);
  });

  it("fails closed when no valid origins are configured", () => {
    expect(allowedOriginsAreSecure({ NODE_ENV: "production" })).toBe(false);
    expect(
      allowedOriginsAreSecure({
        NODE_ENV: "production",
        VOICE_ALLOWED_ORIGINS: "https://good.example.com,not-a-url",
      }),
    ).toBe(false);
  });

  it("also makes paid voice configuration not ready for insecure production origins", () => {
    const config = readVoiceBudgetConfig({
      NODE_ENV: "production",
      VOICE_PAID_MAX_CALL_SECONDS: "600",
      VOICE_MAX_COST_PER_MINUTE_MICRO: "250000",
      VOICE_ALLOWED_ORIGINS: "http://widget.example.com",
    });
    expect(config.ready).toBe(false);
  });
});
