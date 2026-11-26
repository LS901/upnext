import { execSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

// Runs against a production build, as the Next.js docs recommend.
// Port 3100 so a dev server on 3000 is never mistaken for this one.
const PORT = 3100;

// The app under test talks to local Supabase (`npx supabase start`). Its URL and
// publishable key come from the CLI, so no .env.local is needed for e2e.
function localSupabase(): { url: string; publishableKey: string } {
  let output: string;
  try {
    output = execSync("npx supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("Local Supabase isn't running. Start Docker, then run: npx supabase start");
  }
  const env: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) env[match[1]] = match[2];
  }
  const url = env.API_URL;
  const publishableKey = env.PUBLISHABLE_KEY ?? env.ANON_KEY;
  if (!url || !publishableKey) {
    throw new Error("Couldn't read the local Supabase URL and key from `npx supabase status -o env`.");
  }
  return { url, publishableKey };
}

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
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
    },
  },
});
