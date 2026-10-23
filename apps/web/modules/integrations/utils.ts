import {
  EMBED_SCRIPT_URL,
  HTML_SCRIPT,
  type IntegrationId,
  JAVASCRIPT_SCRIPT,
  NEXTJS_SCRIPT,
  REACT_SCRIPT,
} from "./constants";

export type WidgetPosition = "bottom-right" | "bottom-left";

const TEMPLATES: Record<IntegrationId, string> = {
  html: HTML_SCRIPT,
  react: REACT_SCRIPT,
  nextjs: NEXTJS_SCRIPT,
  javascript: JAVASCRIPT_SCRIPT,
};

export const createScript = (
  integrationId: IntegrationId,
  organizationId: string,
  position: WidgetPosition = "bottom-right",
  scriptUrl: string = EMBED_SCRIPT_URL,
) => {
  const template = TEMPLATES[integrationId];
  if (!template) return "";

  // Function replacers so "$" sequences in values are never interpreted.
  return template
    .replace(/{{SCRIPT_URL}}/g, () => scriptUrl)
    .replace(/{{ORGANIZATION_ID}}/g, () => organizationId)
    .replace(/{{POSITION}}/g, () => position);
};
