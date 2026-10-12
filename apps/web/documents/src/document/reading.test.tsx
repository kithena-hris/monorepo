import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import * as screens from '../index';
import { adaSettings, adamDocument } from '../test/acme.fixture';
import { axeViolations } from '../test/axe';
import type { Summary } from '../types';
import { AcrossAnswer } from './reading';

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });

const summary: Summary = {
  available: true,
  reason: null,
  summary: [{ text: 'A permanent contract from 2 September 2024.', pages: [1] }],
  facts: [{ label: 'Notice', value: 'Three months', page: 4 }],
  watch: { text: 'Either side can end it with three months’ notice.', pages: [4] },
  questions: ['What is the notice period?'],
  dates: [],
};

describe('Kithena reading a document (D1, B4, S7)', () => {
  it('summarises with each claim’s page, once the page is up', async () => {
    const { container } = render(
      <screens.DocumentView
        load={ready(adamDocument())}
        onSummarize={() => Promise.resolve({ ok: true, data: summary })}
        onAskDocument={() =>
          Promise.resolve({
            ok: true,
            data: {
              available: false,
              reason: 'The document does not say.',
              answer: [],
              sources: [],
            },
          })
        }
      />,
    );
    expect(await screen.findByText('A permanent contract from 2 September 2024.')).toBeTruthy();
    expect(screen.getByText('Worth knowing')).toBeTruthy();
    expect(screen.getByText('What is the notice period?')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows nothing when Kithena cannot read it', () => {
    render(
      <screens.DocumentView
        load={ready(adamDocument())}
        onSummarize={() =>
          Promise.resolve({
            ok: true,
            data: { ...summary, available: false, reason: 'No model', summary: [] },
          })
        }
      />,
    );
    expect(screen.queryByText('Summary')).toBeNull();
  });

  it('answers across documents with each source a link', async () => {
    const { container } = render(
      <AcrossAnswer
        question="When does my passport expire?"
        answer={{
          available: true,
          reason: null,
          answer: [{ text: 'On 3 March 2031.', pages: [1] }],
          sources: [{ documentId: 'd1', title: 'Passport', pages: [1] }],
        }}
      />,
    );
    expect(screen.getByRole('link', { name: /Passport · p\. 1/u })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws the company’s switches (S7)', async () => {
    const { container } = render(<screens.AiSettings load={ready(adaSettings())} />);
    expect(screen.getByText('Questions across documents')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
