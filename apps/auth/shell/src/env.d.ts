/**
 * Side-effect imports of stylesheets.
 *
 * `@reach/ui/styles.css` is imported for what it does, not for what it
 * exports, and TypeScript refuses an import with no type. Declared here rather
 * than reached for through a framework's ambient types, so it is visible why a
 * `.css` import type-checks.
 */
declare module '*.css';
