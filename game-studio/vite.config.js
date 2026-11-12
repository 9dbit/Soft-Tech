import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Permit only the dedicated Studio staging hostname. Keep Vite's host
// checks enabled instead of allowing arbitrary Host headers.
const stagingHosts = ["game-studio-web-staging.up.railway.app"];

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: stagingHosts,
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: stagingHosts,
  },
});
