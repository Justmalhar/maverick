import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(async () => ({
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
