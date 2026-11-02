import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "src/test/server-only-stub.ts"),
    },
  },
  // Production-mode JSX so tests that stub NODE_ENV=production can still render components.
  oxc: { jsx: { runtime: "automatic", development: false } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Makes .env.local available to the opt-in live test. Values are never printed.
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
