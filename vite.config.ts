import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { BASE_URL } from './shared/base.ts';

/**
 * `npm run dev` runs the client and the Worker together: the Cloudflare
 * plugin runs `worker/index.ts` inside workerd, with a real local Durable
 * Object, behind the same origin as the Vite dev server. `/ws` and `/api/*`
 * therefore behave in development exactly as they do in production, and the
 * client still hot-reloads.
 *
 * `base` is what makes the built HTML ask for /uno/assets/... instead of
 * /assets/..., which on parebaik.com would be someone else's Worker. Dev runs
 * under the same prefix, so http://localhost:5173/uno/ is the dev address.
 */
export default defineConfig({
  base: BASE_URL,
  plugins: [react(), tailwindcss(), cloudflare()],
});
