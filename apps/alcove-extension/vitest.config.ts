import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts", "entrypoints/**/__tests__/**/*.test.tsx"],
  },
});
