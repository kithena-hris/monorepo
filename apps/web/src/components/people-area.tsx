import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { homeToDo } from './inbox/format';
import { PeopleScreen } from './people-screen';
import { Waking, WakingHeader } from './waking';
import type { InboxPeek } from '../lib/inbox/peek';
import {
  homeLeave,
  type HomeAway,
  type HomeLeave,
  type OverviewAnswer,
} from '../lib/home-time-off';
import { homeAwayIn } from '../lib/home-time-off-read';
import { accessToken, timeOff } from '../lib/people';
import { loadScreen, today } from '../lib/people-screens';
import { prepareRemoteSsr } from '../lib/remote-code';
import {
  AREAS,
  currentPlace,
  firstUnder,
  headerFrame,
  placesFor,
  remoteBase,
  remotePath,
  siblingsOf,
} from '../lib/remotes';
import { remoteNav, remoteRoute } from '../lib/remote-manifest';
import { shellData, warmShell } from '../lib/shell';
import { currentPerson } from '../lib/session';
import { withQuery } from '../lib/url-state';
import { serverWords } from '../lib/server-words';

/**
 * A People screen inside the shell: under `/people`, or among People's
 * settings under `/settings/people`.
 *
 * The shell does what only the shell may: reads the session, asks the remote's
 * manifest which screen owns the path, fetches that screen's data from People
 * as the person signed in (PEO-098), and hands the screen its header: the
 * breadcrumb, tabs and actions from the same manifest, cut to this person's
 * roles. The sidebar around it is the `(app)` layout's, drawn once.
 * The screen itself comes from wherever the remote is deployed — its server
 * build for the HTML, its browser build to hydrate (PEO-094) — so shipping a
 * change to it never rebuilds this app.
 *
 * `area` is where the screen sits in the host's navigation: among People's
 * sections, or on the Settings page, whose trail is Settings › People.
 */
