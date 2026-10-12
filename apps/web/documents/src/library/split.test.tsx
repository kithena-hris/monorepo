import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { SplitDialog } from './split';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('splitting a scan (C2)', () => {
  it('shows what Kithena proposed, and files the parts as left', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    );
    const onFileSplit = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <SplitDialog
        open
        onOpenChange={vi.fn()}
        types={[
          {
            key: 'employment_contract',
            name: 'Employment contract',
            kind: 'Contract',
            filedTo: 'person',
            confidential: true,
          },
        ]}
        people={[{ personId: 'p-adam', name: 'Adam Novak', teamName: null }]}
        onStartUpload={() =>
          Promise.resolve({
            ok: true,
            put: { uploadId: 'u-1', url: 'https://bucket/u-1', method: 'PUT', headers: {} },
          })
        }
        onProposeSplit={() =>
          Promise.resolve({
            ok: true,
            data: {
              available: true,
              pages: 3,
              parts: [
                {
                  from: 1,
                  to: 2,
                  title: 'Contract',
                  typeKey: 'employment_contract',
                  subjectPersonId: 'p-adam',
                },
                { from: 3, to: 3, title: 'Letter', typeKey: null, subjectPersonId: null },
              ],
            },
          })
        }
        onFileSplit={onFileSplit}
      />,
    );
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
    fireEvent.change(input, {
      target: { files: [new File(['%PDF'], 'stack.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByDisplayValue('Contract')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'File 2 documents' }));
    await waitFor(() => {
      expect(onFileSplit).toHaveBeenCalledWith(
        { uploadId: 'u-1', name: 'stack.pdf', mediaType: 'application/pdf' },
        expect.arrayContaining([expect.objectContaining({ title: 'Letter', from: 3 })]),
      );
    });
    expect(await axeViolations(container)).toEqual([]);
  });
});
