import type { MetadataRoute } from "next";
import { lightTokens } from "@/design/tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nurra",
    short_name: "Nurra",
    description: "A gentle daily companion for people who forget their medicines, with updates for the family.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: lightTokens.bg,
    theme_color: lightTokens.primary,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
