
import { VapiClient, Vapi } from "@vapi-ai/server-sdk";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSecretValue, parseSecretString } from "../lib/secrets";

export const getAssistants = action({
  args: {},

  handler: async (ctx): Promise<Vapi.Assistant[]> => {
    // 1. Authenticate the current user.
    const identity = await ctx.auth.getUserIdentity();

    if (identity === null) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Identity not found",
      });
    }

    // 2. Validate organization membership context.
    const orgId = identity.orgId;

    if (typeof orgId !== "string" || !orgId.trim()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Organization not found",
      });
    }

    // 3. Retrieve this organization's Vapi integration.
    const plugin = await ctx.runQuery(
      internal.system.plugins.getByOrganizationIdAndService,
      {
        organizationId: orgId,
        service: "vapi",
      },
    );

    if (!plugin) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Plugin not found",
      });
    }

    // 4. Load and parse the stored integration credentials.
    const secretName = plugin.secretName;
    const secretValue = await getSecretValue(secretName);

    const secretData = parseSecretString<{
      privateApiKey: string;
      publicApiKey: string;
    }>(secretValue);

    if (!secretData) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Credentials not found",
      });
    }

    if (
      !secretData.privateApiKey?.trim() ||
      !secretData.publicApiKey?.trim()
    ) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message:
          "Credentials incomplete. Please reconnect your Vapi account.",
      });
    }

    // 5. Authenticate against Vapi using the private server-side key.
    const vapiClient = new VapiClient({
      token: secretData.privateApiKey,
    });

    // 6. Return the assistants available through this integration.
    const assistants = await vapiClient.assistants.list();

    return assistants;
  },
});

export const getPhoneNumbers = action({
  args: {},

  handler: async (
    ctx,
  ): Promise<Vapi.PhoneNumbersListResponseItem[]> => {
    // 1. Authenticate the current user.
    const identity = await ctx.auth.getUserIdentity();

    if (identity === null) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Identity not found",
      });
    }

    // 2. Validate organization membership context.
    const orgId = identity.orgId;

    if (typeof orgId !== "string" || !orgId.trim()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Organization not found",
      });
    }

    // 3. Retrieve this organization's Vapi integration.
    const plugin = await ctx.runQuery(
      internal.system.plugins.getByOrganizationIdAndService,
      {
        organizationId: orgId,
        service: "vapi",
      },
    );

    if (!plugin) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Plugin not found",
      });
    }

    // 4. Load and parse the stored integration credentials.
    const secretName = plugin.secretName;
    const secretValue = await getSecretValue(secretName);

    const secretData = parseSecretString<{
      privateApiKey: string;
      publicApiKey: string;
    }>(secretValue);

    if (!secretData) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Credentials not found",
      });
    }

    if (
      !secretData.privateApiKey?.trim() ||
      !secretData.publicApiKey?.trim()
    ) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message:
          "Credentials incomplete. Please reconnect your Vapi account.",
      });
    }

    // 5. Authenticate against Vapi using the private server-side key.
    const vapiClient = new VapiClient({
      token: secretData.privateApiKey,
    });

    // 6. Return the phone numbers available through this integration.
    const phoneNumbers = await vapiClient.phoneNumbers.list();

    return phoneNumbers;
  },
});
