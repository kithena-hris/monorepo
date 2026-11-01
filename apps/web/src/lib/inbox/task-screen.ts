import 'server-only';

import type { RemoteRoute } from '../../components/remote-screen';
import { loadScreen as loadDocumentsScreen } from '../documents-screens';
import { loadScreen as loadOnboardingScreen } from '../onboarding-screens';
import { loadScreen as loadPerformanceScreen } from '../performance-screens';
import type { ScreenLoad, ScreenQuery } from '../people-screens';
import { loadScreen as loadRecruitingScreen } from '../recruiting-screens';
import { prepareRemoteSsr } from '../remote-code';
import { remoteRoute } from '../remote-manifest';
import { areaOf } from '../remotes';
import { currentPerson } from '../session';
import { remotePlaces } from '../shell';
import { areaFrame } from '../shell-data';

export type TaskScreenArea = 'documents' | 'onboarding' | 'performance' | 'recruiting';

/** The modules whose screens the Inbox can draw in its pane, and how each screen is read. */
const LOADS: Readonly<
  Record<
    TaskScreenArea,
    (component: string, query: ScreenQuery, path: string) => Promise<ScreenLoad>
  >
> = {
  documents: loadDocumentsScreen,
  onboarding: loadOnboardingScreen,
  performance: loadPerformanceScreen,
  recruiting: loadRecruitingScreen,
};

/** A task's own screen, as the Inbox's pane draws it: plain data, as a page would be handed. */
export interface TaskScreen {
  readonly area: TaskScreenArea;
  /** The address it is of, query and all: the pane's links go back to it. */
  readonly link: string;
  readonly path: string;
  readonly route: RemoteRoute;
  readonly load: ScreenLoad;
  readonly frame: ReturnType<typeof areaFrame>;
  readonly params: Readonly<Record<string, string>>;
  readonly search: Readonly<Record<string, string>>;
}

const isTaskArea = (name: string): name is TaskScreenArea => name in LOADS;

/**
 * The screen a task's link names, read as the person signed in, in the same
 * order `RemoteArea` reads a page: the session, the entitlement, the remote's
 * manifest, then the screen's data. Null for anything it cannot draw: another
 * module, a company without it, a remote not answering; the pane then offers
 * the link instead.
 *
 * Its header keeps only the screen's own title: the trail, the sections and
 * the area's actions belong to a page, and the pane is not one.
 */
export async function taskScreen(
  link: string,
  /** With the page: its server build too, so its first HTML has the screen. A pane drawn later needs none. */
  { withServerBuild = false }: { readonly withServerBuild?: boolean } = {},
): Promise<TaskScreen | null> {
  const url = new URL(link, 'http://inbox');
  const path = url.pathname;
  const area = areaOf(path);
  if (area === undefined || !isTaskArea(area.name)) return null;
  const [person, route] = await Promise.all([currentPerson(), remoteRoute(path)]);
  if (person === null || !person.entitlements.includes(area.entitlement) || route == null)
    return null;
  const search = Object.fromEntries(url.searchParams);
  const [load, ssr, places] = await Promise.all([
    LOADS[area.name](route.component, { params: route.params, search }, route.path),
    withServerBuild ? prepareRemoteSsr(route.base, route.area) : Promise.resolve(undefined),
    remotePlaces(person.entitlements),
  ]);
  const frame = areaFrame(area, route.path, places[area.name]);
  return {
    area: area.name,
    link: `${path}${url.search}`,
    path,
    route: {
      entry: route.entry,
      component: route.component,
      ...(ssr === undefined ? {} : { ssr: ssr.ssr, stylesheet: ssr.stylesheet }),
    },
    load,
    frame: {
      section: null,
      siblingsLabel: frame.siblingsLabel,
      siblings: [],
      actions: [],
      trail: [],
    },
    params: route.params,
    search,
  };
}
