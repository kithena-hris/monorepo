import type { JSX, ReactNode } from 'react';

/**
 * The entrance every back-office screen gets.
 *
 * The same element and the same token as `apps/web`'s template, deliberately:
 * an operator with both open should not be able to tell them apart by how a
 * page arrives. See that file for why this is a template rather than a layout,
 * and why the animation is CSS rather than a library.
 *
 * It sits inside the sticky header from `layout.tsx` rather than around it, so
 * the bar stays put while the content under it changes — a chrome that
 * re-entered on every navigation would be the back-office equivalent of a page
 * reload.
 */
export default function Template({ children }: { children: ReactNode }): JSX.Element {
  return <div className="motion-safe:animate-enter">{children}</div>;
}
