'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { elementFrom } from './dom';
import {
  isSpringSettled,
  projectMomentum,
  rubberband,
  springs,
  stepSpring,
  type SpringState,
} from './spring';

/*
 * Drag-to-dismiss for edge-anchored panels.
 *
 * The reason this exists rather than a CSS transition: a panel the user is
 * touching has to do four things a stylesheet cannot express.
 *
 *   It tracks 1:1 while the finger is down, from the offset where they grabbed
 *   it. Snapping to the panel's centre on grab breaks the illusion instantly.
 *
 *   It resists rather than stops at the closed edge. A hard stop is
 *   indistinguishable from a hung app; resistance says "there is nothing more
 *   this way" while still proving the interface is listening.
 *
 *   It decides on *velocity*, not distance. A 20px flick has to dismiss, and a
 *   slow 200px drag that reverses at the end has to not. Intent is in the
 *   direction the gesture was travelling when it ended.
 *
 *   It hands the release velocity to the settle, so there is no seam between
 *   dragging and animating. This is the detail that separates a panel that
 *   feels physical from one that feels merely animated, and it is precisely
 *   what a baked easing curve cannot accept.
 *
 * Everything is driven off `requestAnimationFrame` and writes `transform`
 * directly to the node. Two deliberate choices there. React state per frame
 * would put a reconciliation between the finger and the pixels, and a CSS
 * custom property on a container would recalculate style for every descendant,
 * which on a sheet holding a 40-field form is the difference between a smooth
 * drag and a janky one.
 */

/** The edge a panel is anchored to. It dismisses toward that edge and no other. */
export type DragAxis = 'bottom' | 'top' | 'left' | 'right';

export interface UseDragDismissOptions {
  /**
   * Which edge the panel is anchored to. Determines both the axis and the sign
   * of a dismissing drag: a bottom sheet dismisses downward only, and an upward
   * drag on it is an overshoot to be resisted, not a gesture to be tracked.
   */
  axis: DragAxis;
  /** Called once the dismissing gesture has committed and the panel is off screen. */
  onDismiss: () => void;
  /**
   * Set false to make the panel inert: a sheet on a desktop pointer, or one
   * whose content scrolls in the same direction the panel would travel.
   */
  enabled?: boolean;
  /**
   * Fraction of the panel's own size past which a slow drag still dismisses,
   * for a drag that ends with no meaningful velocity. Velocity is the primary
   * signal; this is the fallback for a deliberate, slow push.
   */
  threshold?: number;
  /**
   * Speed, in px/s, at which a flick dismisses regardless of how far it got.
   * ~500px/s is a decisive flick and well clear of the drift at the end of a
   * slow drag, which lands under ~150.
   */
  velocityThreshold?: number;
}

export interface UseDragDismissResult {
  /** Attach to the panel node. */
  ref: (node: HTMLElement | null) => void;
  /** True while a finger is down and the panel is following it. */
  dragging: boolean;
  /**
   * Put on the panel as `data-dragging`. Styling hooks off this to suppress any
   * CSS transition on `transform` for the duration of the gesture, a transition
   * and a per-frame write fight each other and the panel lags the finger.
   */
  dataDragging: '' | undefined;
}

/** Which way, along its axis, a panel travels to leave. */
const dismissSign: Record<DragAxis, 1 | -1> = {
  bottom: 1,
  right: 1,
  top: -1,
  left: -1,
};

/** One sample of where the pointer was, and when. */
interface PointerSample {
  at: number;
  position: number;
}

/**
 * Everything the gesture needs between one pointer event and the next.
 *
 * Declared rather than inferred from the initial value: inferring it means
 * `null` widens to `null` and `[]` widens to `never[]`, so both fields need an
 * assertion to say what they will hold later. A named type says it once, and
 * the initialiser is then checked against it instead of defining it.
 */
