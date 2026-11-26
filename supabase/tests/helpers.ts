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

export async function createTestUser(role: string): Promise<TestUser> {
  const { url, publishableKey } = inject("supabase");
  const email = `${role}-${randomBytes(4).toString("hex")}@example.test`;
  const password = randomBytes(16).toString("hex");

  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");

  const client = createClient<Database>(url, publishableKey, options);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  return { id: data.user.id, email, client };
}

export async function deleteTestUsers(users: TestUser[]): Promise<void> {
  const admin = adminClient();
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  }
}
