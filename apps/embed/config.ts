export const EMBED_CONFIG = {
  // Keep the deployed widget and embed bundle on the same stable origin.
  // Preview deployments can override these at build time when intentionally
  // testing a separate widget deployment.
  WIDGET_URL:
    import.meta.env.VITE_WIDGET_URL ||
    "https://agentbridge-ai-seven.vercel.app",
  BOOTSTRAP_URL:
    import.meta.env.VITE_WIDGET_BOOTSTRAP_URL ||
    "https://whimsical-frog-463.convex.site/widget/bootstrap",
  DEFAULT_ORG_ID: "org_3L56300Ir3DhbH165p8PPdxt0XA",
  DEFAULT_POSITION: "bottom-right" as const,
};
