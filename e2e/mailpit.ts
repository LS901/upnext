// Reads the emails local Supabase sends, from Mailpit (`npx supabase status` → MAILPIT_URL).
const MAILPIT_URL = "http://127.0.0.1:54324";
const TIMEOUT_MS = 10_000;

type SearchResult = { messages: { ID: string }[] };
type Message = { HTML: string; Text: string };

// Messages already handed out, so asking again for the same address waits for a
// new email instead of returning the previous one.
const returned = new Set<string>();

export async function latestEmailTo(address: string): Promise<{ html: string; text: string }> {
  const query = encodeURIComponent(`to:${address}`);
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
    const { messages } = (await res.json()) as SearchResult;

    // Mailpit lists the newest message first.
    const latest = messages[0];
    if (latest && !returned.has(latest.ID)) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`);
      if (!message.ok) throw new Error(`Mailpit message fetch failed: ${message.status}`);
      const { HTML, Text } = (await message.json()) as Message;
      returned.add(latest.ID);
      return { html: HTML, text: Text };
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`No new email to ${address} within ${TIMEOUT_MS / 1000} s`);
}
