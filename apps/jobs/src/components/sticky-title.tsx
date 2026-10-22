'use client';

import { Button } from '@reach/ui';
import Link from 'next/link';
import { useEffect, useRef, useState, type JSX } from 'react';

/**
 * Once the hero scrolls away, the title and the way to apply stay at the
 * top, under the site header, so a long ad never loses either. A sentinel
 * at the hero's foot says when; nothing is measured on scroll.
 */
export function StickyTitle({
  title,
  company,
  applyHref,
}: {
  readonly title: string;
  readonly company: string;
  readonly applyHref: string | null;
}): JSX.Element {
  const sentinel = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = sentinel.current;
    if (node === null) return;
    const watcher = new IntersectionObserver(([entry]) => {
      setShown(entry !== undefined && !entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    watcher.observe(node);
    return () => {
      watcher.disconnect();
    };
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />
      <div
        aria-hidden={!shown}
        className={`fixed inset-x-0 top-16 z-10 border-b border-border bg-canvas/95 backdrop-blur transition-[transform,opacity] duration-(--animate-duration-fast) motion-reduce:transition-none ${shown ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'}`}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{title}</span>
            <span className="block truncate text-xs text-fg-muted">{company}</span>
          </span>
          {applyHref === null ? null : (
            <Button asChild variant="primary" size="sm" tabIndex={shown ? 0 : -1}>
              <Link href={applyHref}>Apply now</Link>
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
