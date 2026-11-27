import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AccountMenu } from "./account-menu";
import { MainNav } from "./main-nav";
import { PITCH } from "./pitch";
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
  description: PITCH,
  appleWebApp: { title: "upnext", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0c0b12",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="flex items-center justify-between border-b px-4 py-1 sm:px-6 text-sm">
          <Link href="/" className="flex min-h-11 items-center gap-1.5 font-semibold">
            upnext
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
          </Link>
          {/* Reads the session at request time; the rest of the page stays in the static shell. */}
          <Suspense>
            <AccountMenu />
          </Suspense>
        </header>
        <div className="flex flex-1">
          <Suspense>
            <MainNav />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col pb-24 lg:pb-0">
            <div className="flex flex-1 flex-col">{children}</div>
            {/* INV-007: keep the credits reachable from every page. */}
            <footer className="border-t px-6 py-4 text-sm text-muted-foreground">
              <Link href="/credits" className="inline-flex min-h-11 items-center text-accent-text underline">
                Credits
              </Link>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
