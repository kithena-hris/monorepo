import { PageLayout, TooltipProvider } from '@reach/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import {
  MissingDetails,
  type CompletenessState,
  type GapField,
  type GapRow,
} from './completeness-grid';

/**
 * Missing details at a company's scale, in a real browser: ten thousand gaps,
 * five thousand people loaded, a dozen fields of every kind. What jsdom cannot
 * say is how long the grid takes to open, a cell to answer and a key to land.
 *
 * Every time is from the event to the second frame after it, so the frame it
 * was drawn in has been painted: about 33 ms of it is waiting for frames, the
 * floor a Switch's toggle measures.
 */

const coarse = matchMedia('(pointer: coarse)').matches;
// The budgets are Chromium's on a developer machine, where they are measured.
// WebKit (Safari's engine) gets twice the room, and a small machine (a CI
// runner's 2 to 4 cores) three times: the same flow, still failing on a real
// regression, never on a slower harness alone.
const webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
const room = (webkit ? 2 : 1) * (navigator.hardwareConcurrency <= 4 ? 3 : 1);

const many = (n: number, word: string) =>
  Array.from({ length: n }, (_, i) => ({
    value: `${word}${String(i)}`,
    label: `${word} ${String(i)}`,
  }));

const FIELDS: GapField[] = [
  {
    key: 'cost_centre',
    label: 'Cost centre',
    dataType: 'select',
    options: many(12, 'CC'),
    person: false,
  },
  {
    key: 'nationality',
    label: 'Nationality',
    dataType: 'country',
    options: many(249, 'Country'),
    person: false,
  },
  {
    key: 'home_zone',
    label: 'Time zone',
    dataType: 'time_zone',
    options: many(420, 'Zone'),
    person: false,
  },
  { key: 'contract_end', label: 'Contract end', dataType: 'date', options: [], person: false },
  {
    key: 'equipment',
    label: 'Equipment',
    dataType: 'multi_select',
    options: many(8, 'Kit'),
    person: false,
  },
  { key: 'remote', label: 'Remote', dataType: 'boolean', options: [], person: false },
  {
    key: 'allowance',
    label: 'Allowance',
    dataType: 'money',
    currency: 'EUR',
    options: [],
    person: false,
  },
  { key: 'work_phone', label: 'Work phone', dataType: 'phone', options: [], person: false },
  { key: 'desk', label: 'Desk', dataType: 'text', options: [], person: false },
  { key: 'es_nif', label: 'NIF', dataType: 'national_id', options: [], person: false },
  { key: 'manager', label: 'Manager', dataType: 'person_ref', options: [], person: true },
  { key: 'notes', label: 'Notes', dataType: 'long_text', options: [], person: false },
];

const row = (i: number): GapRow => ({
  personId: `p${String(i)}`,
  name: `Person ${String(i)}`,
  department: 'Engineering',
  manager: null,
  missing: FIELDS.map((f) => f.key),
  owner: 'hr',
  remindedAt: null,
});

const STATE: CompletenessState = {
  since: 'Since version 4',
  waiting: { people: 0, lastReminded: null, due: 0 },
  completedThisWeek: 0,
  toFill: 10_000,
  listed: 5_000,
  blocking: null,
  fields: FIELDS,
  rows: Array.from({ length: 5_000 }, (_, i) => row(i)),
  next: 'p4999',
};

const frame = () => (
  <TooltipProvider>
    <PageLayout>
      <MissingDetails
        state={STATE}
        onSave={vi.fn(() => Promise.resolve({ ok: true as const }))}
        onLoadMore={() => new Promise(() => undefined)}
      />
    </PageLayout>
  </TooltipProvider>
);

/** Two frames: what was rendered has been laid out and painted. */
const painted = () =>
  new Promise<void>((done) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        done();
      });
    });
  });

