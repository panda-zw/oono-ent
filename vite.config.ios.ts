import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// iPad WKWebView build. Output goes straight into ios/OonoEnt/Web/ so the
// Xcode project picks it up as a resource folder reference; no copy step.
//
// `base: "./"` matters: WKWebView loads index.html via file:// URL when we
// call `webView.loadFileURL(..., allowingReadAccessTo:)`, so all asset URLs
// must be relative.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "./",
  define: {
    __OONO_PLATFORM__: JSON.stringify("web"),
  },
  build: {
    outDir: path.resolve(__dirname, "./ios/OonoEnt/Web"),
    emptyOutDir: true,
    sourcemap: false,
    target: "safari17",
    rollupOptions: {
      output: {
        // The desktop build hits a single 1.4 MB chunk; on iPad we don't
        // need code-splitting either, but a few obvious vendor splits keep
        // initial parse manageable.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          motion: ["framer-motion"],
          media: ["hls.js", "mpegts.js"],
        },
      },
    },
  },
});
