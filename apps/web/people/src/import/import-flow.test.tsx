import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { ImportFlow, type ImportFlowProps, type ImportStage } from './import-flow';
import { DONE, MAPPING, NEW_FIELDS, PLAN, column } from './import.fixture';

function props(
  load: ImportFlowProps['load'],
  over: Partial<ImportFlowProps> = {},
): ImportFlowProps {
  const ok = () => Promise.resolve({ ok: true as const });
  return {
    load,
    onUpload: vi.fn(ok),
    propose: vi.fn(() => Promise.resolve({ ok: true as const, data: NEW_FIELDS })),
    plan: vi.fn(() => Promise.resolve({ ok: true as const, data: PLAN })),
    run: vi.fn(ok),
    onDownloadBlocked: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
}

const ready = (data: ImportStage) => ({ status: 'ready' as const, data });

/** From the mapping to the new fields, as HR would. */
async function toNewFields(user: ReturnType<typeof fast>) {
  await user.click(screen.getByRole('button', { name: 'Next: new fields' }));
  return screen.findByRole('heading', {
    name: '3 columns aren’t fields yet. Here’s what I’d create.',
  });
}

describe('ImportFlow', () => {
  it('with nothing published, tells HR who is not an administrator who imports first, with no upload', async () => {
    const { container } = render(
      <ImportFlow {...props(ready({ step: 'upload' }), { setup: { href: null } })} />,
    );
    expect(screen.getByText('An administrator imports the first file')).toBeInTheDocument();
    expect(screen.getByText(/approving its plan sets up the employee record/)).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the five steps, and says nothing is written until the plan is approved', () => {
    render(<ImportFlow {...props(ready({ step: 'upload' }))} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Import' })).toBeInTheDocument();
    expect(screen.getByText('Nothing is written until you approve the plan.')).toBeInTheDocument();
    for (const label of ['Upload', 'Map columns', 'New fields', 'Review plan', 'Import'])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it('keeps the header and the stepper mounted from the upload to the end', () => {
    const { rerender } = render(<ImportFlow {...props(ready({ step: 'upload' }))} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Import' });
    const stepper = screen.getByRole('navigation', { name: 'Importing people' });
    rerender(<ImportFlow {...props(ready(MAPPING))} />);
    expect(screen.getByRole('table', { name: 'Columns' })).toBeInTheDocument();
    rerender(<ImportFlow {...props(ready(DONE))} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Import' })).toBe(heading);
    expect(screen.getByRole('navigation', { name: 'Importing people' })).toBe(stepper);
  });

  it('uploads through a FileUploader, with the upload’s own progress', async () => {
    const user = fast();
    let finish: (outcome: { ok: true }) => void = () => undefined;
    const onUpload = vi.fn((_file: File, progress: (percent: number) => void) => {
      progress(40);
      return new Promise<{ ok: true }>((resolve) => {
        finish = resolve;
      });
    });
    const { container } = render(
      <ImportFlow {...props(ready({ step: 'upload' }), { onUpload })} />,
    );
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
    const sheet = new File(['a,b'], 'people.csv', { type: 'text/csv' });
    await user.upload(input, sheet);
    expect(onUpload).toHaveBeenCalledWith(sheet, expect.any(Function));
    expect(
      await screen.findByRole('progressbar', { name: 'Uploading people.csv' }),
    ).toHaveAttribute('aria-valuenow', '40');
    expect(await axeViolations(container)).toEqual([]);
    finish({ ok: true });
  });

  it('says why an upload failed, and offers it again', async () => {
    const user = fast();
    const onUpload = vi
      .fn<ImportFlowProps['onUpload']>()
      .mockResolvedValueOnce({ ok: false, message: 'The file did not arrive; upload it again' })
      .mockResolvedValueOnce({ ok: true });
    const { container } = render(
      <ImportFlow {...props(ready({ step: 'upload' }), { onUpload })} />,
    );
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
    await user.upload(input, new File(['a,b'], 'people.csv', { type: 'text/csv' }));
    expect(await screen.findByText('The file did not arrive; upload it again')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: /Retry people\.csv/ }));
    expect(onUpload).toHaveBeenCalledTimes(2);
  });

  it('refuses a file over 100 MB before uploading a byte of it', async () => {
    const user = fast();
    const onUpload = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <ImportFlow {...props(ready({ step: 'upload' }), { onUpload })} />,
    );
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
    const huge = new File(['a'], 'huge.csv', { type: 'text/csv' });
    Object.defineProperty(huge, 'size', { value: 100 * 1024 * 1024 + 1 });
    await user.upload(input, huge);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('maps the usual names by rule, and waits for a decision on a doubtful column', async () => {
    const user = fast();
    const doubtful: ImportStage = {
      ...MAPPING,
      columns: [
        ...MAPPING.columns.slice(0, 2),
        column({
          index: 2,
          header: 'CC',
          key: 'cost_centre',
          status: 'review',
          source: 'suggested',
          confidence: 0.71,
        }),
      ],
    };
    const plan = vi.fn(() => Promise.resolve({ ok: true as const, data: PLAN }));
    const { container } = render(<ImportFlow {...props(ready(doubtful), { plan })} />);
    expect(screen.getAllByText('Usual name')).toHaveLength(2);
    expect(screen.getByText('0.71, check this')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: review the plan' })).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('combobox', { name: 'CC goes to' }));
    await user.click(await screen.findByRole('option', { name: 'Cost centre' }));
    // Every column placed: straight to the plan, with no new fields.
    await user.click(screen.getByRole('button', { name: 'Next: review the plan' }));
    expect(plan).toHaveBeenCalledWith({ 0: 'given_name', 1: 'work_email', 2: 'cost_centre' }, []);
    expect(
      await screen.findByRole('heading', { name: 'Here’s everything that will happen' }),
    ).toBeInTheDocument();
  });

  it('proposes a field for each new column, holds back special-category data, and says what it read (AI9)', async () => {
    const user = fast();
    const { container } = render(<ImportFlow {...props(ready(MAPPING))} />);
    await toNewFields(user);
    // People's own rules proposed: it says so.
    expect(screen.getByText(/assistant didn’t answer this time/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Create T-shirt size' })).toBeChecked();
    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
    expect(screen.getByText('XS, S, M, L, XL')).toBeInTheDocument();
    expect(screen.getAllByText('17 of 20 rows have a value')).toHaveLength(2);
    const held = screen
      .getByRole('heading', { name: 'Dietary requirements' })
      .closest('section, div[aria-labelledby], [aria-labelledby]');
    expect(held).not.toBeNull();
    expect(
      screen.getByText(/special-category data\. I suggest not importing it/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import anyway' })).toBeInTheDocument();
    expect(screen.getByText('1 (Dietary requirements)')).toBeInTheDocument();
    expect(screen.getByText('These come with setup')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    // Switched off, it is not imported; Accept all puts the ordinary ones back.
    await user.click(screen.getByRole('switch', { name: 'Create T-shirt size' }));
    expect(screen.getByText('2 (T-shirt size, Dietary requirements)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept all 2' }));
    expect(screen.getByRole('switch', { name: 'Create T-shirt size' })).toBeChecked();

    // Edit opens the whole field.
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement);
    expect(screen.getByLabelText('Name')).toHaveValue('T-shirt size');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('asks what happens for the people without a value, suggesting one with its reason (AI10)', async () => {
    const user = fast();
    const plan = vi.fn(() => Promise.resolve({ ok: true as const, data: PLAN }));
    const { container } = render(<ImportFlow {...props(ready(MAPPING), { plan })} />);
    await toNewFields(user);
    await user.click(screen.getByRole('button', { name: 'Next: what about existing people?' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Most people already have a value from the file',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('4 missing')).toHaveLength(2);
    const choices = screen.getByRole('radiogroup', {
      name: 'What happens for the people without T-shirt size',
    });
    expect(within(choices).getByRole('radio', { name: /Leave it empty/ })).toBeChecked();
    expect(within(choices).getByText('Suggested')).toBeInTheDocument();
    expect(
      screen.getByText('Why this suggestion: Nice to have: nobody is chased for it.'),
    ).toBeInTheDocument();
    // Who has no value, by name, then who the file doesn't reach.
    const without = screen.getByRole('table', { name: 'People without T-shirt size' });
    expect(
      within(without)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Name']);
    expect(without).toHaveTextContent('Kevin Malone');
    expect(
      screen.getByText('And 1 person already here, whom the file doesn’t reach.'),
    ).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    await user.click(
      within(choices).getByRole('radio', { name: /Ask the 4 people to fill it in/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Next: review the plan' }));
    await screen.findByRole('heading', { name: 'Here’s everything that will happen' });
    const [, proposals] = plan.mock.calls[0] as unknown as [
      unknown,
      { key: string; include: boolean; forExisting: unknown }[],
    ];
    expect(proposals.find((p) => p.key === 't_shirt_size')?.forExisting).toEqual({ kind: 'ask' });
    expect(proposals.find((p) => p.key === 'dietary_requirements')?.include).toBe(false);
  });

  it('says everything that will happen, and runs it on one approval (AI11)', async () => {
    const user = fast();
    const run = vi.fn(() => Promise.resolve({ ok: true as const }));
    const onDownloadBlocked = vi.fn();
    const { container } = render(
      <ImportFlow {...props(ready(MAPPING), { run, onDownloadBlocked })} />,
    );
    await toNewFields(user);
    await user.click(screen.getByRole('button', { name: 'Next: what about existing people?' }));
    await user.click(await screen.findByRole('button', { name: 'Next: review the plan' }));
    await screen.findByRole('heading', { name: 'Here’s everything that will happen' });
    for (const s of PLAN.steps) expect(screen.getByText(s.title)).toBeInTheDocument();
    expect(
      screen.getByText('Written from your choices. Nothing has happened yet.'),
    ).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    // A manager the file names that is nowhere here: listed, never blocking.
    const left = screen.getByRole('table', { name: 'Left empty for HR' });
    expect(left).toHaveTextContent('nobody in this company or this file is called “Gabe Lewis”');
    // Whose cell it is comes first: the name, then the row and the cell.
    expect(within(left).getAllByRole('columnheader')[0]).toHaveTextContent('Name');
    expect(within(left).getAllByRole('row')[1]).toHaveTextContent(/^Pam Beesly14M14/);

    await user.click(screen.getByRole('button', { name: 'See rows' }));
    expect(screen.getByText('D7 — empty')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Skipped rows' })).toHaveTextContent(
      'Toby Flenderson',
    );
    await user.click(screen.getByRole('button', { name: 'Download all 1 as CSV' }));
    expect(onDownloadBlocked).toHaveBeenCalledWith('https://store.test/blocked.csv');

    await user.click(screen.getByRole('button', { name: 'Approve and run' }));
    expect(run).toHaveBeenCalledWith(
      { 0: 'given_name', 1: 'work_email', 2: null, 3: null, 4: null },
      expect.arrayContaining([expect.objectContaining({ key: 't_shirt_size', include: true })]),
      { applyWithoutApproval: false },
    );
  });

  it('says why a run was refused, and lets HR apply sensitive values now (PEO-077)', async () => {
    const user = fast();
    const run = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Another import is running' }),
    );
    const sensitive = {
      ...PLAN,
      review: {
        ...PLAN.review,
        dryRun: {
          ...PLAN.review.dryRun,
          sensitive: { fields: ['Social Security number'], values: 12 },
        },
      },
    };
    const plan = vi.fn(() => Promise.resolve({ ok: true as const, data: sensitive }));
    const noNewColumns: ImportStage = { ...MAPPING, columns: MAPPING.columns.slice(0, 2) };
    render(<ImportFlow {...props(ready(noNewColumns), { run, plan })} />);
    await user.click(screen.getByRole('button', { name: 'Next: review the plan' }));
    await user.click(await screen.findByLabelText('Apply sensitive values without approval'));
    await user.click(screen.getByRole('button', { name: 'Approve and run' }));
    expect(run).toHaveBeenCalledWith({ 0: 'given_name', 1: 'work_email' }, [], {
      applyWithoutApproval: true,
    });
    expect(await screen.findByText('Another import is running')).toBeInTheDocument();
  });

  it('cannot be approved while the plan says why not', async () => {
    const user = fast();
    const plan = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { ...PLAN, blocked: 'The employee fields have 1 unpublished change.' },
      }),
    );
    render(
      <ImportFlow
        {...props(ready({ ...MAPPING, columns: MAPPING.columns.slice(0, 2) }), { plan })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Next: review the plan' }));
    expect(
      await screen.findByText('The employee fields have 1 unpublished change.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and run' })).toBeDisabled();
  });

  it('says what it did and which fields it created, with the way to each (AI12)', async () => {
    const onDone = vi.fn();
    const { container } = render(<ImportFlow {...props(ready(DONE), { onDone })} />);
    expect(
      screen.getByRole('heading', { name: 'Imported 19 people and created 2 fields' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/took 4 s/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Left empty for HR' })).toHaveTextContent(
      'Pam Beesly14M14 — “Gabe Lewis”',
    );
    expect(screen.getByRole('link', { name: 'Edit Laptop serial' })).toHaveAttribute(
      'href',
      '/settings/people/fields?q=Laptop%20serial',
    );
    expect(screen.getAllByText('From import')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Download them' })).toHaveAttribute(
      'href',
      'https://store.test/report.csv',
    );
    expect(await axeViolations(container)).toEqual([]);
    await fast().click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('shows an id or employee number column as Kithena’s to create, with no picker', async () => {
    const withIds = {
      ...MAPPING,
      columns: [
        column({
          index: 90,
          header: 'Person id',
          key: '__person_id',
          status: 'ignored',
          source: 'system',
          reason: 'Kithena creates this',
        }),
        column({
          index: 91,
          header: 'Employee ID',
          key: 'employee_number',
          status: 'ignored',
          source: 'system',
          reason: 'Kithena creates this',
        }),
        ...MAPPING.columns,
      ],
    };
    const { container } = render(<ImportFlow {...props(ready(withIds))} />);
    const table = screen.getByRole('table', { name: 'Columns' });
    expect(within(table).getAllByText('Kithena creates this')).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: 'Person id goes to' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Employee ID goes to' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('keeps its step in the address, and opens the mapping when it no longer holds that step', async () => {
    const user = fast();
    const onStepChange = vi.fn();
    const { rerender } = render(
      <ImportFlow {...props(ready(MAPPING), { step: 'review', onStepChange })} />,
    );
    // A reload: nothing proposed or planned here yet, so the mapping.
    expect(screen.getByRole('table', { name: 'Columns' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next: new fields' }));
    expect(onStepChange).toHaveBeenCalledWith('fields');
    rerender(<ImportFlow {...props(ready(MAPPING), { step: 'fields', onStepChange })} />);
    expect(
      await screen.findByRole('heading', {
        name: '3 columns aren’t fields yet. Here’s what I’d create.',
      }),
    ).toBeInTheDocument();
  });

  it('has loading and error states', async () => {
    const { container, rerender } = render(<ImportFlow {...props({ status: 'loading' })} />);
    expect(screen.getByText('Loading the import')).toBeInTheDocument();
    rerender(<ImportFlow {...props({ status: 'error', message: 'Down' })} />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
