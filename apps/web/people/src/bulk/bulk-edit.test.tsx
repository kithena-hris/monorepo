import { act, render, screen, waitFor, within } from '@testing-library/react';
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

/** A row's line saying where the hire places somebody. */
const placedIn =
  (location: string) =>
  (_: string, element: Element | null): boolean =>
    element?.tagName === 'LI' && new RegExp(`^Work location: .*→ ${location}$`).test(element.textContent);

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

  it('recomputes the preview when a start date changes in it, and hires what was shown', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Preview hire' }));
    const table = await screen.findByRole('table', { name: 'Per person' });
    expect(await axeViolations(container)).toEqual([]);

    await user.click(within(table).getByRole('button', { name: 'Start date for Lena Moreau' }));
    await user.click(await screen.findByRole('button', { name: /30 September|September 30/ }));
    // The preview on screen is no longer what would be hired: not offered until recomputed.
    expect(screen.getByRole('button', { name: 'Hire 2 people' })).toBeDisabled();
    expect(screen.getByText('Updating the preview…')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Hire 2 people' })).toBeEnabled();
    });
    const recomputed = [
      [
        { personId: 'a', hireDate: '2026-09-26' },
        { personId: 'l', hireDate: '2026-09-30' },
      ],
      [{ personId: 'j', hireDate: '2026-09-26' }],
    ];
    expect(onPreviewHire.mock.calls.slice(2).map(([page]) => page)).toEqual(recomputed);

    await user.click(screen.getByRole('button', { name: 'Hire 2 people' }));
    await screen.findByText(/Hired 2 people/);
    expect(onCommitHire.mock.calls.map(([page]) => page)).toEqual(recomputed);
    // What was hired is not edited any more.
    expect(screen.queryByRole('button', { name: /^Start date for/ })).toBeNull();
  });

  it('draws only the latest preview when an older one answers last', async () => {
    const user = fast();
    const slow: ((answer: BulkOutcome) => void)[] = [];
    const onPreviewHire = vi.fn(
      (page: BulkHirePage): Promise<BulkOutcome> =>
        page.some((h) => h.hireDate === '2026-09-30')
          ? Promise.resolve({
              ok: true,
              committed: false,
              rows: page.map((h) => hired(h.personId, h.personId, 'Starting soon')),
            })
          : onPreviewHire.mock.calls.length <= 1
            ? hires(false)(page)
            : new Promise((resolve) => slow.push(resolve)),
    );
    render(
      <BulkEdit
        load={{ status: 'ready', data: { ...state, limit: 3 } }}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
        onPreviewHire={onPreviewHire}
        onCommitHire={hires(true)}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Hire' }));
    await user.click(screen.getByRole('button', { name: 'Preview hire' }));
    const table = await screen.findByRole('table', { name: 'Per person' });
    expect(within(table).getAllByText('Skipped')).toHaveLength(1);

    // A first change is recomputed, and hangs; a second one overtakes it.
    await user.click(within(table).getByRole('button', { name: 'Start date for Adam Reyes' }));
    await user.click(await screen.findByRole('button', { name: /29 September|September 29/ }));
    await waitFor(() => {
      expect(slow).toHaveLength(1);
    });
    await user.click(within(table).getByRole('button', { name: 'Start date for Adam Reyes' }));
    await user.click(await screen.findByRole('button', { name: /30 September|September 30/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Hire 3 people' })).toBeEnabled();
    });
    // The older answer arrives last, and is not drawn over the newer one.
    await act(async () => {
      slow[0]?.({ ok: true, committed: false, rows: [] });
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Hire 3 people' })).toBeEnabled();
    expect(within(table).getAllByText(/→ Starting soon$/)).toHaveLength(3);
  });

  it('places everybody placed nowhere where HR says, changed for one person in the preview', async () => {
    const user = fast();
    const placement = {
      entities: [
        { value: 'es', label: 'Acme Spain' },
        { value: 'de', label: 'Acme GmbH' },
      ],
      locations: [
        { value: 'mad', label: 'Madrid', legalEntityId: 'es' },
        { value: 'ber', label: 'Berlin', legalEntityId: 'de' },
      ],
    };
    const named = { a: 'Adam Reyes', l: 'Lena Moreau', j: 'Joan Bosch' } as Record<string, string>;
    const where = { mad: ['Acme Spain', 'Madrid'], ber: ['Acme GmbH', 'Berlin'] } as Record<
      string,
      [string, string]
    >;
    // Adam is placed already; Lena and Joan are placed nowhere.
    const onPreviewHire = vi.fn(
      (page: BulkHirePage): Promise<BulkOutcome> =>
        Promise.resolve({
          ok: true,
          committed: false,
          rows: page.map(({ personId, locationId }) => {
            const name = named[personId] ?? personId;
            if (personId === 'a') return hired(personId, name, 'Active');
            const at = locationId === undefined ? undefined : where[locationId];
            if (at === undefined) {
              return row(personId, name, {
                outcome: 'refused',
                changes: [],
                refusal: {
                  code: 'PLACEMENT_REQUIRED',
                  message: 'Choose a legal entity and work location first',
                },
              });
            }
            const base = hired(personId, name, 'Active');
            return {
              ...base,
              changes: [
                ...base.changes,
                { key: 'legal_entity_id', label: 'Legal entity', dated: true, before: null, after: at[0] },
                { key: 'location_id', label: 'Work location', dated: true, before: null, after: at[1] },
              ],
            };
          }),
        }),
    );
    const { container } = render(
      <BulkEdit
        load={{ status: 'ready', data: { ...state, limit: 3, placement } }}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
        onPreviewHire={onPreviewHire}
        onCommitHire={hires(true)}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Hire' }));
    await user.click(screen.getByRole('button', { name: 'Preview hire' }));
    const table = await screen.findByRole('table', { name: 'Per person' });
    // Nowhere chosen: those placed nowhere are skipped, and why, with somewhere to choose.
    expect(within(table).getAllByText('Choose a legal entity and work location first')).toHaveLength(2);
    expect(within(table).getByRole('combobox', { name: 'Work location for Lena Moreau' })).toBeInTheDocument();
    expect(within(table).queryByRole('combobox', { name: 'Work location for Adam Reyes' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);

    // One choice for everybody.
    await user.click(screen.getByRole('combobox', { name: 'Work location' }));
    await user.click(screen.getByRole('option', { name: 'Madrid' }));
    await waitFor(() => {
      expect(within(table).getAllByText(placedIn('Madrid'))).toHaveLength(2);
    });
    expect(onPreviewHire.mock.calls.at(-1)?.[0]).toEqual([
      { personId: 'a', hireDate: '2026-09-26', legalEntityId: 'es', locationId: 'mad' },
      { personId: 'l', hireDate: '2026-09-26', legalEntityId: 'es', locationId: 'mad' },
      { personId: 'j', hireDate: '2026-09-26', legalEntityId: 'es', locationId: 'mad' },
    ]);

    // And Lena somewhere else.
    await user.click(within(table).getByRole('combobox', { name: 'Legal entity for Lena Moreau' }));
    await user.click(screen.getByRole('option', { name: 'Acme GmbH' }));
    await user.click(within(table).getByRole('combobox', { name: 'Work location for Lena Moreau' }));
    await user.click(screen.getByRole('option', { name: 'Berlin' }));
    await waitFor(() => {
      expect(within(table).getByText(placedIn('Berlin'))).toBeInTheDocument();
    });
    expect(onPreviewHire.mock.calls.at(-1)?.[0]?.[1]).toEqual({
      personId: 'l',
      hireDate: '2026-09-26',
      legalEntityId: 'de',
      locationId: 'ber',
    });
    expect(screen.getByRole('button', { name: 'Hire 3 people' })).toBeEnabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('offers no hire where the host gives none', () => {
    render(
      <BulkEdit load={{ status: 'ready', data: state }} onPreview={vi.fn()} onCommit={vi.fn()} />,
    );
    expect(screen.queryByRole('tab', { name: 'Hire' })).toBeNull();
  });
});
