import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as screens from '../index';
import { adamDocument, adamToSign } from '../test/acme.fixture';
import { axeViolations } from '../test/axe';

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });

describe('signing (K4, K5)', () => {
  it('shows Adam his part, and adopts a signature in his legal name only', async () => {
    const { container } = render(
      <screens.Envelope load={ready(adamToSign({ legalName: 'Adam Novak' }))} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Your part' })).toBeTruthy();
    // Finish is on the step bar under the document, once every box is filled.
    expect(screen.getByText(/Start, under the document/u)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Adopt your signature' }));
    expect(screen.getByRole('dialog', { name: 'Adopt your signature' })).toBeTruthy();
    // His legal name is there already and cannot be changed; only the face is chosen.
    const legal = screen.getByRole<HTMLInputElement>('textbox', { name: 'Your legal name' });
    expect(legal.value).toBe('Adam Novak');
    expect(legal.readOnly).toBe(true);
    expect(screen.getByRole('radio', { name: 'Flowing' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Bold' })).toBeTruthy();
  });

  it('the sender follows it: signers and their status, nothing to sign', async () => {
    const { container } = render(
      <screens.Envelope
        load={ready(
          adamToSign({
            me: null,
            follows: true,
            trail: [
              { who: 'Ada Lovelace', action: 'sent', at: '2026-10-12T09:00:00.000Z', note: null },
            ],
          }),
        )}
      />,
    );
    expect(screen.queryByRole('heading', { name: 'Your part' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remind' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('sending (K1–K3)', () => {
  it('starts with the person the document is about', async () => {
    const data = adamDocument();
    const { container } = render(<screens.SendForSignature load={ready(data)} />);
    expect(screen.getByText('Adam Novak')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('places their boxes on the document, a signature to start', async () => {
    const data = adamDocument();
    const { container } = render(
      <screens.SendForSignature
        load={ready(data)}
        onFileLink={() => Promise.resolve({ ok: false, message: 'Not here' })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next: where they sign' }));
    expect(screen.getByRole('heading', { name: 'Add a box' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Signature' })).toBeTruthy();
    // The day is in the print under a signature: there is no dated one to add.
    expect(screen.queryByRole('radio', { name: 'Dated signature' })).toBeNull();
    expect(screen.getByText('Adam Novak · 1 box')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('a policy’s acknowledgements (F3)', () => {
  it('says how many are done, and who is left', async () => {
    const { container } = render(
      <screens.Campaign
        load={ready({
          id: 'c',
          documentId: 'd',
          title: 'Travel and expenses policy',
          version: 4,
          dueOn: '2026-10-25',
          sentAt: '2026-10-01T09:00:00.000Z',
          done: 86,
          of: 98,
          left: [{ personId: 'p', name: 'Javier García', teamName: 'Support' }],
        })}
      />,
    );
    expect(screen.getByText('86 of 98 done')).toBeTruthy();
    expect(screen.getByText('Javier García')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('the signatures list (K10)', () => {
  const row = (id: string, title: string, extra: object) => ({
    id,
    documentId: `d-${id}`,
    title,
    status: 'sent' as const,
    signed: 0,
    of: 2,
    waitingOn: null,
    dueOn: null,
    createdAt: '2026-10-01T09:00:00Z',
    needsYou: false,
    ...extra,
  });
  const rows = [
    row('e1', 'Remote-work addendum', { needsYou: true }),
    row('e2', 'Offer letter', { waitingOn: 'Mei Tanaka' }),
    row('e3', 'Employment contract', { status: 'completed', signed: 2 }),
  ];

  it('says what is yours to sign first, then cuts the rest by where it stands', async () => {
    const { container } = render(<screens.Envelopes load={ready({ rows })} />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Waiting for your signature' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review and sign' }).getAttribute('href')).toBe(
      '/documents/envelopes/e1',
    );
    // On All the list is the rest: the one to sign is not said twice.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: 'Signed · 1' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Employment contract/ })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('lets them make the signature they sign with, in their legal name', () => {
    const onSetSignature = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <screens.Envelopes
        load={ready({
          rows,
          signature: { mark: null, name: 'Adam Novak', pending: false, canSet: true },
        })}
        onSetSignature={onSetSignature}
      />,
    );
    expect(screen.getByText('No signature yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create your signature' }));
    const legal = screen.getByRole<HTMLInputElement>('textbox', { name: 'Your legal name' });
    expect(legal.value).toBe('Adam Novak');
    fireEvent.click(screen.getByRole('button', { name: 'Save signature' }));
    expect(onSetSignature).toHaveBeenCalledWith({
      kind: 'typed',
      text: 'Adam Novak',
      style: 'flowing',
    });
  });
});
