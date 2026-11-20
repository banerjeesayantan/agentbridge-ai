export const EMBED_CONFIG = {
  // The widget is a sibling Vercel service mounted on the same public origin.
  WIDGET_URL:
    import.meta.env.VITE_WIDGET_URL ||
    (import.meta.env.DEV
      ? "http://localhost:3001"
      : "https://agentbridge-ai-seven.vercel.app/widget"),
  BOOTSTRAP_URL:
    import.meta.env.VITE_WIDGET_BOOTSTRAP_URL ||
    "https://whimsical-frog-463.convex.site/widget/bootstrap",
  DEFAULT_ORG_ID: "org_3L56300Ir3DhbH165p8PPdxt0XA",
  DEFAULT_POSITION: "bottom-right" as const,
};
