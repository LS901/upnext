import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AccountMenu } from "./account-menu";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "upnext", template: "%s · upnext" },
  description: "Track the movies, shows and games you're on, what's next, and what you've finished.",
  appleWebApp: { title: "upnext", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 text-sm dark:border-white/10">
          <Link href="/" className="font-semibold">
            upnext
          </Link>
          {/* Reads the session at request time; the rest of the page stays in the static shell. */}
          <Suspense>
            <AccountMenu />
          </Suspense>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
        {/* INV-007: keep the credits reachable from every page. */}
        <footer className="border-t border-black/10 px-6 py-4 text-sm text-zinc-500 dark:border-white/10">
          <Link href="/credits" className="underline">
            Credits
          </Link>
        </footer>
      </body>
    </html>
  );
}
