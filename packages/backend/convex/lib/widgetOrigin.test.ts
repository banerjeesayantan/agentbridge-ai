import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAllowedOrigins, signWidgetInstallToken, verifyWidgetInstallToken } from "./widgetOrigin";

afterEach(() => vi.unstubAllEnvs());

describe("widget installation origin policy", () => {
  it("normalizes HTTPS origins and local development origins", () => {
    expect(normalizeAllowedOrigins(["https://Example.com", "http://localhost:3001", "https://example.com"])).toEqual([
      "https://example.com",
      "http://localhost:3001",
    ]);
  });

  it("rejects insecure non-local origins and paths", () => {
    expect(() => normalizeAllowedOrigins(["http://example.com"])).toThrow();
    expect(() => normalizeAllowedOrigins(["https://example.com/support"])).toThrow();
  });
});

describe("widget installation token", () => {
  const secret = "test-widget-installation-secret-with-more-than-32-characters";

  it("signs and verifies a short-lived organization and origin claim", async () => {
    vi.stubEnv("WIDGET_INSTALLATION_SECRET", secret);
    const now = Date.now();
    const token = await signWidgetInstallToken({
      organizationId: "org_123456",
      origin: "https://example.com",
      issuedAt: now,
      expiresAt: now + 5 * 60_000,
    });
    await expect(verifyWidgetInstallToken(token, "org_123456", "https://example.com")).resolves.toMatchObject({
      organizationId: "org_123456",
      origin: "https://example.com",
    });
  });

  it("preserves the authenticated Playground preview claim", async () => {
    vi.stubEnv("WIDGET_INSTALLATION_SECRET", secret);
    const now = Date.now();
    const token = await signWidgetInstallToken({
      organizationId: "org_123456",
      origin: "https://preview.example",
      issuedAt: now,
      expiresAt: now + 5 * 60_000,
      preview: true,
    });
    await expect(verifyWidgetInstallToken(token, "org_123456")).resolves.toMatchObject({
      organizationId: "org_123456",
      origin: "https://preview.example",
      preview: true,
    });
  });

  it("rejects tampering, a different organization, and a different origin", async () => {
    vi.stubEnv("WIDGET_INSTALLATION_SECRET", secret);
    const now = Date.now();
    const token = await signWidgetInstallToken({ organizationId: "org_123456", origin: "https://example.com", issuedAt: now, expiresAt: now + 60_000 });
    await expect(verifyWidgetInstallToken(token + "x", "org_123456")).rejects.toThrow();
    await expect(verifyWidgetInstallToken(token, "org_other")).rejects.toThrow();
    await expect(verifyWidgetInstallToken(token, "org_123456", "https://attacker.example")).rejects.toThrow();
  });

  it("rejects expired tokens and missing signing secrets", async () => {
    vi.stubEnv("WIDGET_INSTALLATION_SECRET", secret);
    const now = Date.now();
    const token = await signWidgetInstallToken({ organizationId: "org_123456", origin: "https://example.com", issuedAt: now - 120_000, expiresAt: now - 60_000 });
    await expect(verifyWidgetInstallToken(token, "org_123456")).rejects.toThrow();
    vi.stubEnv("WIDGET_INSTALLATION_SECRET", "");
    await expect(signWidgetInstallToken({ organizationId: "org_123456", origin: "https://example.com", issuedAt: now, expiresAt: now + 60_000 })).rejects.toThrow();
  });
});
