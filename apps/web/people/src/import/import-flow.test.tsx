import { render, screen, waitFor, within } from '@testing-library/react';
import type { JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { ImportModal, type ImportFlowProps, type ImportStage } from './import-flow';
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

/** The import as the page opens it: a modal, over whatever was there. */
function Open(flow: ImportFlowProps): JSX.Element {
  return <ImportModal flow={flow} onClose={vi.fn()} />;
}

/** The review, once it has worked out what will happen. */
async function reviewed(): Promise<void> {
  await screen.findByRole('heading', { name: 'Here’s everything that will happen' });
}

describe('ImportFlow', () => {
  it('with nothing published, tells HR who is not an administrator who imports first, with no upload', async () => {
    render(<Open {...props(ready({ step: 'upload' }), { setup: { href: null } })} />);
    const dialog = screen.getByRole('dialog', { name: 'Import people' });
    expect(within(dialog).getByText('An administrator imports the first file')).toBeInTheDocument();
    expect(within(dialog).getByText(/importing it sets up the employee record/)).toBeInTheDocument();
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('opens as a modal, and says nothing is written until you import', () => {
    render(<Open {...props(ready({ step: 'upload' }))} />);
    expect(screen.getByRole('dialog', { name: 'Import people' })).toBeInTheDocument();
    expect(
      screen.getByText('CSV or Excel. Nothing is written until you import.'),
    ).toBeInTheDocument();
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
    const { baseElement: container } = render(
      <Open {...props(ready({ step: 'upload' }), { onUpload })} />,
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
    const { baseElement: container } = render(
      <Open {...props(ready({ step: 'upload' }), { onUpload })} />,
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
    const { baseElement: container } = render(
      <Open {...props(ready({ step: 'upload' }), { onUpload })} />,
    );
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
    const huge = new File(['a'], 'huge.csv', { type: 'text/csv' });
    Object.defineProperty(huge, 'size', { value: 100 * 1024 * 1024 + 1 });
    await user.upload(input, huge);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('reviews everything on one screen: the plan, the columns and the new fields (AI9, AI11)', async () => {
    const user = fast();
    const plan = vi.fn(() => Promise.resolve({ ok: true as const, data: PLAN }));
    render(<Open {...props(ready(MAPPING), { plan })} />);
    await reviewed();
    for (const s of PLAN.steps) expect(screen.getByText(s.title)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Columns' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '3 columns aren’t fields yet. Here’s what I’d create.' }),
    ).toBeInTheDocument();
    // People's own rules proposed: it says so.
    expect(screen.getByText(/assistant didn’t answer this time/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Create T-shirt size' })).toBeChecked();
    expect(
      screen.getByText(/special-category data\. I suggest not importing it/),
    ).toBeInTheDocument();
    // A manager the file names that is nowhere here: listed, never blocking.
    expect(screen.getByRole('table', { name: 'Left empty for HR' })).toHaveTextContent(
      'nobody in this company or this file is called “Gabe Lewis”',
    );
    expect(await axeViolations(document.body)).toEqual([]);

    // The people without a value, chosen where the field is: the plan follows.
    await user.click(
      screen.getByRole('combobox', { name: 'What happens for the people without T-shirt size' }),
    );
    await user.click(await screen.findByRole('option', { name: 'Ask them' }));
    await waitFor(() => {
      expect(plan).toHaveBeenCalledTimes(2);
    });
    const [, proposals] = plan.mock.calls[1] as unknown as [
      unknown,
      { key: string; include: boolean; forExisting: unknown }[],
    ];
    expect(proposals.find((p) => p.key === 't_shirt_size')?.forExisting).toEqual({ kind: 'ask' });
    expect(proposals.find((p) => p.key === 'dietary_requirements')?.include).toBe(false);

    // Edit opens the whole field.
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement);
    expect(screen.getByLabelText('Name')).toHaveValue('T-shirt size');
  });

  it('works the plan out again when a column changes, and waits for a doubtful one', async () => {
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
    render(<Open {...props(ready(doubtful), { plan })} />);
    await reviewed();
    expect(screen.getAllByText('Usual name')).toHaveLength(2);
    expect(screen.getByText('0.71, check this')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Import/ })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'CC goes to' }));
    await user.click(await screen.findByRole('option', { name: 'Cost centre' }));
    await waitFor(() => {
      expect(plan).toHaveBeenLastCalledWith(
        { 0: 'given_name', 1: 'work_email', 2: 'cost_centre' },
        [],
      );
    });
    expect(await screen.findByRole('button', { name: 'Import 19 people' })).toBeEnabled();
  });

  it('imports on one press, says why a run was refused, and lets HR apply sensitive values now (PEO-077)', async () => {
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
    render(<Open {...props(ready(noNewColumns), { run, plan })} />);
    await user.click(await screen.findByLabelText('Apply sensitive values without approval'));
    await user.click(screen.getByRole('button', { name: 'Import 19 people' }));
    expect(run).toHaveBeenCalledWith({ 0: 'given_name', 1: 'work_email' }, [], {
      applyWithoutApproval: true,
    });
    expect(await screen.findByText('Another import is running')).toBeInTheDocument();
  });

  it('cannot import while the plan says why not', async () => {
    const plan = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { ...PLAN, blocked: 'The employee fields have 1 unpublished change.' },
      }),
    );
    render(
      <Open {...props(ready({ ...MAPPING, columns: MAPPING.columns.slice(0, 2) }), { plan })} />,
    );
    expect(
      await screen.findByText('The employee fields have 1 unpublished change.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 19 people' })).toBeDisabled();
  });

  it('goes back to choose another file', async () => {
    const onBack = vi.fn();
    render(<Open {...props(ready(MAPPING), { onBack })} />);
    await reviewed();
    await fast().click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('says what it did and which fields it created, with the way to each (AI12)', async () => {
    const onDone = vi.fn();
    const { baseElement: container } = render(<Open {...props(ready(DONE), { onDone })} />);
    expect(
      screen.getByRole('heading', { name: 'Imported 19 people and created 2 fields' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/took 4 s/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Left empty for HR' })).toHaveTextContent(
      'M14 — “Gabe Lewis”',
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

  it('has loading and error states', async () => {
    const { rerender } = render(<Open {...props({ status: 'loading' })} />);
    expect(screen.getByText('Loading the import')).toBeInTheDocument();
    rerender(<Open {...props({ status: 'error', message: 'Down' })} />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
