// `npm run refresh`: runs the catalogue refresh on the local dev server
// (`npm run dev`), the way the production scheduler will. Prints the HTTP
// status and the route's counts, never the secret.
export {};

try {
  process.loadEnvFile(".env.local");
} catch {
  console.error("No .env.local found. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set in .env.local.");
  process.exit(1);
}

try {
  const res = await fetch("http://localhost:3000/api/cron/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  if (res.ok) {
    const counts = JSON.parse(body) as Record<string, number>;
    const line = ["refreshed", "failed", "purged", "pruned"].map((key) => `${key} ${counts[key]}`).join(", ");
    console.log(`HTTP ${res.status}: ${line}`);
  } else {
    console.log(`HTTP ${res.status}: ${body}`);
  }
  process.exitCode = res.ok ? 0 : 1;
} catch {
  console.error("Couldn't reach http://localhost:3000. Is `npm run dev` running?");
  process.exitCode = 1;
}
