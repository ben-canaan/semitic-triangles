import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// SINGLE_FILE=1 bundles everything (dictionary included) into one script,
// for embedding the game as a single page.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    rollupOptions: { output: { inlineDynamicImports: process.env.SINGLE_FILE === "1" } },
  },
});
