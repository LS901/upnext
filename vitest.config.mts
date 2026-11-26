import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// On Windows, a lowercase drive letter in the working directory (VS Code's
// default terminal gives c:\) makes Vitest load two copies of itself, and
// every test fails with "Vitest failed to find the current suite". Pinning the
// root to an uppercase drive letter keeps one copy.
const root = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase());

export default defineConfig({
  root,
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          // Lets Testing Library register its own afterEach(cleanup), so no
          // setup file is needed. Tests still import test and expect from
          // "vitest".
          globals: true,
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["supabase/tests/**/*.test.ts"],
          globalSetup: ["./supabase/tests/global-setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
