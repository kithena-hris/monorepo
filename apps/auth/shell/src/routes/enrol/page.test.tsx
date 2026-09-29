// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The setup link's flow, one ceremony at the end (bug of 2026-09-27).
 *
 * A recovery link for somebody with no name on file used to open on the
 * passkey, run it, be refused for the name, and send them through the form to
 * a second passkey. These drive the page against a stubbed service and count
 * the ceremonies.
 */

const startRegistration = vi.fn(() => Promise.resolve({ id: 'new-passkey' }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration }));
vi.mock('@modern-js/runtime/router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../lib/brand', () => ({ useBrandRamp: () => undefined }));
vi.mock('../../lib/tenant', () => ({
  resolveTenant: () =>
    Promise.resolve({
      id: '00000000-0000-4000-8000-00000000000a',
      slug: 'acme',
      branding: { displayName: 'Acme', logoUrl: null, coverImageUrl: null, themeId: null },
    }),
}));

// What jsdom lacks and Radix reaches for.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
});
Object.assign(Element.prototype, {
  scrollIntoView: () => undefined,
  hasPointerCapture: () => false,
  releasePointerCapture: () => undefined,
});

const { default: Enrol } = await import('./page');

async function violations(): Promise<string[]> {
  const result = await axe.run(document.body, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

const badge = {
  key: 'badge_name',
  label: 'Name for your badge',
  description: null,
  dataType: 'text',
  required: true,
  options: [],
  maxLength: 40,
  min: null,
  max: null,
  decimals: null,
  classification: 'internal',
};

let finished: Record<string, unknown> | null;

function serve(status: Record<string, unknown>): void {
  finished = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const reply = (value: unknown) => Promise.resolve(new Response(JSON.stringify(value)));
      if (path.endsWith('/enrolment/status')) return reply({ state: 'usable', ...status });
      if (path.endsWith('/register/begin')) return reply({ options: { challenge: 'c' } });
      finished = body;
      return reply({ accountId: 'a1', credentialId: 'c1' });
    }),
  );
}

beforeEach(() => {
  startRegistration.mockClear();
  window.history.replaceState(
    null,
    '',
    '/enrol?tenant=acme&token=t0k3n&identity=i1&name=ada%40acme.example',
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });

describe('a recovery link for somebody with nothing on file', () => {
  it('asks first, then creates the passkey once, last', async () => {
    serve({ purpose: 'recovery', name: null, questions: [badge] });
    render(<Enrol />);

    // The details, not the button.
    await screen.findByLabelText('Legal first name', { exact: false });
    expect(screen.queryByRole('button', { name: 'Set up a new passkey' })).toBeNull();
    // A recovery keeps the zone and number on file; the form does not offer them.
    expect(screen.queryByText('Where you work')).toBeNull();
    expect(await violations()).toEqual([]);

    // A required answer left blank is caught here, before any ceremony.
    type('Legal first name', 'Ada');
    type('Legal last name', 'Lovelace');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('This is required')).toBeTruthy();

    type('Name for your badge', 'Countess');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Countess')).toBeTruthy();
    expect(await violations()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'That is right' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Set up a new passkey' }));
    await waitFor(() => {
      expect(finished).not.toBeNull();
    });

    expect(startRegistration).toHaveBeenCalledTimes(1);
    expect(finished).toMatchObject({
      name: { given: 'Ada', family: 'Lovelace', preferred: '' },
      answers: { badge_name: 'Countess' },
    });
    expect(finished).not.toHaveProperty('profile');
    // Two axe passes and a four-step form: well under a second alone, past the
    // 5s default when the whole unit suite shares the runner.
  }, 20_000);
});

describe('a recovery link with nothing missing', () => {
  it('goes straight to the passkey, and leaves the name on file alone', async () => {
    serve({
      purpose: 'recovery',
      name: { given: 'Ada', family: 'Lovelace', preferred: null },
      questions: [],
    });
    render(<Enrol />);

    fireEvent.click(await screen.findByRole('button', { name: 'Set up a new passkey' }));
    await waitFor(() => {
      expect(finished).not.toBeNull();
    });
    expect(startRegistration).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveProperty('name');
    expect(finished).not.toHaveProperty('answers');
  });
});

describe('an invitation', () => {
  it('asks the company’s questions on the details step, before the passkey', async () => {
    serve({ purpose: 'invitation', name: null, questions: [badge] });
    render(<Enrol />);

    await screen.findByLabelText('Name for your badge', { exact: false });
    expect(screen.getByText('Where you work')).toBeTruthy();
    expect(await violations()).toEqual([]);
    expect(startRegistration).not.toHaveBeenCalled();
  });
});
