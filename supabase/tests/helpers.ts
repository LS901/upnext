import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inject } from "vitest";
import type { Database } from "../../src/lib/supabase/database.types";

export type TestUser = {
  id: string;
  email: string;
  client: SupabaseClient<Database>;
};

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function adminClient(): SupabaseClient<Database> {
  const { url, serviceRoleKey } = inject("supabase");
  return createClient<Database>(url, serviceRoleKey, options);
}

export function anonClient(): SupabaseClient<Database> {
  const { url, publishableKey } = inject("supabase");
  return createClient<Database>(url, publishableKey, options);
}

export function testEmail(role: string): string {
  return `${role}-${randomBytes(4).toString("hex")}@example.test`;
}

// Signs in the way a user does, by magic link: the admin API issues the link's
// token hash, and the client verifies it. No passwords (the Auth layer refuses them).
export async function signInByMagicLink(email: string): Promise<SupabaseClient<Database>> {
  const { data, error } = await adminClient().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;

  const client = anonClient();
  const verified = await client.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "email",
  });
  if (verified.error) throw verified.error;
  return client;
}

export async function createTestUser(role: string): Promise<TestUser> {
  const email = testEmail(role);

  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");

  const client = await signInByMagicLink(email);
  return { id: data.user.id, email, client };
}

export async function deleteTestUsers(users: TestUser[]): Promise<void> {
  const admin = adminClient();
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  }
}
