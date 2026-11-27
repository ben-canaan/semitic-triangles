import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// SINGLE_FILE=1 bundles everything (dictionary included) into one script,
// for embedding the game as a single page.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // FUNCTIONS_URL=http://127.0.0.1:9999 lets the dev server reach `netlify functions:serve`.
  server: process.env.FUNCTIONS_URL ? { proxy: { "/.netlify/functions": process.env.FUNCTIONS_URL } } : undefined,
  build: {
    rollupOptions: { output: { inlineDynamicImports: process.env.SINGLE_FILE === "1" } },
  },
});
