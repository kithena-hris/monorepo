import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDragDismiss, type DragAxis } from './use-drag-dismiss';

/*
 * The decision logic, exercised through the real hook.
 *
 * These are unit tests of *intent*: given a gesture, does the panel commit to
 * dismissing or return to rest. They deliberately do not assert on the settle
 * animation's intermediate frames, that is `spring.test.ts`'s job, and pinning
 * frame values here would make every future tuning change look like a
 * regression.
 *
 * jsdom has no layout and no Pointer Events, so both are supplied below. That
 * is a real limit on what this file can prove: it verifies the arithmetic that
 * decides dismiss-versus-return, not that the gesture feels right. Feel is
 * checked on hardware.
 */

const PANEL_SIZE = 400;

/*
 * Timing budget for the settle.
 *
 * The longest spring in the system settles in ~584ms, and jsdom runs
 * `requestAnimationFrame` off timers, so under load the wall-clock cost is
 * higher again. Both numbers below are derived from that one fact rather than
 * guessed, and they fail in opposite directions: too small a `waitFor` makes a
 * passing case flake, too small a wait makes a *negative* case pass for the
 * wrong reason, before the dismissal it is meant to rule out could have fired.
 */
const SETTLE = { timeout: 5000 };

/** Wait past the longest possible settle, so "did not dismiss" means it. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 1200);
  });

function Panel({
  axis,
  onDismiss,
  scrollTop = 0,
}: {
  axis: DragAxis;
  onDismiss: () => void;
  /** Simulates a scrolled body, to test which gesture wins. */
  scrollTop?: number;
}) {
  const dragState = useDragDismiss({ axis, onDismiss });
  return (
    <div ref={dragState.ref} data-testid="panel" data-dragging={dragState.dataDragging}>
      <div
        data-testid="body"
        style={{ overflowY: 'auto' }}
        ref={(node) => {
          if (node) Object.defineProperty(node, 'scrollTop', { value: scrollTop, writable: true });
        }}
      >
        <p data-testid="content">Leave request</p>
      </div>
    </div>
  );
}

/** A pointer event jsdom will dispatch, carrying the fields the hook reads. */
function pointer(type: string, { x = 0, y = 0, at = 0 } = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
    clientX: { value: x },
    clientY: { value: y },
    timeStamp: { value: at },
  });
  return event;
}

/**
 * Plays a gesture as a sequence of positions and timestamps.
 *
 * The timestamps are the whole point: the hook decides on velocity, so the same
 * path played slowly and played quickly must produce different outcomes, and a
 * test that omitted timing could not tell the two apart.
 */
function drag(target: HTMLElement, path: { x?: number; y?: number; at: number }[]): void {
  const first = path[0];
  if (!first) throw new Error('a gesture needs at least one point');

  act(() => {
    target.dispatchEvent(pointer('pointerdown', first));
    for (const point of path.slice(1)) target.dispatchEvent(pointer('pointermove', point));
    target.dispatchEvent(pointer('pointerup', path.at(-1)));
  });
}

