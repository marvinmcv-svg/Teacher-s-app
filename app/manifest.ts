import type { MetadataRoute } from "next";

// Installability (service worker + offline queue land in Phase 1 with capture).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tinta",
    short_name: "Tinta",
    description:
      "Corrige el trabajo en papel con retroalimentación sobre la hoja. / Grade paper work with feedback on the page.",
    start_url: "/",
    display: "standalone",
    background_color: "#FBF8F3",
    theme_color: "#FBF8F3",
    lang: "es",
    icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
