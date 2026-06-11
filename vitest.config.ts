import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: [
      "packages/**/*.{test,properties}.ts",
      "services/**/*.test.ts",
      "apps/**/*.test.ts",
    ],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
