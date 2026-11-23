'use client';

import { useEffect, useRef, useSyncExternalStore, type JSX, type ReactNode } from 'react';

/**
 * A page of the app drawn inside another of its pages: the Inbox's pane
 * opening a task's own page (`inbox/frame-pane.tsx`). Same origin, its own
 * address, so every screen works there as it does on its page; only the
 * chrome around it (the sidebar, the tab bar, the assistant) is left out.
 *
 * The page tells the one holding it, by message, how tall it is and each
 * time it is drawn again from the server (after a write), so the Inbox can
 * size it and read itself again.
 */
export interface FrameMessage {
  readonly kithena: 'frame';
  readonly kind: 'height' | 'drawn' | 'escape';
  readonly value: number;
}

const subscribeNever = (): (() => void) => () => undefined;

/** Whether this page is inside another: on the server, and while hydrating, it is not. */
export function useFramed(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => window.self !== window.top,
    () => false,
  );
}

/**
 * On the frame element, by a holder that gives the page its whole box (Home's
 * modal): the page then keeps a page's margins, scrolls itself to the box's
 * edge, and says when Escape was pressed in it with nothing of its own to
 * close, so the holder can close.
 */
export const ROOMY = 'data-roomy';

const roomy = (): boolean => window.frameElement?.hasAttribute(ROOMY) === true;

export function Framed({
  drawn,
  children,
}: {
  /** When the server drew the page: a new value is a write's answer. */
  readonly drawn: number;
  readonly children: ReactNode;
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const wide = useSyncExternalStore(subscribeNever, roomy, () => false);
  useEffect(() => {
    post('drawn', drawn);
  }, [drawn]);
  useEffect(() => {
    if (!wide) return;
    // After the page's own layers: a dialog or a menu that took the key has prevented it.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) post('escape', 0);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [wide]);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const observer = new ResizeObserver(() => {
      post('height', Math.ceil(el.getBoundingClientRect().height));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div
      ref={box}
      data-framed=""
      className={wide ? '@container/page p-5 pb-8 touch:p-3' : '@container/page px-1 pt-1 pb-6'}
    >
      {children}
    </div>
  );
}

function post(kind: FrameMessage['kind'], value: number): void {
  const message: FrameMessage = { kithena: 'frame', kind, value };
  window.parent.postMessage(message, window.location.origin);
}
