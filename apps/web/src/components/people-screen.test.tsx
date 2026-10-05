// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The host's half of "the filters are in the address": what each screen is
 * handed from the address, and what each of its callbacks does to it. The
 * screen itself is a remote; here it is a stand-in that keeps its props.
 */

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
// Server actions: only the import's are called, each as a test says.
const imports = vi.hoisted(() => ({
  startImportUpload: vi.fn(),
  completeImportUpload: vi.fn(),
  runImport: vi.fn(),
  importRun: vi.fn(),
}));
vi.mock('../app/(app)/people/actions', () => ({
  ...imports,
  decidePendingChange: vi.fn(),
  transferHistoryPage: vi.fn(),
  decidedPage: vi.fn(),
  mergesPage: vi.fn(),
  queuePage: vi.fn(),
  screenPage: vi.fn(),
  withdrawPendingChange: vi.fn(),
  approveAlone: vi.fn(),
  markNotUnusual: vi.fn(),
  askAboutChange: vi.fn(),
  answerApprovalQuestion: vi.fn(),
  setApprovalCheck: vi.fn(),
  reviewIdentifier: vi.fn(),
  revealIdentifier: vi.fn(),
  mergePerson: vi.fn(),
  dismissDuplicate: vi.fn(),
  unmergePerson: vi.fn(),
  requestFullValues: vi.fn(),
  decideFullValues: vi.fn(),
  decideExportShare: vi.fn(),
  saveGrid: vi.fn(),
  checkGrid: vi.fn(),
  completenessPage: vi.fn(),
  searchPeople: vi.fn(),
  remindWaiting: vi.fn(),
  requestDetails: vi.fn(),
  saveSegment: vi.fn(),
  directoryPage: vi.fn(),
}));
// The shell around the page: its data is what the page is remembered under.
const shell = vi.hoisted(() => ({
  current: {
    roles: { hr: true, admin: false, finance: false },
    routes: [
      '/people/insights/headcount',
      '/people/insights/turnover',
      '/people/insights/what-changed',
    ],
    screens: {
      '/people/insights/headcount': 'ReportRuns',
      '/people/insights/turnover': 'ReportRuns',
      '/people/insights/what-changed': 'PeopleSettings',
    },
  },
}));
vi.mock('./app-shell', () => ({ useShellData: () => shell.current }));
let shown: Record<string, unknown> = {};
vi.mock('./remote-screen', () => ({
  RemoteScreen: ({ props }: { props: Record<string, unknown> }) => {
    shown = props;
    return null;
  },
}));

const { PeopleScreen } = await import('./people-screen');

/** The screen at `url`, and the props it was handed. */
function open(url: string, component: string, data: unknown = {}): Record<string, unknown> {
  window.history.replaceState(null, '', url);
  render(
    <PeopleScreen
      route={{ entry: 'x', component }}
      load={{ status: 'ready', data }}
      path={window.location.pathname}
      params={{}}
      search={Object.fromEntries(new URLSearchParams(window.location.search))}
      today="2026-09-29"
    />,
  );
  return shown;
}

