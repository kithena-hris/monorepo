'use client';

import { Button } from '@reach/ui';
import Link from 'next/link';
import { useEffect, useRef, useState, type JSX } from 'react';
import { t } from '../lib/i18n';

/** The site header's height and its line: what is under it is not on screen. */
const UNDER_HEADER = '-65px 0px 0px 0px';

/**
 * Once the hero has scrolled away and the rail's Apply now is off screen, the
 * title and the way to apply stay at the top, under the site header; on a
 * phone the way in sits at the thumb instead, until the rail reaches it. One
 * Apply now on screen at a time. Two observers say when; nothing is measured
 * on scroll. Both bars are opaque, so nothing reads through them.
 */
export function StickyTitle({
  title,
  company,
  applyHref,
  thumb,
  watch,
}: {
  readonly title: string;
  readonly company: string;
  readonly applyHref: string | null;
  /** What the phone's bar says beside its Apply now: the pay, else the title. */
  readonly thumb: string;
  /** The id of the ad's own Apply now, in the rail: while it is on screen, neither bar offers one. */
  readonly watch: string;
}): JSX.Element {
  const sentinel = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState(false);
  // Until the rail's button has been seen, assume it is not on screen (a phone opens on the hero).
  const [applyShown, setApplyShown] = useState(false);
  useEffect(() => {
    const node = sentinel.current;
    if (node === null) return;
    const hero = new IntersectionObserver(
      ([entry]) => {
        setPast(entry !== undefined && !entry.isIntersecting && entry.boundingClientRect.top < 65);
      },
      { rootMargin: UNDER_HEADER },
    );
    hero.observe(node);
    const apply = document.getElementById(watch);
    const rail =
      apply === null
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              setApplyShown(entry?.isIntersecting === true);
            },
            { rootMargin: UNDER_HEADER },
          );
    if (apply !== null) rail?.observe(apply);
    return () => {
      hero.disconnect();
      rail?.disconnect();
    };
  }, [watch]);
  const shown = past && !applyShown;
  const thumbShown = applyHref !== null && !applyShown;
  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />
      <div
        aria-hidden={!shown}
        className={`fixed inset-x-0 top-[65px] z-10 border-b border-border bg-canvas transition-[transform,opacity] duration-(--animate-duration-fast) motion-reduce:transition-none ${shown ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'}`}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{title}</span>
            <span className="block truncate text-xs text-fg-muted">{company}</span>
          </span>
          {applyHref === null ? null : (
            // On a phone the thumb's bar has it.
            <Button
              asChild
              variant="primary"
              size="sm"
              tabIndex={shown ? 0 : -1}
              className="max-lg:hidden"
            >
              <Link href={applyHref}>{t('components.sticky-title.apply_now', 'Apply now')}</Link>
            </Button>
          )}
        </div>
      </div>
      {applyHref === null ? null : (
        <div
          aria-hidden={!thumbShown}
          className={`fixed inset-x-0 bottom-0 z-10 border-t border-border bg-canvas p-3 transition-[transform,opacity] duration-(--animate-duration-fast) motion-reduce:transition-none lg:hidden ${thumbShown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'}`}
        >
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{thumb}</span>
            <Button asChild variant="primary" size="md" tabIndex={thumbShown ? 0 : -1}>
              <Link href={applyHref}>{t('components.sticky-title.apply_now', 'Apply now')}</Link>
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
