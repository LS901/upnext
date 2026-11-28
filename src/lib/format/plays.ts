import type { MediaType } from "@/lib/providers/types";

type Version = "print" | "audio" | null;

// `play_count` counts extra plays (0 until played again), so Finished is one
// play and the line reads "{verb} {play_count + 1} times" from 1 up.
function verb(mediaType: MediaType, version: Version): string {
  if (mediaType === "game") return "Played";
  if (mediaType === "book") return version === "audio" ? "Listened" : "Read";
  if (mediaType === "other") return "Done";
  return "Watched";
}

/** The button on a Finished row: "Watched again", "Listened again", and so on. */
export function playAgainLabel(mediaType: MediaType, version: Version): string {
  return `${verb(mediaType, version)} again`;
}

/** "Watched 2 times" once there is an extra play; null before that. */
export function playCountLine(mediaType: MediaType, version: Version, playCount: number): string | null {
  return playCount >= 1 ? `${verb(mediaType, version)} ${playCount + 1} times` : null;
}