beforeEach(() => {
  // jsdom reports every element as 0x0, and the hook divides by the panel's
  // size to decide whether a drag passed the threshold. Without a size, every
  // gesture is infinitely far past it.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    height: PANEL_SIZE,
    width: PANEL_SIZE,
    top: 0,
    left: 0,
    bottom: PANEL_SIZE,
    right: PANEL_SIZE,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('committing to a gesture', () => {
  it('ignores a tap', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="bottom" onDismiss={onDismiss} />);

    // 3px of travel is a press, not a drag. Claiming the pointer here would
    // swallow taps on the panel's own header.
    drag(getByTestId('panel'), [
      { y: 0, at: 0 },
      { y: 3, at: 16 },
    ]);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(getByTestId('panel')).not.toHaveAttribute('data-dragging');
  });

  it('does not start a drag from a control inside the panel', () => {
    const onDismiss = vi.fn();
    function WithButton() {
      const dragState = useDragDismiss({ axis: 'bottom', onDismiss });
      return (
        <div ref={dragState.ref} data-testid="panel">
          <button type="button" data-testid="approve">
            Approve
          </button>
        </div>
      );
    }
    const { getByTestId } = render(<WithButton />);

    // A sheet whose buttons are also drag handles is a sheet nobody can submit.
    drag(getByTestId('approve'), [
      { y: 0, at: 0 },
      { y: 200, at: 100 },
      { y: 300, at: 150 },
    ]);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('deciding on velocity', () => {
  it('dismisses a short flick', async () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="bottom" onDismiss={onDismiss} />);

    /*
     * 60px in 50ms is ~1200px/s, well past the flick threshold, and only 15% of
     * the panel, well short of the distance threshold. Distance alone would keep
     * this panel open, which is exactly the feel this hook exists to avoid.
     */
    drag(getByTestId('panel'), [
      { y: 0, at: 0 },
      { y: 30, at: 25 },
      { y: 60, at: 50 },
    ]);

    await vi.waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    }, SETTLE);
  });

  it('returns a long drag that stopped before release', async () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="bottom" onDismiss={onDismiss} />);

    /*
     * Travels 100px of a 400px panel, a quarter, then holds still for 200ms.
     *
     * Both halves matter. Releasing at rest means momentum projection adds
     * nothing, and a quarter is short of the 35% distance threshold, so neither
     * signal says dismiss and the panel returns.
     *
     * Note what this deliberately does *not* claim: that stopping always
     * cancels. Drag past the threshold and stop, and it still commits, which is
     * what every native sheet does and what the next test pins. An earlier
     * version of this test travelled 150px, past the threshold, and only passed
     * because it stopped waiting before the settle could report the dismissal.
     */
    drag(getByTestId('panel'), [
      { y: 0, at: 0 },
      { y: 70, at: 80 },
      { y: 100, at: 140 },
      { y: 100, at: 240 },
      { y: 100, at: 340 },
    ]);

    // Give the settle a chance to run and, wrongly, report a dismissal.
    await settled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses a drag that passed the threshold and then stopped', async () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="bottom" onDismiss={onDismiss} />);

    // 150px of 400 is past the 35% threshold, and the finger is at rest on
    // release. Distance alone is enough to commit: having pushed a panel most
    // of the way out, letting go is not a change of mind.
    drag(getByTestId('panel'), [
      { y: 0, at: 0 },
      { y: 100, at: 80 },
      { y: 150, at: 140 },
      { y: 150, at: 240 },
      { y: 150, at: 340 },
    ]);

    await vi.waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    }, SETTLE);
  });

  it('dismisses a slow drag that went far enough', async () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="bottom" onDismiss={onDismiss} />);

    // 300px of 400 is past the 35% threshold, and still moving at release.
    drag(getByTestId('panel'), [
      { y: 0, at: 0 },
      { y: 150, at: 300 },
      { y: 300, at: 600 },
    ]);

    await vi.waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    }, SETTLE);
  });

  it('ignores a flick away from the closing edge', async () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="bottom" onDismiss={onDismiss} />);

    // Upward on a bottom sheet is an overshoot, not a dismissal. However hard it
    // is thrown, it cannot close the panel.
    drag(getByTestId('panel'), [
      { y: 200, at: 0 },
      { y: 100, at: 25 },
      { y: 0, at: 50 },
    ]);

    await settled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('axis', () => {
  it('dismisses a right sheet on a rightward flick', async () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="right" onDismiss={onDismiss} />);

    drag(getByTestId('panel'), [
      { x: 0, at: 0 },
      { x: 40, at: 25 },
      { x: 80, at: 50 },
    ]);

    await vi.waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    }, SETTLE);
  });

  it('does not dismiss a right sheet on a leftward flick', async () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="right" onDismiss={onDismiss} />);

    // Leftward on a right-anchored sheet pulls it away from its edge. Same
    // reasoning as the upward flick on a bottom sheet: an overshoot to resist,
    // never a dismissal.
    drag(getByTestId('panel'), [
      { x: 200, at: 0 },
      { x: 100, at: 25 },
      { x: 0, at: 50 },
    ]);

    await settled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('reads the vertical position for a bottom sheet and ignores sideways travel', async () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="bottom" onDismiss={onDismiss} />);

    // A purely horizontal flick must not close a panel anchored to the bottom.
    drag(getByTestId('panel'), [
      { x: 0, y: 0, at: 0 },
      { x: 150, y: 0, at: 25 },
      { x: 300, y: 0, at: 50 },
    ]);

    await settled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('scrolling content wins first', () => {
  it('does not dismiss when the drag starts in a scrolled body', async () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="bottom" onDismiss={onDismiss} scrollTop={120} />);

    /*
     * The gesture that would otherwise dismiss, started inside a list scrolled
     * 120px down. The list has to consume it: a sheet that closes out from under
     * a half-read list is the worst thing a bottom sheet can do.
     */
    drag(getByTestId('content'), [
      { y: 0, at: 0 },
      { y: 60, at: 25 },
      { y: 120, at: 50 },
    ]);

    await settled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses once that body is back at its top', async () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Panel axis="bottom" onDismiss={onDismiss} scrollTop={0} />);

    // Same gesture, same element, only the scroll position differs.
    drag(getByTestId('content'), [
      { y: 0, at: 0 },
      { y: 60, at: 25 },
      { y: 120, at: 50 },
    ]);

    await vi.waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    }, SETTLE);
  });
});
