import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: resolve(__dirname, "../widget/public"),
    lib: {
      entry: resolve(__dirname, "embed.ts"),
      name: "AgentBridgeWidget",
      fileName: () => "widget.js",
      formats: ["iife"],
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
  server: {
    port: 3002,
    open: "/demo.html",
  },
});
