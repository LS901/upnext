// `npm run providers:check`: checks the TMDB and IGDB credentials in
// .env.local with one search each. Prints only "ok" or "failed" with the HTTP
// status, never a key or a response body.
//
// Standalone on purpose: plain Node runs it (type stripping), and the app's
// provider modules are `server-only` with extensionless imports, which Node
// can't load directly.
export {};

try {
  process.loadEnvFile(".env.local");
} catch {
  console.error("No .env.local found. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const env = (name: string) => process.env[name] ?? "";
const base = (name: string, fallback: string) => (env(name) || fallback).replace(/\/+$/, "");

const failed = (res: Response) => `failed (HTTP ${res.status})`;

async function checkTmdb(): Promise<string> {
  const url = new URL(`${base("TMDB_API_BASE_URL", "https://api.themoviedb.org/3")}/search/multi`);
  url.searchParams.set("query", "lantern");
  url.searchParams.set("include_adult", "false");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env("TMDB_API_READ_ACCESS_TOKEN")}`, Accept: "application/json" },
  });
  return res.ok ? "ok" : failed(res);
}

async function checkIgdb(): Promise<string> {
  const tokenUrl = new URL(env("TWITCH_TOKEN_URL") || "https://id.twitch.tv/oauth2/token");
  tokenUrl.searchParams.set("client_id", env("IGDB_CLIENT_ID"));
  tokenUrl.searchParams.set("client_secret", env("IGDB_CLIENT_SECRET"));
  tokenUrl.searchParams.set("grant_type", "client_credentials");
  const tokenRes = await fetch(tokenUrl, { method: "POST" });
  if (!tokenRes.ok) return failed(tokenRes);
  let token: unknown;
  try {
    token = ((await tokenRes.json()) as { access_token?: unknown }).access_token;
  } catch {
    return "failed (bad response)";
  }
  if (typeof token !== "string" || !token) return "failed (bad response)";

  const res = await fetch(`${base("IGDB_API_BASE_URL", "https://api.igdb.com/v4")}/games`, {
    method: "POST",
    headers: { "Client-ID": env("IGDB_CLIENT_ID"), Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: 'search "lantern"; fields name; limit 1;',
  });
  return res.ok ? "ok" : failed(res);
}

let allOk = true;
for (const [name, check] of [["TMDB", checkTmdb], ["IGDB", checkIgdb]] as const) {
  const result = await check().catch(() => "failed (network)");
  if (result !== "ok") allOk = false;
  console.log(`${name}: ${result}`);
}
process.exitCode = allOk ? 0 : 1;
