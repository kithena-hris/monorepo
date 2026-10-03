import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineChart, type TimelineMove, type TimelineRow } from './timeline-chart';

/** 2027 is 365 days; at 730px wide a day is 2px and a week 14px. */
const WIDTH = 730;

const rows: TimelineRow[] = [
  {
    label: 'Phase A',
    items: [{ id: 'a', label: '2 weeks', start: '2027-02-01', end: '2027-02-14', tone: 'chart-3' }],
  },
  {
    label: 'Phase B',
    items: [{ id: 'b', label: 'Not started', start: '2027-01-08', end: '2027-01-21' }],
  },
  {
    label: 'Reserve',
    items: [
      { id: 'c', label: 'Held back', start: '2027-09-06', end: '2027-12-31', tentative: true },
    ],
  },
];

function track(onItemMove = vi.fn<(move: TimelineMove) => void>()) {
  const onDrop = vi.fn<(move: TimelineMove, applied: boolean) => void>();
  render(
    <TimelineChart
      variant="track"
      label="Plan"
      rows={rows}
      domain={{ start: '2027-01-01', end: '2027-12-31' }}
      snapDays={7}
      editable
      markers={[{ date: '2027-02-01', label: 'Starts' }]}
      onItemMove={onItemMove}
      onDrop={onDrop}
    />,
  );
  return { onItemMove, onDrop };
}

const segment = (name: RegExp): HTMLElement => screen.getByRole('button', { name });

/** dnd-kit adds its keydown listener on the next tick after a pick-up. */
async function press(element: HTMLElement, ...codes: string[]): Promise<void> {
  for (const code of codes) {
    fireEvent.keyDown(element, { code });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: WIDTH, height: 40 }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('<TimelineChart variant="track">', () => {
  it('writes each label under its bar, hatches a tentative segment and calls out markers', () => {
    track();
    expect(screen.getAllByText('2 weeks').length).toBeGreaterThan(0);
    expect(segment(/Reserve, Held back/).querySelector('.pattern-hatched')).not.toBeNull();
    expect(screen.getAllByText('Starts').length).toBeGreaterThan(0);
  });

  it('moves a segment a week per arrow from the keyboard, and says where it went', async () => {
    const { onItemMove } = track();
    const bar = segment(/Phase A, 2 weeks/);
    bar.focus();
    await press(bar, 'Space', 'ArrowRight', 'ArrowRight', 'Space');
    expect(onItemMove).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'a',
        mode: 'move',
        from: { start: '2027-02-01', end: '2027-02-14' },
        to: { start: '2027-02-15', end: '2027-02-28' },
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/2 weeks moved to/);
  });

  it('Escape puts it back', async () => {
    const { onItemMove } = track();
    const bar = segment(/Phase A, 2 weeks/);
    await press(bar, 'Space', 'ArrowRight', 'Escape');
    expect(onItemMove).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/cancelled/);
  });

  it('stops at the start of the axis without banking the extra presses', async () => {
    const { onItemMove, onDrop } = track();
    const bar = segment(/Phase B, Not started/);
    // One week back reaches 1 Jan; two more presses go nowhere; one forward is home again.
    await press(bar, 'Space', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight', 'Space');
    expect(onItemMove).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }), false);
  });
});
