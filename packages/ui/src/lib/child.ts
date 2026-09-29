import { use, type ReactNode } from 'react';

const LAZY = Symbol.for('react.lazy');

interface Lazy {
  readonly $$typeof: symbol;
  readonly _payload: PromiseLike<ReactNode>;
}

function isLazy(node: ReactNode): node is ReactNode & Lazy {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as Partial<Lazy>).$$typeof === LAZY &&
    typeof (node as Partial<Lazy>)._payload?.then === 'function'
  );
}

/**
 * The `asChild` element, as it will render.
 *
 * A server component passing `<a>` to one of these arrives, while the server
 * renders the HTML, as a lazy reference rather than an element, and in the
 * browser as the element itself. Asked `isValidElement` directly, the two
 * disagree: the server draws the row without its link and the browser with
 * it, hydration fails, and React throws the page away and draws it again —
 * `<html>` included, taking the theme class the inline script set with it.
 * Resolved first, both see the element. Radix's `Slot` does the same.
 */
export function resolveChild(children: ReactNode): ReactNode {
  return isLazy(children) ? use(children._payload) : children;
}