const call = (props: Record<string, unknown>, name: string, ...args: unknown[]): void => {
  (props[name] as (...a: unknown[]) => void)(...args);
};
const here = (): string => window.location.pathname + window.location.search;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('a screen that narrows what it already has', () => {
  it('hands Review its tab from the route, and its chip and item from the address', () => {
    const props = open('/people/review/flagged?kind=changes&item=change-c1', 'Review');
    expect([props['tab'], props['kind'], props['item']]).toEqual([
      'flagged',
      'changes',
      'change-c1',
    ]);
  });

  it('notes a chosen chip and item in the address as new entries, without asking the server', () => {
    const props = open('/people/review/waiting', 'Review');
    const before = window.history.length;
    call(props, 'onKindChange', 'ids');
    expect(here()).toBe('/people/review/waiting?kind=ids');
    call(props, 'onItemChange', 'change-c2');
    expect(here()).toBe('/people/review/waiting?kind=ids&item=change-c2');
    expect(window.history.length).toBe(before + 2);
    expect(router.push).not.toHaveBeenCalled();
    call(props, 'onFillChange', 'p1');
    expect(here()).toBe('/people/review/waiting?kind=ids&item=change-c2&fill=p1');
  });

  it('asks the server for a pair to compare, which People reads side by side', () => {
    const props = open('/people/review/waiting?kind=duplicates', 'Review');
    call(props, 'onItemChange', 'dup-p1~p2');
    expect(router.push).toHaveBeenCalledWith(
      '/people/review/waiting?kind=duplicates&item=dup-p1%7Ep2',
      { scroll: false },
    );
  });

  it('rewrites the entry while a search is typed, and leaves an empty one out', () => {
    const props = open('/people/import-export?kind=export', 'ImportExport');
    expect(props['kind']).toBe('export');
    const before = window.history.length;
    call(props, 'onSearchChange', 'payroll');
    expect(here()).toBe('/people/import-export?kind=export&q=payroll');
    call(props, 'onSearchChange', '  ');
    expect(here()).toBe('/people/import-export?kind=export');
    expect(window.history.length).toBe(before);
  });

  it('keeps the import’s step and field in the address, each step a new entry', () => {
    const props = open('/people/import', 'ImportFlow');
    expect(props['step']).toBeNull();
    expect((props['load'] as { data: { step: string } }).data.step).toBe('upload');
    const before = window.history.length;
    call(props, 'onStepChange', 'existing');
    expect(here()).toBe('/people/import?step=existing');
    call(props, 'onFieldChange', 't_shirt_size');
    expect(here()).toBe('/people/import?step=existing&field=t_shirt_size');
    call(props, 'onStepChange', 'review');
    expect(here()).toBe('/people/import?step=review');
    expect(window.history.length).toBe(before + 2);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('lets the administrator of a company with nothing published import its first file', () => {
    // Approving that import's plan is what sets the company up.
    expect(open('/people/import', 'ImportFlow', { setUp: false, admin: true })['setup']).toBe(
      undefined,
    );
    cleanup();
    // Anybody else is told the first file is an administrator's.
    expect(open('/people/import', 'ImportFlow', { setUp: false, admin: false })['setup']).toEqual({
      href: null,
    });
    cleanup();
    expect(open('/people/import', 'ImportFlow', { setUp: true, admin: false })['setup']).toBe(
      undefined,
    );
  });

  it('leaves a default out of the address', () => {
    const props = open('/people/directory/org-chart?layout=horizontal&focus=p1', 'OrgChart');
    expect(props['layout']).toBe('horizontal');
    expect(props['focusId']).toBe('p1');
    call(props, 'onLayoutChange', 'vertical');
    call(props, 'onFocusChange', null);
    expect(here()).toBe('/people/directory/org-chart');
  });
});

describe('the directory, which People answers from the address', () => {
  it('hands the screen what the address asks for', () => {
    const props = open(
      '/people/directory/list?q=ada&filter=department:sales&sort=name:desc&group=department&incomplete=true',
      'Directory',
    );
    expect(props).toMatchObject({
      search: 'ada',
      filters: { department: 'sales' },
      group: 'department',
      incomplete: true,
      view: 'list',
    });
  });

  it('pushes a new order, back to the first page, and replaces while typing', () => {
    const props = open('/people/directory/list?q=ada&after=c2', 'Directory');
    call(props, 'onSortChange', { key: 'hire_date', direction: 'desc' });
    expect(router.push).toHaveBeenCalledWith('/people/directory/list?q=ada&sort=hire_date%3Adesc', {
      scroll: false,
    });
    call(props, 'onSearchChange', 'adam');
    expect(router.replace).toHaveBeenCalledWith('/people/directory/list?q=adam', {
      scroll: false,
    });
  });

  it('keeps the search and filters across views, but not the org chart’s own', () => {
    const props = open(
      '/people/directory/org-chart?q=ada&conditions=%5B%5D&focus=p1&layout=horizontal&after=c',
      'OrgChart',
    );
    call(props, 'onViewChange', 'cards');
    expect(router.push).toHaveBeenCalledWith('/people/directory/cards?q=ada&conditions=%5B%5D', {
      scroll: false,
    });
  });
});

describe('an approved import, which runs on without the page', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    status: 'running',
    label: 'Importing',
    phase: 'people',
    step: 'Adding people',
    people: { done: 312, total: 1000 },
    fileName: 'meridian-people.xlsx',
    startedBy: { name: 'Ada Lovelace', you: false },
    approvedAt: '2026-10-01T14:02:00.000Z',
    startedAt: '2026-10-01T14:02:03.000Z',
    finishedAt: null,
    now: '2026-10-01T14:06:15.000Z',
    result: null,
    failure: null,
    ...over,
  });
  const done = run({
    status: 'succeeded',
    label: 'Imported',
    people: { done: 1000, total: 1000 },
    result: {
      file: { name: 'meridian-people.xlsx', rows: 1000 },
      created: 1000,
      updated: 0,
      blocked: 0,
    },
  });
  const stage = (props: Record<string, unknown>) =>
    (props['load'] as { data: Record<string, unknown> }).data;
  const tick = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is approved, and the page moves to its own address, following it', async () => {
    vi.useFakeTimers();
    // The file goes straight to storage: a stand-in that takes it.
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        status = 200;
        upload = {};
        onload: () => void = () => undefined;
        open(): void {}
        setRequestHeader(): void {}
        send(): void {
          this.onload();
        }
      },
    );
    imports.startImportUpload.mockResolvedValue({
      ok: true,
      uploadId: 'u1',
      url: 'https://store.test/u1',
      method: 'PUT',
      headers: {},
    });
    imports.completeImportUpload.mockResolvedValue({
      ok: true,
      stage: { step: 'map', file: { name: 'meridian-people.xlsx', rows: 1000, sheet: null } },
    });
    imports.runImport.mockResolvedValue({ ok: true, runId: 'r9' });
    imports.importRun.mockResolvedValue({ ok: true, data: { ...done, id: 'r9' } });
    let props = open('/people/import', 'ImportFlow', { setUp: true, admin: true });
    await act(async () => {
      await (props['onUpload'] as (f: File, p: () => void) => Promise<unknown>)(
        new File(['a'], 'meridian-people.xlsx'),
        () => undefined,
      );
    });
    props = shown;
    await act(async () => {
      expect(
        await (props['run'] as (...a: unknown[]) => Promise<unknown>)({ 0: 'given_name' }, [], {
          basedOn: 4,
        }),
      ).toEqual({ ok: true });
    });
    expect(imports.runImport).toHaveBeenCalledWith(
      'u1',
      { 0: 'given_name' },
      [],
      true,
      undefined,
      4,
    );
    // The plan is replaced: Back never offers a run that has happened.
    expect(here()).toBe('/people/import?run=r9');
    expect(stage(shown)).toMatchObject({
      step: 'run',
      run: { id: 'r9', status: 'queued', label: 'Importing', fileName: 'meridian-people.xlsx' },
    });
    expect(imports.importRun).not.toHaveBeenCalled();
    await tick(2_000);
    expect(imports.importRun).toHaveBeenCalledWith('r9');
    expect(stage(shown)).toMatchObject({ step: 'run', run: { status: 'succeeded' } });
    // Over: the page, the history and the bell are read again; nothing more is asked.
    expect(router.refresh).toHaveBeenCalled();
    await tick(10_000);
    expect(imports.importRun).toHaveBeenCalledOnce();
  });

  it('opens at its address as the server read it, and once over is not asked about again', async () => {
    vi.useFakeTimers();
    const props = open('/people/import?run=r1', 'ImportFlow', { setUp: true, run: done });
    expect(stage(props)).toMatchObject({ step: 'run', run: { id: 'r1', status: 'succeeded' } });
    await tick(10_000);
    expect(imports.importRun).not.toHaveBeenCalled();
  });

  it('is asked about every two seconds while it runs, and keeps its last count while the VM wakes', async () => {
    vi.useFakeTimers();
    imports.importRun
      .mockResolvedValueOnce({ ok: true, data: run({ people: { done: 400, total: 1000 } }) })
      .mockResolvedValueOnce({ ok: false, message: 'Kithena is waking up', waking: true })
      .mockResolvedValueOnce({ ok: true, data: run({ people: { done: 500, total: 1000 } }) });
    open('/people/import?run=r1', 'ImportFlow', { setUp: true, run: run() });
    expect(stage(shown)).toMatchObject({ run: { people: { done: 312 } }, waking: false });
    await tick(2_000);
    expect(stage(shown)).toMatchObject({ run: { people: { done: 400 } }, waking: false });
    await tick(2_000);
    // Waking is not an error: the count stays, and it is asked again by itself.
    expect(stage(shown)).toMatchObject({ run: { people: { done: 400 } }, waking: true });
    await tick(2_000);
    expect(stage(shown)).toMatchObject({ run: { people: { done: 500 } }, waking: false });
    expect(imports.importRun).toHaveBeenCalledTimes(3);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('keeps Import waiting on Import & export, the Directory and the upload while it runs', () => {
    expect(
      open('/people/import-export', 'ImportExport', { activeImport: run() })['running'],
    ).toMatchObject({ id: 'r1' });
    cleanup();
    expect(
      open('/people/directory/list', 'Directory', { can: { import: true }, activeImport: run() })[
        'running'
      ],
    ).toMatchObject({ id: 'r1' });
    cleanup();
    expect(
      open('/people/import', 'ImportFlow', { setUp: true, activeImport: run() })['running'],
    ).toMatchObject({ id: 'r1' });
    cleanup();
    expect(
      open('/people/import-export', 'ImportExport', { activeImport: null })['running'],
    ).toBeNull();
  });
});