interface GestureState {
  active: boolean;
  pointerId: number;
  /** Pointer position, along the drag axis, where the gesture began. */
  start: number;
  /** Any offset the panel already had when it was grabbed. */
  offset: number;
  /** The panel's extent along the drag axis, for threshold and rubber-banding. */
  size: number;
  committed: boolean;
  /** Where the pointer went down, kept so the scroll check can run at commit. */
  origin: Element | null;
  /*
   * A short position history rather than one previous point. Velocity from the
   * last two events is dominated by whatever jitter that pair happened to
   * catch, and on a finger that has come to rest before lifting, the last two
   * points are identical and report zero, throwing away a genuine flick.
   */
  history: PointerSample[];
}

const isVertical = (axis: DragAxis): boolean => axis === 'bottom' || axis === 'top';

/**
 * How far the nearest scrollable ancestor is from its edge, in the direction
 * this drag would dismiss.
 *
 * A panel almost always contains a scrolling body, and the two gestures are the
 * same gesture: one finger moving down a bottom sheet. Which one should win
 * depends entirely on where that body is already scrolled to.
 *
 * The rule every native sheet uses: the content scrolls until it reaches its
 * edge, and only then does the panel start to move. Dragging down through a
 * list that is scrolled halfway must scroll it, not dismiss the sheet, and a
 * panel that dismisses out from under a half-read list is the single most
 * jarring thing a bottom sheet can do.
 *
 * Returns 0 when there is nothing scrolled, which is the case that allows the
 * drag.
 */
function scrollRoomBefore(target: Element | null, boundary: Element, axis: DragAxis): number {
  const vertical = isVertical(axis);
  // `Element`, not `HTMLElement`: the scroll properties this reads all live on
  // `Element`, and a drag can legitimately start on an SVG node, an icon inside
  // a row, which is an `Element` but not an `HTMLElement`.
  let element: Element | null = target;

  while (element && element !== boundary.parentElement) {
    const style = getComputedStyle(element);
    const overflow = vertical ? style.overflowY : style.overflowX;
    const scrollable = overflow === 'auto' || overflow === 'scroll';

    if (scrollable) {
      const position = vertical ? element.scrollTop : element.scrollLeft;
      const size = vertical ? element.clientHeight : element.clientWidth;
      const extent = vertical ? element.scrollHeight : element.scrollWidth;

      // Only the edge the drag moves *away from* matters. A bottom sheet
      // dismisses downward, so it is blocked by content scrolled down (room
      // above), and is free the moment that content is back at its top.
      return axis === 'bottom' || axis === 'right'
        ? position
        : Math.max(0, extent - size - position);
    }

    element = element.parentElement;
  }

  return 0;
}

