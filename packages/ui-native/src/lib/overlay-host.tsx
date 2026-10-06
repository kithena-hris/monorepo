import { PortalHost } from '@rn-primitives/portal';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { View } from 'react-native-css/components';

/*
 * Where overlays draw.
 *
 * On a device a portal is `@rn-primitives/portal`: a host renders whatever was
 * sent to its name. On the web the primitives are Radix, which portals into a
 * DOM element, `document.body` unless told otherwise; body is outside the view
 * `ReachProvider` puts the `dark` class on, so a menu opened in dark mode would
 * be light. Each host therefore registers its element by name, and an overlay
 * asks for the element of the host it was sent to.
 */
const ROOT = '__reach_root__';
const elements = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();

function register(name: string, element: HTMLElement | null): void {
  if (element) elements.set(name, element);
  else elements.delete(name);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type OverlayHostProps = {
  /**
   * Overlays sent to this name (`portalHost`) draw here, over this host's
   * parent. Leave it unset for the root host, which `ReachProvider` already
   * renders: an app needs a named one only to keep an overlay inside a region.
   */
  name?: string;
};

/**
 * Where overlays draw: over the whole of its parent, which must be positioned.
 *
 * On the web it takes no space while nothing is open (`empty:hidden`). A box
 * over the whole page, even one that lets presses through, is what axe finds
 * when it looks for the colour behind a piece of text, and it then reports the
 * contrast as unknown instead of failing it: the gate would go quiet on every
 * story.
 */
export function OverlayHost({ name }: OverlayHostProps): React.JSX.Element {
  if (Platform.OS !== 'web') return <PortalHost {...(name ? { name } : {})} />;
  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-0 empty:hidden"
      ref={(node: unknown) => {
        register(name ?? ROOT, node as HTMLElement | null);
      }}
    />
  );
}

/**
 * The DOM element a Radix portal should render into, for the host `name`.
 * `undefined` on a device, where `hostName` does the same job.
 */
export function useOverlayContainer(name?: string): HTMLElement | undefined {
  const key = name ?? ROOT;
  return useSyncExternalStore(
    subscribe,
    () => elements.get(key),
    () => undefined,
  );
}
