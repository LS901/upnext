import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "upnext",
    short_name: "upnext",
    description: "Track the movies, shows and games you're on, what's next, and what you've finished.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0b12",
    theme_color: "#0c0b12",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
