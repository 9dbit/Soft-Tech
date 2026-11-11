import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  expect: { timeout: 10000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    ...devices["Desktop Chrome"],
    // GitHub-hosted Ubuntu ships stable Chrome. Use it in CI to avoid apt mirror DNS outages.
    channel: process.env.CI ? "chrome" : undefined,
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
});
