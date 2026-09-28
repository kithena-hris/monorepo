import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function card() {
  render(
    <HoverCard>
      <HoverCardTrigger href="#jonas">Jonas Weber</HoverCardTrigger>
      <HoverCardContent aria-label="Jonas Weber">
        <button type="button">Message</button>
      </HoverCardContent>
    </HoverCard>,
  );
  return screen.getByRole('link', { name: 'Jonas Weber' });
}

describe('<HoverCard>', () => {
  it('opens after the delay on keyboard focus, without taking focus', () => {
    const trigger = card();
    act(() => {
      trigger.focus();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole('dialog', { name: 'Jonas Weber' })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens on a long-press and swallows the tap that follows', () => {
    const trigger = card();
    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('dialog', { name: 'Jonas Weber' })).toBeInTheDocument();
    fireEvent.pointerUp(trigger, { pointerType: 'touch' });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('does not open on a short tap', () => {
    const trigger = card();
    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerUp(trigger, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
