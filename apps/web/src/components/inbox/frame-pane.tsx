'use client';

import { Spinner } from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type JSX } from 'react';

import type { FrameMessage } from '../framed';
import { t } from '../../lib/t';

/** Never shorter than a form's first fields; never taller than most of the window. */
const MIN_HEIGHT = 240;
const MAX_SHARE = 0.8;

const isFrameMessage = (data: unknown): data is FrameMessage =>
  typeof data === 'object' &&
  data !== null &&
  (data as { kithena?: unknown }).kithena === 'frame' &&
  typeof (data as { value?: unknown }).value === 'number';

/**
 * A task's own page, in the pane: the address in a frame of the same app,
 * drawn without its chrome (`framed.tsx`). For the screens that keep their
 * state in the address (People's Review, a person's page, Time Off's
 * request), which cannot be drawn inside another page's address.
 *
 * As tall as the page inside it, up to most of the window, where it scrolls
 * itself: a list there virtualizes against its own window, not against the
 * whole of its length. Hidden until it has drawn; each time it is drawn again
 * from the server after the first (a write), the Inbox is read again too.
 */
export function FramePane({
  link,
  label,
}: {
  readonly link: string;
  /** What the frame is, for a screen reader: "Performance", "People". */
  readonly label: string;
}): JSX.Element {
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const first = useRef<number | null>(null);
  useEffect(() => {
    const listen = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frame.current?.contentWindow || !isFrameMessage(event.data)) return;
      const { kind, value } = event.data;
      if (kind === 'height') {
        setHeight(Math.min(Math.max(value, MIN_HEIGHT), window.innerHeight * MAX_SHARE));
      } else if (first.current === null) {
        first.current = value;
      } else if (value !== first.current) {
        first.current = value;
        router.refresh();
      }
    };
    window.addEventListener('message', listen);
    return () => {
      window.removeEventListener('message', listen);
    };
  }, [router]);
  return (
    <div className="relative" style={{ minHeight: height ?? MIN_HEIGHT }}>
      {height === null ? (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner
            label={t('components.inbox.frame-pane.opening', 'Opening {{label}}', { label })}
          />
        </div>
      ) : null}
      <iframe
        ref={frame}
        src={link}
        title={label}
        className="block w-full rounded-lg border-0 bg-canvas"
        style={{ height: height ?? MIN_HEIGHT, visibility: height === null ? 'hidden' : 'visible' }}
      />
    </div>
  );
}
