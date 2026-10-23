export const INTEGRATIONS = [
  {
    id: "html",
    title: "HTML",
    icon: "/languages/html5.svg",
  },
  {
    id: "react",
    title: "React",
    icon: "/languages/react.svg",
  },
  {
    id: "nextjs",
    title: "Next.js",
    icon: "/languages/nextjs.svg",
  },
  {
    id: "javascript",
    title: "JavaScript",
    icon: "/languages/javascript.svg",
  },
] as const;

export type IntegrationId = (typeof INTEGRATIONS)[number]["id"];

// Where the embeddable bundle (widget.js) is served from. Override per
// environment with NEXT_PUBLIC_EMBED_SCRIPT_URL; the default keeps the
// previously hard-coded deployment so existing snippets do not change.
export const EMBED_SCRIPT_URL =
  process.env.NEXT_PUBLIC_EMBED_SCRIPT_URL ||
  "https://next15-echo-widget.vercel.app/widget.js";

export const HTML_SCRIPT = `<script
  src="{{SCRIPT_URL}}"
  data-organization-id="{{ORGANIZATION_ID}}"
  data-position="{{POSITION}}"
></script>`;

// Same bundle, injected after mount so it works in client frameworks where
// a bare <script> tag in JSX would not execute.
export const REACT_SCRIPT = `import { useEffect } from "react";

export function AgentBridgeWidget() {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "{{SCRIPT_URL}}";
    script.dataset.organizationId = "{{ORGANIZATION_ID}}";
    script.dataset.position = "{{POSITION}}";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      window.AgentBridgeWidget?.destroy();
      script.remove();
    };
  }, []);

  return null;
}`;

export const NEXTJS_SCRIPT = `// app/layout.tsx
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="{{SCRIPT_URL}}"
          data-organization-id="{{ORGANIZATION_ID}}"
          data-position="{{POSITION}}"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`;

export const JAVASCRIPT_SCRIPT = `// Load the bundle, then control it from your own code.
const script = document.createElement("script");
script.src = "{{SCRIPT_URL}}";
script.async = true;
script.onload = () => {
  window.AgentBridgeWidget.init({
    organizationId: "{{ORGANIZATION_ID}}",
    position: "{{POSITION}}",
  });
  // Also available: show(), hide(), destroy(), getState()
};
document.body.appendChild(script);`;
