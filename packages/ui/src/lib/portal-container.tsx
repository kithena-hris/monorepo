import { createContext, use, type ReactNode } from 'react';

import { useCoarsePointer } from './use-media-query';

/**
 * Where overlays mount.
 *
 * Every menu, popover, dialog and tooltip portals to `document.body` by
 * default, which is right for a page and wrong for a frame inside one: the
 * docs show each story beside a phone-sized copy of itself, and a sheet opened
 * in that copy has to open inside the phone, at the phone's density, rather
 * than across the whole window at the desk's.
 *
 * Read with `use`, not `useContext`, so a portal that only renders while open
 * can ask for it conditionally.
 */
const PortalContainerContext = createContext<HTMLElement | null>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}): React.JSX.Element {
  return <PortalContainerContext value={container}>{children}</PortalContainerContext>;
}

/** The element overlays mount into, or `undefined` for `document.body`. */
export function usePortalContainer(): HTMLElement | undefined {
  return use(PortalContainerContext) ?? undefined;
}

/**
 * Whether overlays here open under a finger: the page's pointer is coarse, or
 * the element they mount into sits in a subtree that declares itself coarse
 * with `data-pointer`, as the docs' phone frame does. Asked of the pointer,
 * never the width: a narrow desk window is still a mouse.
 */
export function useCoarseOverlay(): boolean {
  const container = usePortalContainer();
  const coarse = useCoarsePointer();
  return coarse || container?.closest('[data-pointer="coarse"]') != null;
}
