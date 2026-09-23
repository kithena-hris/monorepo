import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/*
 * The same screens, built for the shell's server to render (PEO-094).
 *
 * Module Federation has no answer for the Next App Router on the server: its
 * Next plugin supports the Pages Router only and is being wound down. So the
 * remote publishes a second build beside `remoteEntry.js`: one CommonJS file,
 * `ssr/people.cjs`, whose only imports are the three the shell already owns —
 * React, its JSX runtime and Reach — and which the shell evaluates with its
 * own copies of those three, exactly as federation hands them over in the
 * browser. One React on the server, one Reach, and the HTML the browser
 * hydrates is the HTML the same build drew.
 *
 * Its stylesheet, `ssr/people.css`, is what the server links in the page so
 * the first paint is styled; the browser build loads the same rules again
 * with the expose, which is harmless.
 *
 * Built into `dist/ssr` after the browser build, and served from the same
 * place, so a redeploy of the remote changes both at once.
 */
const shell = ['react', 'react/jsx-runtime', 'react-dom', '@reach/ui'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // A library build leaves `process.env.NODE_ENV` in place; fix it, so the
  // file is the production build whatever environment evaluates it.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/ssr',
    emptyOutDir: true,
    target: 'node22',
    cssCodeSplit: false,
    copyPublicDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['cjs'],
      fileName: () => 'people.cjs',
      cssFileName: 'people',
    },
    rollupOptions: {
      external: (id) => shell.some((s) => id === s || id.startsWith(`${s}/`)),
    },
  },
});
