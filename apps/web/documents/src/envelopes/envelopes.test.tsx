import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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

  it('places their boxes on the document, a dated signature to start', async () => {
    const data = adamDocument();
    const { container } = render(
      <screens.SendForSignature
        load={ready(data)}
        onFileLink={() => Promise.resolve({ ok: false, message: 'Not here' })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Add a box' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Signature' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Dated signature' })).toBeTruthy();
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