export function useDragDismiss({
  axis,
  onDismiss,
  enabled = true,
  threshold = 0.35,
  velocityThreshold = 500,
}: UseDragDismissOptions): UseDragDismissResult {
  const [dragging, setDragging] = useState(false);
  const nodeRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);

  /*
   * Gesture state lives in a ref, not in state. It is read and written inside
   * pointer handlers and animation frames, both of which need the current value
   * synchronously; a state variable would hand them the value from the render
   * that installed the handler.
   */
  const gesture = useRef<GestureState>({
    active: false,
    pointerId: -1,
    start: 0,
    offset: 0,
    size: 0,
    committed: false,
    origin: null,
    history: [],
  });

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  /*
   * The offset last written to the node, in px along the dismissing axis.
   *
   * Kept next to the DOM write so a gesture that interrupts a settle can resume
   * from exactly where the panel is, without having to read the transform back
   * out of the computed style.
   */
  const offsetRef = useRef(0);

  const write = useCallback(
    (node: HTMLElement, offset: number) => {
      offsetRef.current = offset;
      // Always a translate on the dismissing axis, and always in px, so the
      // value composes with whatever the stylesheet set as the resting
      // transform without either having to know about the other.
      const px = `${offset.toFixed(2)}px`;
      node.style.transform = isVertical(axis)
        ? `translate3d(0, ${px}, 0)`
        : `translate3d(${px}, 0, 0)`;
    },
    [axis],
  );

  /** Velocity in px/s from the tail of the history, signed along the axis. */
  const readVelocity = useCallback((): number => {
    const { history } = gesture.current;
    const last = history.at(-1);
    const oldest = history.at(0);
    if (!last || !oldest || history.length < 2) return 0;

    /*
     * Measure over a ~70ms window. Long enough to average out jitter, short
     * enough that it reports the *end* of the gesture rather than its average,
     * a drag that travelled far and then stopped must read as stopped.
     */
    let first = oldest;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const sample = history[i];
      if (!sample) continue;
      first = sample;
      if (last.at - first.at >= 70) break;
    }

    const elapsed = last.at - first.at;
    if (elapsed <= 0) return 0;
    return ((last.position - first.position) / elapsed) * 1000;
  }, []);

  /**
   * Spring the panel to `target`, carrying `velocity` in.
   *
   * `onArrive` fires only if the spring is allowed to finish. A new pointer-down
   * cancels the frame loop, which is what makes a closing panel grabbable
   * mid-flight: the element keeps whatever transform it had reached, and the
   * next gesture starts from there.
   */
  const settle = useCallback(
    (from: number, target: number, velocity: number, onArrive?: () => void) => {
      const node = nodeRef.current;
      if (!node) return;

      // Bounce only when the gesture actually carried momentum. Overshoot on a
      // panel that was released at rest reads as a bug rather than as physics.
      const config = Math.abs(velocity) > 200 ? springs.flick : springs.drawer;
      let state: SpringState = { x: from, v: velocity };
      let previous = performance.now();

      const tick = (now: number): void => {
        // Clamp the delta. A backgrounded tab resumes with a multi-second gap,
        // and an unclamped step teleports the panel instead of animating it.
        const dt = Math.min((now - previous) / 1000, 1 / 30);
        previous = now;

        state = stepSpring(state, target, config, dt);
        write(node, state.x);

        if (isSpringSettled(state, target)) {
          write(node, target);
          frameRef.current = null;
          onArrive?.();
          return;
        }

        frameRef.current = requestAnimationFrame(tick);
      };

      cancelFrame();
      frameRef.current = requestAnimationFrame(tick);
    },
    [cancelFrame, write],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      const node = nodeRef.current;
      if (!node) return;

      // Primary pointer only. Without this, a second finger arriving mid-drag
      // is treated as a new grab and the panel jumps to it.
      if (gesture.current.active || !event.isPrimary) return;

      // A drag has to start on the panel's own chrome, never on a control or a
      // text selection inside it. A sheet whose form fields are also drag
      // handles is a sheet that cannot be filled in.
      const target = elementFrom(event.target);
      if (target?.closest('[data-no-drag], input, textarea, select, button, a, [role="button"]')) {
        return;
      }

      const rect = node.getBoundingClientRect();
      const position = isVertical(axis) ? event.clientY : event.clientX;

      cancelFrame();

      /*
       * Start from the offset the panel currently has, not from zero. If this
       * pointer-down interrupted a settle, the panel is mid-flight, and starting
       * from zero would snap it back to rest before it began following the
       * finger, which is the visible jump that makes an interruptible animation
       * feel broken.
       *
       * Read from our own bookkeeping rather than from the computed transform.
       * Parsing it back out would mean `DOMMatrix`, which does not exist in
       * jsdom, so every consumer's component test would throw the moment it
       * rendered a sheet. This value is also exact, where a round-trip through
       * a matrix string is not.
       */
      const already = offsetRef.current;

      gesture.current = {
        active: true,
        pointerId: event.pointerId,
        start: position,
        // The grab offset. Subtracting it is what keeps the point under the
        // finger the point that was grabbed.
        offset: already,
        size: isVertical(axis) ? rect.height : rect.width,
        committed: false,
        // Kept so the scroll check below can run at commit time rather than
        // now: whether the content or the panel should move depends on which
        // way the finger went, and at pointer-down that is not yet known.
        origin: target,
        history: [{ at: event.timeStamp, position }],
      };
    },
    [axis, cancelFrame],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const node = nodeRef.current;
      const g = gesture.current;
      if (!node || !g.active || event.pointerId !== g.pointerId) return;

      const position = isVertical(axis) ? event.clientY : event.clientX;
      g.history.push({ at: event.timeStamp, position });
      // Six samples spans well over the 70ms the velocity window needs at any
      // real pointer rate, and keeps the array from growing for a long drag.
      if (g.history.length > 6) g.history.shift();

      const travelled = position - g.start + g.offset;
      const sign = dismissSign[axis];
      // Positive means "toward the closed edge", whichever edge that is, so the
      // rest of the maths does not branch per axis.
      const along = travelled * sign;

      if (!g.committed) {
        /*
         * ~8px of hysteresis before committing. Below that this is a tap, and
         * claiming the pointer immediately would swallow clicks on the panel's
         * own header.
         */
        if (Math.abs(along) < 8) return;

        /*
         * The content gets first refusal. Now that the direction is known, a
         * dismissing drag that started inside a scrolled body belongs to that
         * body, so this gesture stands down for the rest of the pointer's life
         * rather than fighting it frame by frame.
         *
         * Deliberately checked once, at commit, and not re-checked afterwards.
         * A drag that has legitimately started must not be interrupted the
         * moment the content happens to reach its edge mid-gesture, that would
         * hand the panel to the finger halfway through a scroll.
         */
        if (along > 0 && scrollRoomBefore(g.origin, node, axis) > 0) {
          g.active = false;
          return;
        }

        g.committed = true;
        // Capture, so tracking survives the finger leaving the panel's bounds.
        node.setPointerCapture(event.pointerId);
        setDragging(true);
      }

      // Past the open position the panel is being pulled away from its edge,
      // which is an overshoot: follow the finger, but with resistance, and never
      // let it detach from the edge it is anchored to.
      const resolved = along >= 0 ? along : -rubberband(Math.abs(along), g.size);

      write(node, resolved * sign);
    },
    [axis, write],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const node = nodeRef.current;
      const g = gesture.current;
      if (!node || !g.active || event.pointerId !== g.pointerId) return;

      const wasCommitted = g.committed;
      g.active = false;
      g.committed = false;
      setDragging(false);

      if (!wasCommitted) return;

      const sign = dismissSign[axis];
      const velocity = readVelocity() * sign;
      const position = isVertical(axis) ? event.clientY : event.clientX;
      const current = (position - g.start + g.offset) * sign;

      /*
       * Decide from where the gesture was *going*, not from where it stopped.
       * Projecting the release velocity forward is what makes a short flick
       * dismiss and a long slow drag that eased off at the end stay put, which
       * is the behaviour of every scroll view the user has ever touched.
       */
      const projected = current + projectMomentum(velocity);
      const dismissing =
        velocity > velocityThreshold ||
        (velocity > -velocityThreshold && projected > g.size * threshold);

      if (dismissing) {
        settle(current * sign, g.size * sign, velocity * sign, onDismiss);
      } else {
        settle(current * sign, 0, velocity * sign);
      }
    },
    [axis, onDismiss, readVelocity, settle, threshold, velocityThreshold],
  );

  /*
   * The node goes through state as well as a ref. The ref is what the pointer
   * handlers and the frame loop read synchronously; the state is what makes the
   * listener effect below re-run when the panel actually mounts or remounts.
   *
   * A ref alone does not, because assigning `ref.current` is not a render. The
   * effect would run once against whatever the ref happened to hold and then
   * never rebind, which for a sheet, portalled and mounted only while open, is
   * every time it opens after the first.
   */
  const [node, setNode] = useState<HTMLElement | null>(null);

  const ref = useCallback((next: HTMLElement | null) => {
    nodeRef.current = next;
    setNode(next);
  }, []);

  useEffect(() => {
    if (!node || !enabled) return;

    // A fresh node is at rest by definition. Without this, a panel dismissed by
    // a swipe and then reopened would resume from the off-screen offset the
    // previous gesture left behind and be invisible.
    offsetRef.current = 0;

    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('pointermove', onPointerMove);
    node.addEventListener('pointerup', onPointerUp);
    // A cancel (the OS taking over for a system gesture, or the element being
    // removed) has to return the panel to rest, or it stays stuck mid-drag.
    node.addEventListener('pointercancel', onPointerUp);

    return () => {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);
    };
  }, [enabled, node, onPointerDown, onPointerMove, onPointerUp]);

  useEffect(() => cancelFrame, [cancelFrame]);

  return { ref, dragging, dataDragging: dragging ? '' : undefined };
}
