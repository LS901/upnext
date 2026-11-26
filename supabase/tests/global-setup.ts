import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    supabase: { url: string; publishableKey: string; serviceRoleKey: string };
  }
}

function parseEnv(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export default function setup(project: TestProject) {
  let output: string;
  try {
    output = execSync("npx supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      "Local Supabase isn't running. Start Docker, then run: npx supabase start",
    );
  }
  const env = parseEnv(output);
  const url = env.API_URL;
  const publishableKey = env.PUBLISHABLE_KEY ?? env.ANON_KEY;
  const serviceRoleKey = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY;
  if (!url || !publishableKey || !serviceRoleKey) {
    throw new Error(
      "Couldn't read the local Supabase URL and keys from `npx supabase status -o env`.",
    );
  }
  project.provide("supabase", { url, publishableKey, serviceRoleKey });
}
