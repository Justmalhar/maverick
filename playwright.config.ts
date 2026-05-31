import { defineConfig, devices } from "@playwright/test";

// Golden-path E2E. Drives the Vite-built webview in Chromium. The full Tauri
// runtime (Rust + sidecar) is not present in a plain browser, so `invoke` calls
// no-op — these specs verify the app shell boots and the first-run surface
// renders, not backend round-trips. Full Tauri E2E (tauri-driver) is future work.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
