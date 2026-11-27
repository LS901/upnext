import Link from "next/link";
import { PITCH } from "@/app/pitch";
import { buttonVariants } from "@/components/ui/button";

const POINTS = [
  { name: "Up next", text: "Keep everything you want to get to in one place, in the order you'll get to it." },
  { name: "Progress", text: "See what you're on, season by season, and what you've finished." },
];

/** What a signed-out visitor sees at `/`. It reads no data and calls no provider. */
export function Landing() {
  return (
    <div className="flex flex-1 flex-col justify-center">
      <h1 className="text-4xl font-semibold tracking-tight">upnext</h1>
      <p className="mt-4 text-lg text-muted-foreground">{PITCH}</p>
      <ul className="mt-8 flex flex-col gap-4">
        {POINTS.map((point) => (
          <li key={point.name} className="rounded-lg border border-border bg-card p-4">
            <strong className="font-semibold">{point.name}</strong>
            <span className="text-muted-foreground"> · {point.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <Link href="/login" className={buttonVariants()}>
          Sign in
        </Link>
      </div>
    </div>
  );
}
