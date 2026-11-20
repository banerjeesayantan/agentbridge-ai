import { defineConfig } from "vite";
import { resolve } from "path";

// The widget application serves this directory as static assets. Keep the
// generated embed bundle beside the Next.js app so the production web origin
// can serve /widget.js; Vite's default dist/ output is not deployed by Next.
export default defineConfig({
  build: {
    outDir: resolve(__dirname, "../widget/public"),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "embed.ts"),
      name: "AgentBridgeWidget",
      fileName: () => "widget.js",
      formats: ["iife"],
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
  server: {
    port: 3002,
    open: "/demo.html",
  },
});