export async function PeopleArea({
  path,
  search,
  area,
}: {
  readonly path: string;
  readonly search: Readonly<Record<string, string>>;
  readonly area: 'people' | 'settings';
}): Promise<JSX.Element> {
  const t = await serverWords();
  // All at once: which screen the path is does not depend on who asks, the
  // token is minted (or found) while identity checks the session, and the
  // reads the page is drawn from go with that check rather than after it —
  // `people.ts` withholds every answer until identity has confirmed the
  // session, and a page that turns out not to be drawn drops them unread.
  const routed = remoteRoute(path);
  warmShell();
  // A section's bare path also fits `/people/:id`; it is the section, not a
  // person called `review`, whatever this viewer may open under it. Bare
  // `/people` is the first section: People's overview is Home's now.
  const isBare = (r: NonNullable<Awaited<typeof routed>>): boolean =>
    Object.keys(r.params).length > 0 && firstUnder(r.nav.sections, path) !== undefined;
  const drawn = routed.then((r) => (r === undefined || (r !== null && isBare(r)) ? undefined : r));
  const loading = drawn.then((r) =>
    r == null
      ? ({ status: 'none' } as const)
      : loadScreen(r.component, { params: r.params, search, path }),
  );
  const preparing = drawn.then((r) => (r == null ? undefined : prepareRemoteSsr(r.base, r.area)));
  const [person, route] = await Promise.all([currentPerson(), routed, accessToken()]);
  if (person === null) redirect('/login');
  // A company that did not buy People has no People screens (PEO-114).
  if (!person.entitlements.includes('module.people')) notFound();

  const bare = route != null && isBare(route);
  if (route === undefined || bare) {
    // A section's bare path (`/people/review`) is the first of its tabs
    // this person opens, query and all; anything else nobody answers is a 404.
    const to =
      area === 'people'
        ? firstUnder((await shellData(person.entitlements)).sections, path)
        : undefined;
    if (to === undefined) notFound();
    const query = new URLSearchParams(search).toString();
    redirect(query === '' ? to : `${to}?${query}`);
  }

  // Server rendering: a build whose signed manifest verifies, rendered in a
  // process of its own (`lib/remote-code.ts`, PEO-115). `PEOPLE_REMOTE_SSR=off`
  // is still the switch.
  const [load, ssr, shell] = await Promise.all([
    loading,
    preparing,
    // Which of People's places this person's roles open, the counts and the
    // notices, for the shell around the screen.
    shellData(person.entitlements),
  ]);
  const roles = shell.roles;

  // Nothing published yet: the administrator who can publish it is taken to
  // the wizard that does (design screen 2), rather than left on a screen
  // with nothing to show. Anybody else is told, on the screen they asked for.
  if (
    load.status === 'error' &&
    load.code === 'SCHEMA_NOT_PUBLISHED' &&
    roles.admin &&
    route?.component !== 'PeopleSetup' &&
    route?.component !== 'PeopleSettings'
  ) {
    redirect('/people/setup');
  }
  const places =
    route === null ? { sections: [], actions: [], settings: [] } : placesFor(route.nav, roles);
  const here = route?.path ?? null;

  const header = headerFrame(places, here, '/people', {
    sections: shell.counts,
    tabs: shell.tabCounts,
  });
  // Every Insights tab reads the same segment, so moving between them keeps it.
  const segment = search['segment'];
  const frame =
    area === 'people'
      ? here === '/people/import' && header.section !== null
        ? // A step inside Import & export: People › Import & export › Import.
          {
            ...header,
            trail: [
              { href: '/people', label: t('components.people-area.people', 'People') },
              { href: '/people/import-export', label: header.section },
            ],
            section: t('components.people-area.import', 'Import'),
            // As drawn (imH), the last crumb switches between Import & export's two ways.
            siblings: [
              {
                label: header.section,
                items: [
                  {
                    href: '/people/import',
                    label: t('components.people-area.import', 'Import'),
                    current: true,
                    icon: 'upload',
                  },
                  {
                    href: '/people/export',
                    label: t('components.people-area.export', 'Export'),
                    current: false,
                    icon: 'download',
                  },
                ],
              },
            ],
            siblingsLabel: header.section,
          }
        : here?.startsWith('/people/insights/') === true &&
            segment !== undefined &&
            segment !== '' &&
            header.tabs !== undefined
          ? {
              ...header,
              tabs: header.tabs.map((t) => ({
                ...t,
                href: withQuery(t.href, {}, { segment }),
              })),
            }
          : header
      : {
          // The settings overview is "Settings › People"; a setting is
          // "Settings › People › Roles". No actions: nobody adds an employee
          // from a settings page.
          section:
            here === '/settings/people'
              ? t('components.people-area.people', 'People')
              : (currentPlace(places.settings, here)?.label ?? null),
          trail:
            here === '/settings/people'
              ? [{ href: '/settings', label: t('components.people-area.settings', 'Settings') }]
              : [
                  { href: '/settings', label: t('components.people-area.settings', 'Settings') },
                  { href: '/settings', label: t('components.people-area.people', 'People') },
                ],
          actions: [],
          // The breadcrumb's last crumb lists the other settings.
          siblings:
            here === '/settings/people'
              ? []
              : siblingsOf(
                  places.settings.map((p) => ({
                    ...p,
                    group: t('components.people-area.people_settings', 'People settings'),
                  })),
                  currentPlace(places.settings, here),
                ),
          siblingsLabel: t('components.people-area.people_settings', 'People settings'),
        };

  // People is asleep or still waking: the page's header, and in place of its
  // body a state that asks again by itself (`components/waking.tsx`).
  const waking = load.status === 'error' && load.unreachable === true;
  return (
    <Waking
      area={t('components.people-area.people', 'People')}
      waking={waking}
      header={
        <WakingHeader
          frame={frame}
          title={
            area === 'people'
              ? t('components.people-area.people', 'People')
              : t('components.people-area.settings', 'Settings')
          }
        />
      }
    >
      {waking ? null : (
        // The screen, whose own header carries the breadcrumb (on a phone, the
        // title that switches section) and what this person may start from here.
        <div className="flex flex-col gap-6">
          <div className="min-w-0">
            <PeopleScreen
              route={
                route === null
                  ? null
                  : {
                      entry: route.entry,
                      component: route.component,
                      ...(ssr === undefined ? {} : { ssr: ssr.ssr, stylesheet: ssr.stylesheet }),
                    }
              }
              load={load}
              path={path}
              params={route?.params ?? {}}
              search={search}
              today={today()}
              frame={
                load.status === 'ready' && load.notice !== undefined
                  ? { ...frame, notice: load.notice }
                  : frame
              }
            />
          </div>
        </div>
      )}
    </Waking>
  );
}

