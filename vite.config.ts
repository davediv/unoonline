import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

/**
 * `npm run dev` runs the client and the Worker together: the Cloudflare
 * plugin runs `worker/index.ts` inside workerd, with a real local Durable
 * Object, behind the same origin as the Vite dev server. `/ws` and `/api/*`
 * therefore behave in development exactly as they do in production, and the
 * client still hot-reloads.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
});
