import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  outputDir: "test-results/artifacts",
  reporter: [["list"]],
  fullyParallel: true,
  use: { baseURL: "http://localhost:5173", reducedMotion: "reduce" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
