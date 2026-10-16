// @ts-check
import { defineConfig } from "astro/config";

import preact from "@astrojs/preact";

// https://astro.build/config
export default defineConfig({
  integrations: [preact()],
  vite: {
    server: {
      proxy: { "/api": "http://localhost:8787" },
    },
  },
});
