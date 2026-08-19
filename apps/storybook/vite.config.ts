import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * `@reach/ui` ships TypeScript source rather than build output, so Vite compiles
 * it as part of this app. That is the point: no watch-and-rebuild step between
 * editing a component and seeing it in the canvas.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
