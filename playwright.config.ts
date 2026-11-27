import { defineConfig, devices } from "@playwright/test";
import { localSupabase } from "./e2e/local-supabase";

// Runs against a production build, as the Next.js docs recommend.
// Port 3100 so a dev server on 3000 is never mistaken for this one.
const PORT = 3100;
// e2e/stub-providers.ts stands in for TMDB, IGDB, Hardcover and Twitch.
const STUB = "http://127.0.0.1:3101";

// The app under test talks to local Supabase (`npx supabase start`). Its URL and
// keys come from the CLI, so no .env.local is needed for e2e.
const supabase = localSupabase();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON e2e/stub-providers.ts",
      url: `${STUB}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run build && npm run start -- --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      // Env set here wins over .env.local, so e2e never reaches the real providers.
      env: {
        NEXT_PUBLIC_SUPABASE_URL: supabase.url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
        // The real local key: the app imports into the catalogue at runtime.
        // e2e/secrets.spec.ts hunts for it in the build output (INV-005).
        SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
        // Fake provider secrets that e2e/secrets.spec.ts hunts for too.
        TMDB_API_READ_ACCESS_TOKEN: "SENTINEL_TMDB_7f3a",
        IGDB_CLIENT_ID: "SENTINEL_IGDB_ID_7f3a",
        IGDB_CLIENT_SECRET: "SENTINEL_IGDB_SECRET_7f3a",
        HARDCOVER_API_TOKEN: "SENTINEL_HARDCOVER_7f3a",
        CRON_SECRET: "SENTINEL_CRON_7f3a",
        TMDB_API_BASE_URL: `${STUB}/tmdb`,
        IGDB_API_BASE_URL: `${STUB}/igdb`,
        HARDCOVER_API_URL: `${STUB}/hardcover`,
        // e2e workers share one limiter, so searches wait longer than the production 3 s cap.
        HARDCOVER_SEARCH_MAX_WAIT_MS: "30000",
        TWITCH_TOKEN_URL: `${STUB}/twitch/token`,
      },
    },
  ],
});
