import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Build-time provenance (P3-B). Version comes from package.json; the commit
// hash comes from MAVERICK_COMMIT (set by CI) and falls back to `git rev-parse`
// locally, then to "dev" when neither is available (e.g. tarball checkout).
function resolveVersion(): string {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as {
    version?: string;
  };
  return pkg.version ?? "0.0.0";
}

function resolveCommit(): string {
  if (process.env.MAVERICK_COMMIT) return process.env.MAVERICK_COMMIT;
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

export default defineConfig(async () => ({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(resolveVersion()),
    "import.meta.env.VITE_APP_COMMIT": JSON.stringify(resolveCommit()),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-search", "@xterm/addon-web-links"],
          markdown: ["react-markdown", "remark-gfm", "highlight.js"],
          pdf: ["pdfjs-dist"],
          motion: ["framer-motion"],
        },
      },
    },
  },
}));
