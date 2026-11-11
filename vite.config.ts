import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    // `npm run dev` (UI hot reload) + `npm run dev:worker` (wrangler on 8787) side by side
    proxy: { "/api": "http://localhost:8787", "/ws": { target: "ws://localhost:8787", ws: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
  test: { include: ["tests-engine/**/*.test.ts"] }, // Playwright layout specs live in tests/ and run via `npm run test:layout`
});
