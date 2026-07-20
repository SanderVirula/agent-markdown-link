import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
    },
    include: ["packages/**/test/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
