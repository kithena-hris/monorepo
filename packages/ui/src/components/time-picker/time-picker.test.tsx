import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { formatTime, parseTime, timeSlots, TimePicker } from './time-picker';

/**
 * What people type into a time field is not ISO. These are the shapes that
 * arrive, and each has to land on the same `HH:MM` or be refused outright,
 * never guessed into a different hour.
 */
describe('parseTime', () => {
  it.each([
    ['09:30', '09:30'],
    ['9:30', '09:30'],
    ['9.30', '09:30'],
    ['930', '09:30'],
    ['0930', '09:30'],
    ['9', '09:00'],
    ['21:05', '21:05'],
    ['9:30 pm', '21:30'],
    ['9pm', '21:00'],
    ['12:15 am', '00:15'],
    ['12 pm', '12:00'],
    [' 7:45AM ', '07:45'],
  ])('reads %j as %s', (input, expected) => {
    expect(parseTime(input)).toBe(expected);
  });

  it.each(['', 'soon', '24:00', '9:60', '13 pm', '0 am', '12345'])('refuses %j', (input) => {
    expect(parseTime(input)).toBeNull();
  });
});

describe('formatTime', () => {
  it('follows the locale, not the stored form', () => {
    expect(formatTime('09:30', 'en-GB')).toBe('09:30');
    expect(formatTime('21:30', 'en-US')).toMatch(/^9:30\sPM$/);
  });
});

describe('timeSlots', () => {
  it('steps through the day inside the bounds, inclusive', () => {
    expect(timeSlots(30, '08:30', '10:00')).toEqual(['08:30', '09:00', '09:30', '10:00']);
    expect(timeSlots(15).length).toBe(96);
  });
});

function Harness({ initial = null }: { initial?: string | null }): React.JSX.Element {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <TimePicker label="Start" value={value} onChange={setValue} step={30} locale="en-GB" />
      <output data-testid="value">{value ?? 'none'}</output>
    </>
  );
}

describe('TimePicker', () => {
  // jsdom has neither: a fine pointer, and a list that cannot scroll.
  beforeAll(() => {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList;
    Element.prototype.scrollIntoView = () => undefined;
  });

  it('is a combobox that opens its list on ArrowDown and commits with Enter', () => {
    render(<Harness initial="09:00" />);
    const input = screen.getByRole('combobox', { name: 'Start' });
    expect(input.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    // Opens on the current value, so the next ArrowDown is the next slot.
    const active = input.getAttribute('aria-activedescendant');
    expect(active && document.getElementById(active)?.textContent).toBe('09:00');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('value').textContent).toBe('09:30');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('commits a typed time on blur and puts back an unreadable one', () => {
    render(<Harness initial="09:00" />);
    const input = screen.getByRole('combobox', { name: 'Start' });

    fireEvent.change(input, { target: { value: '1415' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('value').textContent).toBe('14:15');
    expect((input as HTMLInputElement).value).toBe('14:15');

    fireEvent.change(input, { target: { value: 'later' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('value').textContent).toBe('14:15');
    expect((input as HTMLInputElement).value).toBe('14:15');
  });

  it('closes on Escape without changing the value', () => {
    render(<Harness initial="09:00" />);
    const input = screen.getByRole('combobox', { name: 'Start' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('value').textContent).toBe('09:00');
  });
});
