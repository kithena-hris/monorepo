import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// No alias for `@reach/ui`: the workspace link plus its `exports` map already
// resolve both the package and its stylesheet. The design system ships
// TypeScript source, so Vite compiles it here the same way it does in an app.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
