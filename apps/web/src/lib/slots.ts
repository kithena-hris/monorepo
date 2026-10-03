import 'server-only';

import type { ScreenLoad, ScreenQuery } from './people-screens';
import { prepareRemoteSsr } from './remote-code';
import { AREAS, remoteBase, remotePath, type Area } from './remotes';
import type { ShellData, ShellSlot } from './shell-data';
import { loadScreen as loadTimeOffScreen } from './timeoff-screens';

/**
 * What a remote draws in the shell's own chrome (TOF-059): each place its
 * manifest fills (`slots`), with the data it is drawn from and its server
 * build, fetched as the person signed in.
 *
 * The remote says what goes in a place; the shell fetches its data, as for a
 * screen (`docs/build-plan.md`, "Remotes are dumb"), with the area's loader
 * by the export's name. Only an area this company has is in `shell.remotes`,
 * so a company without Time Off draws no clock. Asked by the layout, so after
 * a write, whose answer is the page drawn again, the clock shows the punch.
 */
const LOADERS: Partial<
  Record<Area['name'], (component: string, query: ScreenQuery) => Promise<ScreenLoad>>
> = { timeoff: loadTimeOffScreen };

export async function slotsOf(shell: ShellData): Promise<readonly ShellSlot[]> {
  const wanted = Object.values(AREAS).flatMap((area) => {
    const component = shell.remotes?.[area.name]?.slots?.topBar;
    return component === undefined ? [] : [{ area, component }];
  });
  return Promise.all(
    wanted.map(async ({ area, component }): Promise<ShellSlot> => {
      const [ssr, load] = await Promise.all([
        prepareRemoteSsr(remoteBase(area), area),
        LOADERS[area.name]?.(component, { params: {}, search: {} }) ??
          Promise.resolve<ScreenLoad>({ status: 'none' }),
      ]);
      return {
        area: area.name,
        slot: 'topBar',
        route: {
          entry: `${remotePath(area)}/remoteEntry.js`,
          component,
          ...(ssr === undefined ? {} : { ssr: ssr.ssr, stylesheet: ssr.stylesheet }),
        },
        load,
      };
    }),
  );
}
