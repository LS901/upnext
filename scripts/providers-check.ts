// `npm run providers:check`: checks the TMDB, IGDB and Hardcover credentials in
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
  // The secret goes in a form body, never the URL (URLs end up in logs).
  const tokenRes = await fetch(env("TWITCH_TOKEN_URL") || "https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("IGDB_CLIENT_ID"),
      client_secret: env("IGDB_CLIENT_SECRET"),
      grant_type: "client_credentials",
    }),
  });
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

async function checkHardcover(): Promise<string> {
  const token = env("HARDCOVER_API_TOKEN").trim().replace(/^Bearer\s+/i, "");
  const res = await fetch(env("HARDCOVER_API_URL") || "https://api.hardcover.app/v1/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "upnext (https://github.com/LS901/upnext)",
    },
    body: JSON.stringify({ query: '{ search(query: "lantern", query_type: "book", per_page: 1) { results } }' }),
  });
  if (!res.ok) return failed(res);
  try {
    const body = (await res.json()) as { errors?: unknown[] };
    return Array.isArray(body.errors) && body.errors.length > 0 ? "failed (bad response)" : "ok";
  } catch {
    return "failed (bad response)";
  }
}

let allOk = true;
for (const [name, check] of [["TMDB", checkTmdb], ["IGDB", checkIgdb], ["Hardcover", checkHardcover]] as const) {
  const result = await check().catch(() => "failed (network)");
  if (result !== "ok") allOk = false;
  console.log(`${name}: ${result}`);
}
process.exitCode = allOk ? 0 : 1;
