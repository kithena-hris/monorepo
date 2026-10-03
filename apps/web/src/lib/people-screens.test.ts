import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// People, as each test answers it: by operation name.
const answers = vi.hoisted((): { current: Record<string, unknown> } => ({ current: {} }));
const asked = vi.hoisted((): { name: string; variables: unknown }[] => []);
vi.mock('./people', () => ({
  people: (name: string, variables: unknown) => {
    asked.push({ name, variables });
    const answer = answers.current[name];
    return Promise.resolve(
      answer === undefined
        ? { ok: false, code: 'FORBIDDEN', message: 'No' }
        : typeof answer === 'object' && answer !== null && 'ok' in answer
          ? answer
          : { ok: true, data: answer },
    );
  },
}));
const { loadScreen, withArrived } = await import('./people-screens');

describe('an import’s page, and the run it waits for', () => {
  const going = { id: 'r1', status: 'running' };
  const base = { Home: { hr: true, admin: false }, ImportTemplate: 'given_name' };

  it('reads the run its address names, as People said it', async () => {
    answers.current = { ...base, ImportRun: JSON.stringify(going) };
    asked.length = 0;
    expect(await loadScreen('ImportFlow', { params: {}, search: { run: 'r1' } })).toEqual({
      status: 'ready',
      data: { setUp: true, admin: false, run: going },
    });
    expect(asked).toContainEqual({ name: 'ImportRun', variables: { id: 'r1' } });
    expect(asked.map((a) => a.name)).not.toContain('ActiveImportRun');
  });

  it('says so when there is no such run, or the VM is waking', async () => {
    answers.current = {
      ...base,
      ImportRun: { ok: false, code: 'NOT_FOUND', message: 'There is no such import' },
    };
    expect(await loadScreen('ImportFlow', { params: {}, search: { run: 'r1' } })).toEqual({
      status: 'error',
      message: 'There is no such import',
      code: 'NOT_FOUND',
    });
    answers.current = {
      ...base,
      ImportRun: { ok: false, code: 'UNREACHABLE', message: 'waking' },
    };
    expect(await loadScreen('ImportFlow', { params: {}, search: { run: 'r1' } })).toMatchObject({
      status: 'error',
      unreachable: true,
    });
  });

  it('hands the upload, Import & export and the Directory the run going now, or null', async () => {
    answers.current = { ...base, ActiveImportRun: JSON.stringify(going) };
    expect(await loadScreen('ImportFlow', { params: {}, search: {} })).toMatchObject({
      data: { activeImport: going },
    });
    expect(await loadScreen('ImportExport', { params: {}, search: {} })).toMatchObject({
      data: { activeImport: going },
    });
    // Not this viewer's to see, or none: no run, and Import as it always was.
    answers.current = { ...base };
    expect(await loadScreen('ImportExport', { params: {}, search: {} })).toMatchObject({
      data: { activeImport: null },
    });
  });
});

describe('withArrived', () => {
  it('puts a streamed part that has arrived in place, and leaves one on its way to stream', async () => {
    const arrived = Promise.resolve(null);
    const coming = new Promise(() => undefined);
    const load = await withArrived({
      status: 'ready',
      data: { canImport: true, history: arrived, later: coming },
    });
    expect(load).toEqual({
      status: 'ready',
      data: { canImport: true, history: null, later: coming },
    });
    expect((load as { data: { later: unknown } }).data.later).toBe(coming);
  });

  it('leaves anything else as it is', async () => {
    const error = { status: 'error', message: 'down' } as const;
    expect(await withArrived(error)).toBe(error);
    const list = { status: 'ready', data: [{ key: 'a' }] } as const;
    expect(await withArrived(list)).toBe(list);
  });
});
