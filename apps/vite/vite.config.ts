import mercuryViewportPlugin from './client/mercury-viewport-plugin'
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

// Pre-bundle deps at startup so Vite doesn't re-run esbuild mid-session when
// the agent writes code that imports a new lib — the re-optimize bumps the
// deps hash and 404s chunks the iframe just loaded → white screen.
//
// `entries` tells Vite's scanner to also crawl @vibe/ui's source tree during
// startup, so every Radix/clsx/etc. import inside the workspace package gets
// discovered and pre-bundled before the iframe ever mounts.
//
// `include` only lists deps that live in apps/vite/node_modules (direct deps
// of apps/vite/package.json). Workspace sub-deps (clsx, radix-*, vaul, cmdk,
// react-hook-form, etc.) are reached via the @vibe/ui entries crawl above.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), mercuryViewportPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
    },
  },
  optimizeDeps: {
    entries: [
      "index.html",
      "client/**/*.{ts,tsx}",
      "../../packages/ui/src/**/*.{ts,tsx}",
    ],
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react-router-dom",
      "@tanstack/react-query",
      "framer-motion",
      "lucide-react",
      "next-themes",
      "sonner",
      "zod",
    ],
  },
  server: {
    allowedHosts: true,
    port: 5173,
    hmr: {
      overlay: false,
    },
  },
})
