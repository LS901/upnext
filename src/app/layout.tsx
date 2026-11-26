import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
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
