/**
 * The one Module Federation runtime on a page: built once from
 * `@module-federation/runtime` by `scripts/build-renderer.mjs` into
 * `public/_mf/<version>/`, and named for every remote by the import map the
 * root layout puts first in `<head>`. The remotes leave the runtime out of
 * their builds and import it by name; the shell loads the same file. One copy
 * (it was one per remote, 19 KB gzipped each), and one runtime instance.
 *
 * The version is the dependency's exact pin in `package.json`; the build fails
 * when the two differ, so a bump cannot serve a runtime the remotes did not
 * build against.
 */
export const MF_RUNTIME_VERSION = '2.9.2';

const base = `/_mf/${MF_RUNTIME_VERSION}`;

/** The runtime's entry, for the shell's own dynamic import. */
export const MF_RUNTIME_URL = `${base}/runtime.mjs`;

/** Each name the remotes import the runtime by, and where it is. */
export const MF_IMPORT_MAP = JSON.stringify({
  imports: {
    '@module-federation/runtime': MF_RUNTIME_URL,
    '@module-federation/runtime/helpers': `${base}/helpers.mjs`,
  },
});
