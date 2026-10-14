import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { DraftDialog } from './draft';

const draft = {
  title: 'Offer letter',
  typeKey: 'employment_contract',
  typeName: 'Employment contract',
  about: 'Omar Lewis',
  aboutPersonId: 'p-omar',
  body: 'Dear Omar,\n\nYour salary is 85000 a year, with a 10% bonus.',
  signers: [
    { name: 'Omar Lewis', email: null, order: 1, personId: 'p-omar' },
    { name: 'Ashu Venugopal', email: null, order: 2, personId: 'p-ashu' },
  ],
  figures: ['10'],
  ready: true,
};

describe('a document drafted with Kithena (§14.2)', () => {
  it('drafts from the conversation, then files it and sends it to sign in order', async () => {
    const onDraftDocument = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { available: true, reply: 'Here it is.', draft },
      }),
    );
    const onFileDraft = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { id: 'd-1', envelopeId: 'e-1' } }),
    );
    const onDone = vi.fn();
    render(
      <DraftDialog
        open
        onOpenChange={vi.fn()}
        onDraftDocument={onDraftDocument}
        onFileDraft={onFileDraft}
        onDone={onDone}
      />,
    );
    const box = screen.getByRole('textbox', { name: 'Message Kithena' });
    fireEvent.change(box, { target: { value: 'An offer for Omar, 85,000. He signs, then me.' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('Here it is.')).toBeTruthy();
    expect(onDraftDocument).toHaveBeenCalledWith({
      messages: [{ role: 'user', text: 'An offer for Omar, 85,000. He signs, then me.' }],
      draft: null,
    });
    expect(screen.getByText(/Check 10: nobody gave Kithena this figure/)).toBeTruthy();
    expect(screen.getByText('1. Omar Lewis')).toBeTruthy();
    expect(screen.getByText('2. Ashu Venugopal')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Send for signature' }));
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalledWith('/documents/envelopes/e-1');
    });
    expect(onFileDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Offer letter', aboutPersonId: 'p-omar' }),
      true,
    );
  });
});
