// @vitest-environment jsdom
import { ToastProvider } from '@reach/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const field = (key: string, label: string) => ({
  key,
  label,
  description: null,
  dataType: 'text',
  options: [],
  required: true,
  value: null,
  sensitive: false,
  currency: null,
});
const recordGaps = vi.fn(() =>
  Promise.resolve({
    ok: true as const,
    sections: [
      { key: 'bank', label: 'Bank', fields: [field('iban', 'IBAN'), field('bank', 'Bank name')] },
    ],
  }),
);
vi.mock('../app/(app)/inbox/pane-actions', () => ({ recordGaps }));
vi.mock('../app/(app)/inbox/actions', () => ({ inboxItem: vi.fn() }));
vi.mock('../app/(app)/people/actions', () => ({
  // One field saved, one refused.
  saveOwnFields: vi.fn(() => Promise.resolve({ bank: null, iban: 'That is not an IBAN.' })),
  invitePerson: vi.fn(),
  savePersonSection: vi.fn(),
}));

it('takes a saved field out in place, and says why under the one refused, which takes the focus', async () => {
  const { MissingFields } = await import('./home-missing');
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MissingFields personId="p1" onSaved={onSaved} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByRole('textbox', { name: /IBAN/ }), {
    target: { value: 'nope' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /Bank name/ }), {
    target: { value: 'Triodos' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(screen.queryByRole('textbox', { name: /Bank name/ })).toBeNull();
  });
  const iban = screen.getByRole<HTMLInputElement>('textbox', { name: /IBAN/ });
  expect(iban.value).toBe('nope');
  expect(iban.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText('That is not an IBAN.')).toBeTruthy();
  await waitFor(() => {
    expect(document.activeElement).toBe(iban);
  });
  expect(onSaved).toHaveBeenCalledTimes(1);
  // Nothing was read again: the list changed where it stood.
  expect(recordGaps).toHaveBeenCalledTimes(1);
});
