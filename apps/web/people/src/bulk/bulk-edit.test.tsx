import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import {
  BulkEdit,
  type BulkEditPage,
  type BulkEditState,
  type BulkHirePage,
  type BulkOutcome,
  type BulkRow,
} from './bulk-edit';

const state: BulkEditState = {
  people: [
    { id: 'a', name: 'Adam Reyes' },
    { id: 'l', name: 'Lena Moreau' },
    { id: 'j', name: 'Joan Bosch' },
  ],
  sections: [
    {
      key: 'hr',
      label: 'HR',
      visibility: ['hr'],
      fields: [
        {
          key: 'job_title',
          label: 'Job title',
          description: null,
          dataType: 'text',
          options: [],
          required: false,
          readOnly: false,
        },
        {
          key: 'desk',
          label: 'Desk',
          description: null,
          dataType: 'text',
          options: [],
          required: false,
          readOnly: false,
        },
      ],
    },
  ],
  today: '2026-09-26',
  // Two a request, so three people are two requests.
  limit: 2,
};

const row = (personId: string, name: string, over: Partial<BulkRow> = {}): BulkRow => ({
  personId,
  name,
  outcome: 'changed',
  changes: [
    { key: 'job_title', label: 'Job title', dated: true, before: 'Engineer', after: 'Staff engineer' },
  ],
  refusal: null,
  findings: [],
  ...over,
});

const answer = (committed: boolean) =>
  vi.fn(
    (page: BulkEditPage): Promise<BulkOutcome> =>
      Promise.resolve({
        ok: true,
        committed,
        rows: page.personIds.map((id) =>
          id === 'j'
            ? row(id, 'Joan Bosch', {
                outcome: 'refused',
                changes: [],
                refusal: { code: 'FIELD_NOT_WRITABLE', message: 'Not yours to change: job_title' },
              })
            : row(id, id === 'a' ? 'Adam Reyes' : 'Lena Moreau'),
        ),
      }),
  );

