import { useId, type ReactNode } from 'react';
import { View } from 'react-native-css/components';

import { OverlayHost } from '../lib/overlay-host.tsx';

/**
 * A phone screen with a page on it, for a story whose overlay is open: the
 * design's stage. The overlay draws in this frame's own host (pass the name
 * the render prop receives as `portalHost`), so it covers the frame and not
 * the whole canvas, and the page's first line is the trigger that reopens it.
 */
export function Stage({
  height = 520,
  trigger,
  children,
}: {
  height?: number;
  /** The page's first line. A function receives the host's name, for a control that opens its own overlay. */
  trigger?: ReactNode | ((host: string) => ReactNode);
  children?: (host: string) => ReactNode;
}): React.JSX.Element {
  const host = useId();
  return (
    <View
      className="overflow-hidden rounded-[24px] border border-border bg-canvas"
      style={{ height }}
    >
      <View className="gap-3 p-5">
        {(typeof trigger === 'function' ? trigger(host) : trigger) ?? (
          <View className="h-[18px] w-2/5 rounded-[6px] bg-surface-active" />
        )}
        <View className="h-2.5 w-[70%] rounded-[5px] bg-surface-sunken" />
        <View className="h-20 rounded-[14px] bg-surface" />
        <View className="h-20 rounded-[14px] bg-surface" />
        <View className="h-20 rounded-[14px] bg-surface" />
      </View>
      {children?.(host)}
      {/* Last, so what opens in it draws over anything the story placed on the page. */}
      <OverlayHost name={host} />
    </View>
  );
}

type DomNode = {
  parentElement: DomNode | null;
  querySelectorAll(selectors: string): ArrayLike<DomNode>;
};
type Dom = {
  document: { querySelectorAll(selectors: string): ArrayLike<DomNode> };
  getComputedStyle: (element: DomNode) => { opacity: string };
  requestAnimationFrame: (callback: () => void) => number;
};

/** A view drawn translucent by its classes (a key on a tooltip), not mid-fade. */
function isDimmedOnPurpose(element: DomNode): boolean {
  const name = (element as unknown as { className?: unknown }).className;
  return typeof name === 'string' && /\bopacity-/.test(name);
}

/**
 * A `play` for stories that open a modal: resolves once every open dialog is
 * fully drawn, its own opacity and each ancestor's at 1, or after two seconds.
 * The motion is Reanimated's, driven from JavaScript, so Storybook's wait for
 * CSS animations cannot see it, and axe run mid-fade reads every colour
 * blended with the page behind.
 */
export function settled(): Promise<void> {
  const dom = globalThis as unknown as Partial<Dom>;
  const { document, getComputedStyle, requestAnimationFrame } = dom;
  if (!document || !getComputedStyle || !requestAnimationFrame) return Promise.resolve();
  // The overlay, each ancestor and each descendant: a popover's motion is on
  // a view inside the primitive's content, a dialog's on one around it.
  const opaque = (element: DomNode): boolean => {
    for (let at: DomNode | null = element; at; at = at.parentElement) {
      if (Number(getComputedStyle(at).opacity) < 1) return false;
    }
    return Array.from(element.querySelectorAll('*')).every(
      (inner) => Number(getComputedStyle(inner).opacity) >= 1 || isDimmedOnPurpose(inner),
    );
  };
  const deadline = Date.now() + 2000;
  // One check a frame, each waiting on the last: a poll, not parallel work.
  return new Promise((resolve) => {
    const check = (): void => {
      const open = Array.from(
        document.querySelectorAll(
          // A region too: the assistant's card fades out of the launcher's corner.
          '[role="dialog"], [role="alertdialog"], [role="region"], [data-radix-popper-content-wrapper]',
        ),
      );
      if ((open.length > 0 && open.every(opaque)) || Date.now() >= deadline) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
}
