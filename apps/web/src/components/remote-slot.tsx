'use client';

import type { JSX } from 'react';

import * as timeOffActions from '../app/(app)/time-off/actions';
import { AREAS } from '../lib/remotes';
import type { ShellSlot } from '../lib/shell-data';
import { RemoteScreen } from './remote-screen';

/**
 * Each area's props for what it draws in the shell's chrome: the data the
 * layout fetched and the actions that call the area, as `timeoff-screen.tsx`
 * hands a screen its own. The one place the shell knows a slot's prop names.
 */
const PROPS: Partial<Record<ShellSlot['area'], (slot: ShellSlot) => Record<string, unknown>>> = {
  timeoff: (slot) => ({
    load: slot.load.status === 'none' ? { status: 'loading' } : slot.load,
    onPunch: timeOffActions.punch,
  }),
};

/**
 * A place in the shell's chrome a remote fills (TOF-059): rendered on the
 * server with the layout and hydrated in a root of its own beside the page's
 * screen, so a tick of the clock redraws the clock and nothing else. A remote
 * that is down leaves the place empty.
 */
export function RemoteSlot({ slot }: { readonly slot: ShellSlot }): JSX.Element | null {
  const area = AREAS[slot.area];
  return (
    <RemoteScreen
      name={area.name}
      area={area.label}
      slot={slot.slot}
      route={slot.route}
      props={PROPS[slot.area]?.(slot) ?? {}}
    />
  );
}
