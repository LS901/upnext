import type { Metadata } from "next";
import { Suspense } from "react";
import { sendSignInEmail, verifyCode } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  code: "That code didn't work. Check it, or request a new one.",
  link: "That sign-in link has expired or was already used. Request a new one.",
  send: "We couldn't send the email. Try again in a minute.",
};

const input =
  "mt-1 block w-full rounded-md border border-black/20 bg-transparent px-3 py-2 dark:border-white/20";
const button =
  "rounded-md bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      {/* Reads searchParams, so it renders at request time. */}
      <Suspense>
        <SignInForms searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function SignInForms({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const sent = firstValue(params.sent);
  const error = ERRORS[firstValue(params.error) ?? ""];

  return (
    <div className="mt-8 flex flex-col gap-8">
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      <form action={sendSignInEmail} className="flex flex-col gap-4">
        <label className="block">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={sent}
            className={input}
          />
        </label>
        <button type="submit" className={button}>
          Email me a sign-in link
        </button>
      </form>

      {sent !== undefined && (
        <form action={verifyCode} className="flex flex-col gap-4">
          <p>Check your email. Open the link, or enter the 6-digit code here.</p>
          <input type="hidden" name="email" value={sent} />
          <label className="block">
            Code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              className={input}
            />
          </label>
          <button type="submit" className={button}>
            Sign in with code
          </button>
        </form>
      )}
    </div>
  );
}
