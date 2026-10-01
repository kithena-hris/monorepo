import { TooltipProvider } from '@reach/ui';
import { render as mount, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { WhatChanged, sourceHref, type ExportChoices } from './what-changed';
import { FOR_NORA, SEPTEMBER } from './what-changed.fixture';

const render = (ui: ReactElement) => mount(ui, { wrapper: TooltipProvider });
const ready = { status: 'ready' as const, data: SEPTEMBER };
const choices: ExportChoices = {
  format: 'pdf',
  recipient: 'nora',
  tone: 'short',
  charts: true,
  madeLine: true,
};

describe('What changed (AI5)', () => {
  it('opens Insights with the month in points, each figure People’s and each linked to its records', async () => {
    const { container } = render(<WhatChanged load={ready} onExportingChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'September in three points' })).toBeInTheDocument();
    expect(screen.getByText('Written 08:00')).toBeInTheDocument();
    expect(screen.getByText('September 2026 compared with August')).toBeInTheDocument();
    const points = screen.getByRole('list', { name: 'September in three points' });
    const first = within(points).getAllByRole('listitem')[0];
    if (first === undefined) throw new Error('no point');
    expect(within(first).getByText('+14')).toBeInTheDocument();
    // What People filled in is marked; the words around it are not.
    expect([...first.querySelectorAll('strong')].map((s) => s.textContent)).toEqual([
      '398',
      '412',
      '9',
      '14',
      'Engineering',
    ]);
    expect(within(first).getByRole('link', { name: '14 joiners' })).toHaveAttribute(
      'href',
      sourceHref(SEPTEMBER.points[0]?.sources[0] ?? { kind: 'headcount', label: '' }, null),
    );
    expect(within(first).getByRole('link', { name: 'Engineering' }).getAttribute('href')).toContain(
      encodeURIComponent('"org_unit"'),
    );
    expect(screen.getByText('Finance only')).toBeInTheDocument();
    expect(screen.getByText(/Groups under 10 people are never described/)).toBeInTheDocument();
    expect(screen.getByText(/Worded by Kithena’s own rules/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Headcount' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Leavers by team, 3 months' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('links each source to where its records are', () => {
    expect(
      sourceHref({ kind: 'joiners', label: '', from: '2026-09-01', to: '2026-09-30' }, null),
    ).toBe(
      `/people/directory/list?conditions=${encodeURIComponent(
        JSON.stringify([{ key: 'hire_date', op: 'between', values: ['2026-09-01', '2026-09-30'] }]),
      )}`,
    );
    expect(sourceHref({ kind: 'span', label: '' }, 'seg')).toBe(
      '/people/insights/turnover?segment=seg',
    );
    expect(sourceHref({ kind: 'org-chart', label: '' }, null)).toBe('/people/directory/org-chart');
    expect(sourceHref({ kind: 'section', label: 'Bank' }, null)).toBe(
      '/people/data-health/completeness',
    );
  });

  it('changes the period through the address, and takes two dates for a custom one', async () => {
    const user = fast();
    const onPeriodChange = vi.fn();
    const { rerender } = render(<WhatChanged load={ready} onPeriodChange={onPeriodChange} />);
    await user.click(screen.getByRole('radio', { name: 'This quarter' }));
    expect(onPeriodChange).toHaveBeenLastCalledWith({ kind: 'quarter' });
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    expect(onPeriodChange).toHaveBeenLastCalledWith({
      kind: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    rerender(
      <WhatChanged
        load={{
          status: 'ready',
          data: { ...SEPTEMBER, period: { ...SEPTEMBER.period, kind: 'custom' } },
        }}
        onPeriodChange={onPeriodChange}
      />,
    );
    const from = screen.getByLabelText('From');
    await user.clear(from);
    await user.type(from, '2026-09-10');
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(onPeriodChange).toHaveBeenLastCalledWith({
      kind: 'custom',
      from: '2026-09-10',
      to: '2026-09-30',
    });
  });

  it('says plainly when nothing can be described', () => {
    render(
      <WhatChanged
        load={{ status: 'ready', data: { ...SEPTEMBER, title: 'September', points: [] } }}
      />,
    );
    expect(
      screen.getByText(/Nothing Kithena can describe changed in September/),
    ).toBeInTheDocument();
  });

  it('swaps in the assistant’s words when they come, and says whose they are', async () => {
    const onWorded = vi.fn(() =>
      Promise.resolve({
        byModel: true,
        points: [
          {
            ...SEPTEMBER.points[0],
            parts: [{ text: 'September brought 14 joiners, taking us to 412.', strong: false }],
          },
        ],
      }),
    );
    render(
      <WhatChanged
        load={{ status: 'ready', data: { ...SEPTEMBER, phrasable: true } }}
        onWorded={onWorded}
      />,
    );
    expect(screen.getByText(/Headcount grew from/)).toBeInTheDocument();
    expect(
      await screen.findByText('September brought 14 joiners, taking us to 412.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Worded by the assistant; every figure is Kithena’s/),
    ).toBeInTheDocument();
  });

  it('keeps People’s words when the assistant gives none', async () => {
    const onWorded = vi.fn(() => Promise.resolve(null));
    render(
      <WhatChanged
        load={{ status: 'ready', data: { ...SEPTEMBER, phrasable: true } }}
        onWorded={onWorded}
      />,
    );
    await vi.waitFor(() => {
      expect(onWorded).toHaveBeenCalled();
    });
    expect(screen.getByText(/Worded by Kithena’s own rules/)).toBeInTheDocument();
  });
});

describe('a follow-up question', () => {
  it('goes into the address, and its answer comes from the points', async () => {
    const user = fast();
    const onQuestionChange = vi.fn();
    const onAsk = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          kind: 'answer',
          byModel: false,
          keys: ['leavers'],
          sentences: [
            [{ text: 'Kithena has the figures, not the reasons.', strong: false }],
            [
              { text: '3', strong: true },
              { text: ' people left, all in Support.', strong: false },
            ],
          ],
        },
      }),
    );
    const { rerender, container } = render(
      <WhatChanged load={ready} onAsk={onAsk} onQuestionChange={onQuestionChange} />,
    );
    const box = screen.getByRole('textbox', { name: 'Ask a follow-up' });
    expect(box).toHaveAttribute(
      'placeholder',
      'Ask a follow-up, like “why is Support losing people?”',
    );
    await user.type(box, 'why is Support losing people?{Enter}');
    expect(onQuestionChange).toHaveBeenCalledWith('why is Support losing people?');
    rerender(
      <WhatChanged
        load={ready}
        onAsk={onAsk}
        onQuestionChange={onQuestionChange}
        question="why is Support losing people?"
      />,
    );
    expect(await screen.findByText(/people left, all in Support/)).toBeInTheDocument();
    expect(onAsk).toHaveBeenCalledWith('why is Support losing people?');
    expect(
      screen.getByText('Answered by Kithena’s own rules from these points.'),
    ).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says what it will not answer', async () => {
    const onAsk = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          kind: 'refused',
          byModel: false,
          keys: [],
          sentences: [[{ text: 'Kithena doesn’t judge performance.', strong: false }]],
        },
      }),
    );
    render(<WhatChanged load={ready} onAsk={onAsk} question="who is worst?" />);
    expect(await screen.findByText('Not something Kithena answers')).toBeInTheDocument();
  });
});

