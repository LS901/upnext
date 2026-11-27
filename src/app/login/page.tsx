import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { sendSignInEmail, verifyCode } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  code: "That code didn't work. Check it, or request a new one.",
  link: "That sign-in link has expired or was already used. Request a new one.",
  send: "We couldn't send the email. Try again in a minute.",
};

const input =
  "mt-1 block h-11 w-full rounded-md border border-border bg-secondary px-3 text-foreground placeholder:text-muted-foreground lg:h-10";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <Card className="mt-6">
        <CardContent className="gap-8">
          {/* Reads searchParams, so it renders at request time. */}
          <Suspense>
            <SignInForms searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
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
    <>
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
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
        <Button type="submit">Email me a sign-in link</Button>
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
          <Button type="submit">Sign in with code</Button>
        </form>
      )}
    </>
  );
}
