import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "sidecar/**", "src-tauri/**"],
    server: {
      deps: {
        // @lobehub/icons re-exports brand SVGs and uses directory imports
        // (e.g. ".../FluentEmoji") that Node's strict ESM resolver rejects.
        // Inlining lets vite's resolver handle them through the dev pipeline.
        inline: [/@lobehub/],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/components/ui/**",
        "src/themes/definitions/**",
        "src/**/*.d.ts",
        // Type-only re-export files — v8 reports 0% pct on pure-type modules.
        "src/lib/ipc.ts",
        "src/themes/types.ts",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 95,
      },
    },
  },
});
