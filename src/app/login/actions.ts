"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The same address always means the same account, however it was typed.
function normalisedEmail(formData: FormData): string {
  return String(formData.get("email") ?? "").trim().toLowerCase();
}

function loginUrl(params: Record<string, string>): string {
  return `/login?${new URLSearchParams(params)}`;
}

// Emails a sign-in link and a 6-digit code. Creates the account on first use,
// and says the same thing either way, so nobody learns whether an address is registered.
export async function sendSignInEmail(formData: FormData) {
  const email = normalisedEmail(formData);
  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ??
    `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm`, shouldCreateUser: true },
  });
  if (error) redirect(loginUrl({ error: "send" }));

  redirect(loginUrl({ sent: email }));
}

export async function verifyCode(formData: FormData) {
  const email = normalisedEmail(formData);
  const token = String(formData.get("code") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) redirect(loginUrl({ error: "code", sent: email }));

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
