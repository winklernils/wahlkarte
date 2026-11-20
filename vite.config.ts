import { defineConfig } from "vite";

// GitHub Pages serves the site from /<repo-name>/
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/wahlkarte/" : "/",
  build: { chunkSizeWarningLimit: 1200 },
}));