describe('BulkEdit', () => {
  it('previews per person, a page at a time, before anything is applied', async () => {
    const user = fast();
    const onPreview = answer(false);
    const onCommit = answer(true);
    const { container } = render(
      <BulkEdit load={{ status: 'ready', data: state }} onPreview={onPreview} onCommit={onCommit} />,
    );
    expect(screen.getByRole('heading', { name: 'Edit 3 people' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Job title' }), 'Staff engineer');
    await user.click(screen.getByRole('button', { name: 'Preview changes' }));

    await screen.findByText('Nothing is saved yet');
    expect(onPreview.mock.calls.map(([page]) => page.personIds)).toEqual([['a', 'l'], ['j']]);
    expect(onPreview).toHaveBeenCalledWith({
      personIds: ['a', 'l'],
      values: { job_title: 'Staff engineer' },
      effectiveFrom: '2026-09-26',
    });
    expect(onCommit).not.toHaveBeenCalled();
    const table = screen.getByRole('table', { name: 'Per person' });
    expect(within(table).getByText('Not yours to change: job_title')).toBeInTheDocument();
    expect(within(table).getAllByText('Job title: Engineer → Staff engineer')).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Apply to 2 people' }));
    await screen.findByText(/Saved for 2 people\. 1 refused/);
    expect(onCommit.mock.calls.map(([page]) => page.personIds)).toEqual([['a', 'l'], ['j']]);
  });

  it('sets the preview aside when a value or the date changes, so what is applied is what was shown', async () => {
    const user = fast();
    render(
      <BulkEdit
        load={{ status: 'ready', data: state }}
        onPreview={answer(false)}
        onCommit={answer(true)}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Job title' }), 'Staff');
    await user.click(screen.getByRole('button', { name: 'Preview changes' }));
    await screen.findByRole('button', { name: 'Apply to 2 people' });
    await user.type(screen.getByRole('textbox', { name: 'Job title' }), ' engineer');
    expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeInTheDocument();
  });

  it('says what failed, and how far it got', async () => {
    const user = fast();
    const onPreview = vi
      .fn<(page: BulkEditPage) => Promise<BulkOutcome>>()
      .mockResolvedValueOnce({ ok: true, committed: false, rows: [row('a', 'Adam Reyes')] })
      .mockResolvedValueOnce({ ok: false, message: 'People could not be reached' });
    render(
      <BulkEdit load={{ status: 'ready', data: state }} onPreview={onPreview} onCommit={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Preview changes' }));
    await waitFor(() => {
      expect(
        screen.getByText(
          'People could not be reached. Stopped after 1 of 3 people; the rest were not done.',
        ),
      ).toBeInTheDocument();
    });
  });
});

describe('BulkEdit: hire', () => {
  const hired = (personId: string, name: string, status: string): BulkRow =>
    row(personId, name, {
      changes: [
        { key: 'hire_date', label: 'Start date', dated: true, before: null, after: '2026-09-26' },
        { key: 'status', label: 'Status', dated: true, before: 'Not started', after: status },
      ],
    });
  const hires = (committed: boolean) =>
    vi.fn(
      (page: BulkHirePage): Promise<BulkOutcome> =>
        Promise.resolve({
          ok: true,
          committed,
          rows: page.map(({ personId }) =>
            personId === 'j'
              ? row(personId, 'Joan Bosch', {
                  outcome: 'refused',
                  changes: [],
                  refusal: {
                    code: 'INVALID_TRANSITION',
                    message: 'Already employed; there is nobody to hire',
                  },
                })
              : hired(personId, personId === 'a' ? 'Adam Reyes' : 'Lena Moreau', 'Active'),
          ),
        }),
    );

  it('previews who is hired and who is skipped and why, then hires, reporting partial success', async () => {
    const user = fast();
    const onPreviewHire = hires(false);
    const onCommitHire = hires(true);
    const { container } = render(
      <BulkEdit
        load={{ status: 'ready', data: state }}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
        onPreviewHire={onPreviewHire}
        onCommitHire={onCommitHire}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Hire' }));
    expect(screen.getByRole('heading', { name: 'Hire 3 people' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Preview hire' }));

    await screen.findByText('Nobody is hired yet');
    expect(onPreviewHire.mock.calls.map(([page]) => page)).toEqual([
      [
        { personId: 'a', hireDate: '2026-09-26' },
        { personId: 'l', hireDate: '2026-09-26' },
      ],
      [{ personId: 'j', hireDate: '2026-09-26' }],
    ]);
    const table = screen.getByRole('table', { name: 'Per person' });
    expect(within(table).getByText('Already employed; there is nobody to hire')).toBeInTheDocument();
    expect(within(table).getAllByText('Skipped')).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Hire 2 people' }));
    await screen.findByText(/Hired 2 people\. 1 skipped/);
    expect(onCommitHire).toHaveBeenCalledTimes(2);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('takes a start date per person when asked', async () => {
    const user = fast();
    const onPreviewHire = hires(false);
    render(
      <BulkEdit
        load={{ status: 'ready', data: state }}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
        onPreviewHire={onPreviewHire}
        onCommitHire={hires(true)}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Hire' }));
    await user.click(screen.getByRole('checkbox', { name: 'Set a start date per person' }));
    const each = screen.getByRole('list', { name: 'Start date per person' });
    await user.click(within(each).getByRole('button', { name: /Lena Moreau/ }));
    await user.click(await screen.findByRole('button', { name: /30 September|September 30/ }));
    await user.click(screen.getByRole('button', { name: 'Preview hire' }));
    await screen.findByText('Nobody is hired yet');
    expect(onPreviewHire.mock.calls[0]?.[0]).toEqual([
      { personId: 'a', hireDate: '2026-09-26' },
      { personId: 'l', hireDate: '2026-09-30' },
    ]);
  });

  it('offers no hire where the host gives none', () => {
    render(
      <BulkEdit load={{ status: 'ready', data: state }} onPreview={vi.fn()} onCommit={vi.fn()} />,
    );
    expect(screen.queryByRole('tab', { name: 'Hire' })).toBeNull();
  });
});