/** A mouse's press, as the events arrive, without the driver's own round trip. */
const press = (target: HTMLElement) => {
  act(() => {
    fireEvent.pointerDown(target, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseDown(target, { button: 0 });
    fireEvent.pointerUp(target, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseUp(target, { button: 0 });
    fireEvent.click(target, { button: 0 });
  });
};

/** From a press to what it opens, painted; then closed again. */
const opening = async (target: HTMLElement, shown: () => Promise<unknown>): Promise<number> => {
  const at = performance.now();
  press(target);
  await shown();
  await painted();
  const took = performance.now() - at;
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => {
    expect(
      document.querySelector('[role="listbox"], [data-radix-popper-content-wrapper]'),
    ).toBeNull();
  });
  await painted();
  return took;
};

const option = (name: string) => () => screen.findByRole('option', { name });
const calendar = () =>
  vi.waitFor(() => {
    expect(document.querySelector('[data-radix-popper-content-wrapper] button')).not.toBeNull();
  });

describe.skipIf(coarse)('Missing details at ten thousand gaps', () => {
  it('opens the grid over everybody at once, a cell answers at once, and keys keep up', async () => {
    render(frame());
    await painted();
    const open = performance.now();
    press(screen.getByRole('button', { name: 'Fill in for all' }));
    await painted();
    const grid = performance.now() - open;
    expect(screen.getByRole('heading', { name: 'Fill in for HR' })).toBeInTheDocument();

    const toggle = await opening(screen.getByRole('switch', { name: 'Remote for Person 0' }), () =>
      Promise.resolve(),
    );
    const list = await opening(
      screen.getByRole('textbox', { name: 'Cost centre for Person 0' }),
      option('CC 0'),
    );
    const countries = await opening(
      screen.getByRole('textbox', { name: 'Nationality for Person 1' }),
      option('Country 0'),
    );
    const zones = await opening(
      screen.getByRole('textbox', { name: 'Time zone for Person 1' }),
      option('Zone 0'),
    );
    const date = await opening(
      screen.getByRole('textbox', { name: 'Contract end for Person 1' }),
      calendar,
    );

    // A keystroke in a line: from the key to the next frame, at its worst of ten.
    const desk = screen.getByRole('textbox', { name: 'Desk for Person 3' });
    let key = 0;
    for (let i = 1; i <= 10; i += 1) {
      const at = performance.now();
      act(() => {
        fireEvent.change(desk, { target: { value: 'A'.repeat(i) } });
      });
      await new Promise<void>((done) => {
        requestAnimationFrame(() => {
          done();
        });
      });
      key = Math.max(key, performance.now() - at);
    }

    const said = `grid ${grid.toFixed(0)}, toggle ${toggle.toFixed(0)}, list ${list.toFixed(0)}, countries ${countries.toFixed(0)}, zones ${zones.toFixed(0)}, date ${date.toFixed(0)}, key ${key.toFixed(0)} ms`;
    expect({ said, grid: grid < 300 * room }).toEqual({ said, grid: true });
    expect({ said, cells: Math.max(list, countries, zones, date) < 150 * room }).toEqual({
      said,
      cells: true,
    });
    expect({ said, key: key < 50 * room }).toEqual({ said, key: true });
  });

  it('opens one person’s dialog at once, and its fields answer at once', async () => {
    render(frame());
    await painted();
    const open = performance.now();
    press(screen.getAllByRole('button', { name: 'Fill in Person 0' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Fill in for Person 0' });
    await painted();
    const opened = performance.now() - open;

    const list = await opening(
      within(dialog).getByRole('combobox', { name: 'Cost centre' }),
      option('CC 0'),
    );
    const countries = await opening(
      within(dialog).getByRole('button', { name: 'Nationality' }),
      option('Country 0'),
    );
    const said = `dialog ${opened.toFixed(0)}, list ${list.toFixed(0)}, countries ${countries.toFixed(0)} ms`;
    expect({ said, dialog: opened < 300 * room }).toEqual({ said, dialog: true });
    expect({ said, cells: Math.max(list, countries) < 150 * room }).toEqual({ said, cells: true });
  });
});