describe('exporting the summary (AI6)', () => {
  it('rewrites it for the recipient, says what was left out, and lets every sentence be edited', async () => {
    const user = fast();
    const onDraft = vi.fn(() => Promise.resolve({ ok: true as const, data: FOR_NORA }));
    const onDownload = vi.fn(() => Promise.resolve({ ok: true as const }));
    const onSend = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { id: 's', emailed: true } }),
    );
    render(
      <WhatChanged
        load={ready}
        exporting={choices}
        onExportingChange={vi.fn()}
        onDraft={onDraft}
        onDownload={onDownload}
        onSend={onSend}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: /Export the September summary/ });
    expect(onDraft).toHaveBeenCalledWith({
      tone: 'short',
      charts: true,
      madeLine: true,
      recipient: 'nora',
      edits: [],
    });
    expect(
      await within(dialog).findByText(/Pay is left out, because Nora Becker/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Written for these readers')).toBeInTheDocument();
    expect(within(dialog).getByText('What changed in September')).toBeInTheDocument();
    expect(within(dialog).getByText('Prepared by Ada Lovelace · 1 Oct 2026')).toBeInTheDocument();
    const sentence = within(dialog).getByRole('textbox', { name: 'The sentence for 3' });
    await user.clear(sentence);
    await user.type(sentence, 'Three people left Support.');
    await user.click(within(dialog).getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledWith({
      tone: 'short',
      charts: true,
      madeLine: true,
      recipient: 'nora',
      edits: [{ key: 'leavers', text: 'Three people left Support.' }],
    });
    await user.click(within(dialog).getByRole('button', { name: 'Send to Nora' }));
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'nora', format: 'pdf' }) as unknown,
    );
    expect(await within(dialog).findByText(/Sent to Nora Becker/)).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('keeps the choices in the address, and offers no Send to anybody who may not send', async () => {
    const user = fast();
    const onExportingChange = vi.fn();
    render(
      <WhatChanged
        load={{ status: 'ready', data: { ...SEPTEMBER, recipients: [], canSend: false } }}
        exporting={{ ...choices, recipient: null }}
        onExportingChange={onExportingChange}
        onDraft={() =>
          Promise.resolve({ ok: true as const, data: { ...FOR_NORA, recipient: null, notes: [] } })
        }
        onSend={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('For you. HR can send it to somebody else.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Send to/ })).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: 'Detailed' }));
    expect(onExportingChange).toHaveBeenLastCalledWith({
      ...choices,
      recipient: null,
      tone: 'detailed',
    });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Include the charts' }));
    expect(onExportingChange).toHaveBeenLastCalledWith({
      ...choices,
      recipient: null,
      charts: false,
    });
  });

  it('opens from the header and from the card', async () => {
    const user = fast();
    const onExportingChange = vi.fn();
    render(<WhatChanged load={ready} onExportingChange={onExportingChange} onAsk={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: 'Export summary' }));
    expect(onExportingChange).toHaveBeenCalledTimes(2);
    expect(onExportingChange).toHaveBeenLastCalledWith({
      format: 'pdf',
      recipient: null,
      tone: 'short',
      charts: true,
      madeLine: true,
    });
  });
});

describe('a summary somebody sent', () => {
  it('opens for its recipient as it was sent, with the same on paper', async () => {
    const { container } = render(
      <WhatChanged
        load={{
          status: 'ready',
          data: {
            shared: {
              id: '0190a0b2-0000-7000-8000-000000000002',
              createdAt: '2026-10-01T08:00:00Z',
              expiresAt: '2026-10-08T08:00:00Z',
              document: FOR_NORA.document,
            },
          },
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'What changed in September' })).toBeInTheDocument();
    expect(screen.getByText(/Headcount grew from 398 to 412/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'href',
      '/people/downloads/summary?shared=0190a0b2-0000-7000-8000-000000000002',
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says so when it is not there', () => {
    render(<WhatChanged load={{ status: 'ready', data: { shared: null } }} />);
    expect(screen.getByText('This summary is not here')).toBeInTheDocument();
  });
});
