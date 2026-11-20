import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "embed.ts"),
      name: "AgentBridgeWidget",
      // Vercel routes /embed/widget.js to this service without stripping
      // the prefix, so keep the same path inside the static build output.
      fileName: () => "embed/widget.js",
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
