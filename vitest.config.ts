import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // jsdom, so component tests can live next to the pure-logic ones. The suite
    // used to be node-only, which silently made any .tsx test unrunnable.
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test-setup.ts",
        // React entrypoint: it only mounts <App />.
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/locales/**",
      ],
    },
  },
});
