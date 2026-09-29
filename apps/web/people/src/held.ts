import { useEffect, useRef, useState } from 'react';

/**
 * A choice that narrows what a screen shows (a tab, a filter, a direction),
 * kept by the host when it offers to: in its address bar, so a shared link
 * opens the same view and Back undoes it. Without `onChange` the screen keeps
 * it itself, as it would in a host with no router. `fallback` is the value
 * when the host holds none, or holds one the screen does not recognise.
 */
export function useHeld<T>(
  held: T | null | undefined,
  onChange: ((next: T) => void) | undefined,
  fallback: T,
): readonly [T, (next: T) => void] {
  const [own, setOwn] = useState(fallback);
  return onChange === undefined ? [own, setOwn] : [held ?? fallback, onChange];
}

/** How long typing rests before the address follows it. */
export const TYPING_MS = 300;

/**
 * Search text: the screen's at once, so the field never lags a key, and the
 * host's once typing rests for {@link TYPING_MS}, so the address is not
 * rewritten (or People asked again) on every key. A `held` value that
 * changes by itself (Back, a link) replaces what is typed; the host echoing
 * what was just sent does not, so a slow echo never eats the keys after it.
 */
export function useTyped(
  held: string,
  onCommit: ((text: string) => void) | undefined,
): readonly [string, (text: string) => void] {
  const [text, setText] = useState(held);
  const sent = useRef(held);
  const commit = useRef(onCommit);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    if (held === sent.current) return;
    sent.current = held;
    clearTimeout(timer.current);
    setText(held);
  }, [held]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const type = (next: string): void => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next === sent.current) return;
      sent.current = next;
      commit.current?.(next);
    }, TYPING_MS);
  };
  return [text, type];
}
