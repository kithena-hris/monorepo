import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { KioskCode } from './code';
import { Kiosk, type Identified, type KioskCredential } from './kiosk';

/**
 * The kiosk at Acme's Madrid entrance (T25, T26) at 08:52 on Thursday
 * 1 October, and Adam's kiosk code on his phone.
 */

const NOW = Date.parse('2026-10-01T06:52:00.000Z');

function kiosk(identify: (c: KioskCredential) => Promise<Identified>) {
  const onPunch = vi.fn();
  const onIdentify = vi.fn(identify);
  const view = render(
    <Kiosk
      place="Madrid office, main entrance"
      online
      onIdentify={onIdentify}
      onPunch={onPunch}
      timeZone="Europe/Madrid"
      now={() => new Date(NOW)}
    />,
  );
  return { ...view, onPunch, onIdentify };
}

/** A badge reader: the number and Enter, as fast as a keyboard can be typed. */
function swipe(text: string): void {
  for (const key of [...Array.from(text), 'Enter']) fireEvent.keyDown(window, { key });
}

/** Seconds passing one at a time, each one's render and effects flushed, as a screen sees them. */
async function seconds(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one second after another
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

/** The first box of a PIN: masked boxes are password inputs, which have no textbox role. */
const firstBox = (container: HTMLElement): HTMLInputElement =>
  container.querySelector('input') as HTMLInputElement;

const adam = (): Promise<Identified> =>
  Promise.resolve({ status: 'known', firstName: 'Adam', kind: 'in' });

describe('the kiosk (T25, T26)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits with a big clock, where it is, and two other ways to clock in', async () => {
    const { container } = kiosk(adam);
    expect(screen.getByText('08:52')).toBeTruthy();
    expect(screen.getByText('Thursday 1 October')).toBeTruthy();
    expect(screen.getByText('Madrid office, main entrance')).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
    expect(screen.getByText('Hold your badge or phone here')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use a PIN' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show my QR code' })).toBeTruthy();
    vi.useRealTimers();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('a badge shows the first name and the time, and sends nothing for five seconds', async () => {
    const { onPunch, onIdentify, container } = kiosk(adam);
    await act(async () => {
      swipe('0004817265');
      await Promise.resolve();
    });
    expect(onIdentify).toHaveBeenCalledWith({ kind: 'badge', value: '0004817265' });
    expect(screen.getByRole('heading', { name: 'Good morning, Adam' })).toBeTruthy();
    expect(screen.getByText('Clocked in at 08:52')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Not you? Undo · 5' })).toBeTruthy();
    // First name only: no surname, no balance, nothing else about Adam.
    expect(container.textContent).not.toMatch(/Novak|days|balance/iu);
    expect(onPunch).not.toHaveBeenCalled();
    await seconds(4);
    expect(screen.getByRole('button', { name: 'Not you? Undo · 1' })).toBeTruthy();
    expect(onPunch).not.toHaveBeenCalled();
    await seconds(1);
    expect(onPunch).toHaveBeenCalledWith({
      credential: { kind: 'badge', value: '0004817265' },
      at: '2026-10-01T06:52:00.000Z',
    });
    expect(screen.getByText('Hold your badge or phone here')).toBeTruthy();
  });

  it('Not you? Undo sends nothing at all', async () => {
    const { onPunch } = kiosk(adam);
    await act(async () => {
      swipe('0004817265');
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Not you? Undo · 5' }));
    await seconds(10);
    expect(onPunch).not.toHaveBeenCalled();
    expect(screen.getByText('Hold your badge or phone here')).toBeTruthy();
  });

  it('a QR from a scanner is a code, not a badge', async () => {
    const { onIdentify } = kiosk(adam);
    await act(async () => {
      swipe('kq_abc.def');
      await Promise.resolve();
    });
    expect(onIdentify).toHaveBeenCalledWith({ kind: 'qr', value: 'kq_abc.def' });
  });

  it('offline, the tap is kept on the kiosk and still waits five seconds', async () => {
    const { onPunch } = kiosk(() => Promise.resolve({ status: 'offline' }));
    await act(async () => {
      swipe('0004817265');
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Saved on this kiosk' })).toBeTruthy();
    expect(screen.getByText('Taken at 08:52. It is sent when the network is back.')).toBeTruthy();
    await seconds(5);
    expect(onPunch).toHaveBeenCalledTimes(1);
  });

  it('a badge nobody has is refused, without a name', async () => {
    const { onPunch } = kiosk(() => Promise.resolve({ status: 'unknown' }));
    await act(async () => {
      swipe('999');
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toContain('Not recognised');
    expect(onPunch).not.toHaveBeenCalled();
  });

  it('a PIN is typed on the screen, masked', async () => {
    const { onIdentify, container } = kiosk(() =>
      Promise.resolve({
        status: 'known',
        firstName: 'Adam',
        kind: 'out',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use a PIN' }));
    expect(screen.getByRole('heading', { name: 'Enter your PIN' })).toBeTruthy();
    vi.useRealTimers();
    expect(await axeViolations(container)).toEqual([]);
    const first = firstBox(container);
    await act(async () => {
      fireEvent.paste(first, { clipboardData: { getData: () => '482193' } });
      await Promise.resolve();
    });
    expect(onIdentify).toHaveBeenCalledWith({ kind: 'pin', value: '482193' });
    expect(screen.getByRole('heading', { name: 'Goodbye, Adam' })).toBeTruthy();
  });

  it('Show my QR code says where to hold the phone when there is no camera to read it', () => {
    kiosk(adam);
    fireEvent.click(screen.getByRole('button', { name: 'Show my QR code' }));
    expect(screen.getByText(/hold it to the reader/u)).toBeTruthy();
  });
});

describe('my kiosk code', () => {
  const data = {
    token: 'kq_a-test-code',
    expiresAt: '2026-10-01T06:53:00.000Z',
    personId: 'p-adam',
  };

  it('shows a QR and how long it works for, and asks for a new one before it runs out', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let now = NOW;
    const onRefresh = vi.fn();
    const { container } = render(
      <KioskCode
        load={{ status: 'ready', data }}
        onRefresh={onRefresh}
        onSavePin={vi.fn()}
        now={() => now}
      />,
    );
    expect(screen.getByRole('img', { name: 'Your kiosk code' })).toBeTruthy();
    expect(screen.getByText('Works for another 60 seconds, then a new one appears.')).toBeTruthy();
    now += 51_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onRefresh).toHaveBeenCalled();
    vi.useRealTimers();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('saves a six-digit PIN as the member’s own', async () => {
    const onSavePin = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <KioskCode
        load={{ status: 'ready', data }}
        onRefresh={vi.fn()}
        onSavePin={onSavePin}
        now={() => NOW}
      />,
    );
    const first = firstBox(container);
    fireEvent.paste(first, { clipboardData: { getData: () => '482193' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
      await Promise.resolve();
    });
    expect(onSavePin).toHaveBeenCalledWith('p-adam', '482193');
    expect(screen.getByText('Your PIN is saved')).toBeTruthy();
  });

  it('draws its loading state in the page’s shape', async () => {
    const { container } = render(
      <KioskCode load={{ status: 'loading' }} onRefresh={vi.fn()} onSavePin={vi.fn()} />,
    );
    expect(screen.getByText('Loading your kiosk code')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