/**
 * Home, as People draws it (design B1, B2): People's overview folded into
 * the app's front page. The remote names the export that fills Home
 * (`slots.home` in its manifest); the shell fetches its data as the person
 * signed in, as for any screen, and renders it on the server. `null` when
 * People offers no Home or cannot say which: the shell's own Home stands.
 */
/**
 * Time Off's part of Home: the team's next three weeks and the reader's own
 * balances and requests, read as them. What Time Off refuses or cannot
 * answer is left out, not an error on Home.
 */
async function homeTimeOff(): Promise<{ away?: HomeAway; leave?: HomeLeave }> {
  const day = today();
  const overview = timeOff<OverviewAnswer>('TimeOffOverview');
  const me = overview.then((o) => (o.ok ? (o.data.member?.personId ?? null) : null));
  const [away, read] = await Promise.all([homeAwayIn('team', me), overview]);
  return {
    ...(away === null ? {} : { away }),
    // An account that is not a member has no time off of its own.
    ...(read.ok && read.data.member !== null ? { leave: homeLeave(read.data, day) } : {}),
  };
}

export async function PeopleHome(
  inbox?: Promise<InboxPeek>,
  greeting?: string,
  /** The company has Time Off: Home shows who is away and their own time off. */
  withTimeOff = false,
): Promise<JSX.Element | null> {
  const t = await serverWords();
  const area = AREAS.people;
  const nav = await remoteNav(area);
  const component = nav?.slots.home;
  if (component === undefined) return null;
  // Home's To do is the Inbox's (B1) and who is away is Time Off's: both are
  // asked for now and not waited for. Home is sent as soon as People's own
  // data is here, and each of them fills its widget when its service answers.
  // With its rows, the tasks themselves as the Inbox read them: Home's modal
  // opens one from what is held, without reading the Inbox again.
  const toDoLater = inbox?.then((peek) => ({
    toDo: homeToDo(peek),
    held: { items: peek.todo, now: peek.now, zone: peek.zone },
  }));
  const timeLater: Promise<{ away?: HomeAway; leave?: HomeLeave }> | undefined = withTimeOff
    ? homeTimeOff().catch(() => ({}))
    : undefined;
  // A read nobody waited for must not fail the request it outlives.
  toDoLater?.catch(() => undefined);
  const [load, ssr] = await Promise.all([
    loadScreen(component, { params: {}, search: {} }),
    prepareRemoteSsr(remoteBase(area), area),
  ]);
  // People is asleep or still waking: Home asks again by itself.
  const waking = load.status === 'error' && load.unreachable === true;
  return (
    <Waking area={t('components.people-area.people', 'People')} waking={waking}>
      {waking ? null : (
        <PeopleScreen
          route={{
            entry: `${remotePath(area)}/remoteEntry.js`,
            component,
            ...(ssr === undefined ? {} : { ssr: ssr.ssr, stylesheet: ssr.stylesheet }),
          }}
          load={load}
          path="/"
          params={{}}
          search={{}}
          today={today()}
          {...(toDoLater === undefined ? {} : { toDoLater })}
          {...(greeting === undefined ? {} : { greeting })}
          {...(timeLater === undefined ? {} : { timeLater })}
        />
      )}
    </Waking>
  );
}

/** The query string as a flat record: repeated keys and arrays are dropped. */
export async function flatSearch(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(await searchParams).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
}
