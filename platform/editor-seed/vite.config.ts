/**
 * Editor UI dev server. Lives inside video-engine because it imports the
 * Remotion composition from ../src directly (preview == render, always).
 * Run from the repo root: `npm run ui`. Deps live in the ROOT package.json
 * on purpose: one node_modules means exactly one React/Remotion instance
 * shared by the Player and the composition code.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const uiRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: uiRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@engine": resolve(uiRoot, "..", "src") },
    dedupe: ["react", "react-dom", "remotion", "@remotion/player", "@remotion/transitions", "zod"],
  },
  server: {
    port: 5173,
    fs: { allow: [resolve(uiRoot, "..")] },
  },
});
