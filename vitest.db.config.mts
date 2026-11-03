import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests against local Supabase (`npm run test:db`). Kept out of
// `npm test` because they need Docker and a running stack.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["supabase/tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
