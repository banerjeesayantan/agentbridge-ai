/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_accounting from "../lib/accounting.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_entitlements from "../lib/entitlements.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_extractTextContent from "../lib/extractTextContent.js";
import type * as lib_fileValidation from "../lib/fileValidation.js";
import type * as lib_knowledgeFiles from "../lib/knowledgeFiles.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_platformAdmin from "../lib/platformAdmin.js";
import type * as lib_polarApi from "../lib/polarApi.js";
import type * as lib_polarConfig from "../lib/polarConfig.js";
import type * as lib_polarMapping from "../lib/polarMapping.js";
import type * as lib_polarOrder from "../lib/polarOrder.js";
import type * as lib_polarOrderHandler from "../lib/polarOrderHandler.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_standardWebhooks from "../lib/standardWebhooks.js";
import type * as lib_vapiCentral from "../lib/vapiCentral.js";
import type * as lib_vapiJwt from "../lib/vapiJwt.js";
import type * as lib_vapiWebhook from "../lib/vapiWebhook.js";
import type * as lib_voiceBudget from "../lib/voiceBudget.js";
import type * as playground from "../playground.js";
import type * as private_billing from "../private/billing.js";
import type * as private_contactSessions from "../private/contactSessions.js";
import type * as private_conversations from "../private/conversations.js";
import type * as private_feedback from "../private/feedback.js";
import type * as private_files from "../private/files.js";
import type * as private_messages from "../private/messages.js";
import type * as private_plugins from "../private/plugins.js";
import type * as private_secrets from "../private/secrets.js";
import type * as private_usage from "../private/usage.js";
import type * as private_vapi from "../private/vapi.js";
import type * as private_voiceAdmin from "../private/voiceAdmin.js";
import type * as private_voiceBilling from "../private/voiceBilling.js";
import type * as private_voiceTrials from "../private/voiceTrials.js";
import type * as private_widgetSettings from "../private/widgetSettings.js";
import type * as public_contactSessions from "../public/contactSessions.js";
import type * as public_conversations from "../public/conversations.js";
import type * as public_feedback from "../public/feedback.js";
import type * as public_messages from "../public/messages.js";
import type * as public_organizations from "../public/organizations.js";
import type * as public_secrets from "../public/secrets.js";
import type * as public_voicePaid from "../public/voicePaid.js";
import type * as public_voiceTrials from "../public/voiceTrials.js";
import type * as public_widgetSettings from "../public/widgetSettings.js";
import type * as system_ai_agents_supportAgent from "../system/ai/agents/supportAgent.js";
import type * as system_ai_constants from "../system/ai/constants.js";
import type * as system_ai_models from "../system/ai/models.js";
import type * as system_ai_rag from "../system/ai/rag.js";
import type * as system_ai_tools_escalateConversation from "../system/ai/tools/escalateConversation.js";
import type * as system_ai_tools_resolveConversation from "../system/ai/tools/resolveConversation.js";
import type * as system_ai_tools_search from "../system/ai/tools/search.js";
import type * as system_billingReconcile from "../system/billingReconcile.js";
import type * as system_clerkSync from "../system/clerkSync.js";
import type * as system_contactSessions from "../system/contactSessions.js";
import type * as system_conversations from "../system/conversations.js";
import type * as system_fileUploads from "../system/fileUploads.js";
import type * as system_maintenance from "../system/maintenance.js";
import type * as system_organizations from "../system/organizations.js";
import type * as system_plugins from "../system/plugins.js";
import type * as system_polarWebhook from "../system/polarWebhook.js";
import type * as system_rateLimit from "../system/rateLimit.js";
import type * as system_revenue from "../system/revenue.js";
import type * as system_secrets from "../system/secrets.js";
import type * as system_subscriptions from "../system/subscriptions.js";
import type * as system_usage from "../system/usage.js";
import type * as system_voiceBinding from "../system/voiceBinding.js";
import type * as system_voiceTrials from "../system/voiceTrials.js";
import type * as system_voiceWallet from "../system/voiceWallet.js";
import type * as users from "../users.js";
import type * as vapiWebhookHttp from "../vapiWebhookHttp.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  constants: typeof constants;
  crons: typeof crons;
  http: typeof http;
  "lib/accounting": typeof lib_accounting;
  "lib/auth": typeof lib_auth;
  "lib/entitlements": typeof lib_entitlements;
  "lib/env": typeof lib_env;
  "lib/extractTextContent": typeof lib_extractTextContent;
  "lib/fileValidation": typeof lib_fileValidation;
  "lib/knowledgeFiles": typeof lib_knowledgeFiles;
  "lib/limits": typeof lib_limits;
  "lib/money": typeof lib_money;
  "lib/platformAdmin": typeof lib_platformAdmin;
  "lib/polarApi": typeof lib_polarApi;
  "lib/polarConfig": typeof lib_polarConfig;
  "lib/polarMapping": typeof lib_polarMapping;
  "lib/polarOrder": typeof lib_polarOrder;
  "lib/polarOrderHandler": typeof lib_polarOrderHandler;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/secrets": typeof lib_secrets;
  "lib/standardWebhooks": typeof lib_standardWebhooks;
  "lib/vapiCentral": typeof lib_vapiCentral;
  "lib/vapiJwt": typeof lib_vapiJwt;
  "lib/vapiWebhook": typeof lib_vapiWebhook;
  "lib/voiceBudget": typeof lib_voiceBudget;
  playground: typeof playground;
  "private/billing": typeof private_billing;
  "private/contactSessions": typeof private_contactSessions;
  "private/conversations": typeof private_conversations;
  "private/feedback": typeof private_feedback;
  "private/files": typeof private_files;
  "private/messages": typeof private_messages;
  "private/plugins": typeof private_plugins;
  "private/secrets": typeof private_secrets;
  "private/usage": typeof private_usage;
  "private/vapi": typeof private_vapi;
  "private/voiceAdmin": typeof private_voiceAdmin;
  "private/voiceBilling": typeof private_voiceBilling;
  "private/voiceTrials": typeof private_voiceTrials;
  "private/widgetSettings": typeof private_widgetSettings;
  "public/contactSessions": typeof public_contactSessions;
  "public/conversations": typeof public_conversations;
  "public/feedback": typeof public_feedback;
  "public/messages": typeof public_messages;
  "public/organizations": typeof public_organizations;
  "public/secrets": typeof public_secrets;
  "public/voicePaid": typeof public_voicePaid;
  "public/voiceTrials": typeof public_voiceTrials;
  "public/widgetSettings": typeof public_widgetSettings;
  "system/ai/agents/supportAgent": typeof system_ai_agents_supportAgent;
  "system/ai/constants": typeof system_ai_constants;
  "system/ai/models": typeof system_ai_models;
  "system/ai/rag": typeof system_ai_rag;
  "system/ai/tools/escalateConversation": typeof system_ai_tools_escalateConversation;
  "system/ai/tools/resolveConversation": typeof system_ai_tools_resolveConversation;
  "system/ai/tools/search": typeof system_ai_tools_search;
  "system/billingReconcile": typeof system_billingReconcile;
  "system/clerkSync": typeof system_clerkSync;
  "system/contactSessions": typeof system_contactSessions;
  "system/conversations": typeof system_conversations;
  "system/fileUploads": typeof system_fileUploads;
  "system/maintenance": typeof system_maintenance;
  "system/organizations": typeof system_organizations;
  "system/plugins": typeof system_plugins;
  "system/polarWebhook": typeof system_polarWebhook;
  "system/rateLimit": typeof system_rateLimit;
  "system/revenue": typeof system_revenue;
  "system/secrets": typeof system_secrets;
  "system/subscriptions": typeof system_subscriptions;
  "system/usage": typeof system_usage;
  "system/voiceBinding": typeof system_voiceBinding;
  "system/voiceTrials": typeof system_voiceTrials;
  "system/voiceWallet": typeof system_voiceWallet;
  users: typeof users;
  vapiWebhookHttp: typeof vapiWebhookHttp;
}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {};
