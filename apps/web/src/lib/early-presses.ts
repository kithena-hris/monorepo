/*
 * A press on a remote's screen before it can answer, held and then answered.
 *
 * After a full load the screen is the server's HTML (`remote-screen.tsx`), and
 * it does nothing until the remote's code has loaded and React has hydrated
 * it — 300–500 ms, longer on a slow phone. React does not cover that window:
 *
 * - Before the shell's own bundle has run, nothing listens at all.
 * - After it, the remote's root listens, but a discrete event on a boundary
 *   that is still dehydrated only makes React try to hydrate it at once. With
 *   the code not loaded that attempt suspends again, and React then stops the
 *   event's propagation and drops it: React 18 and 19 no longer replay
 *   discrete events (only hover and focus are queued). The browser's default
 *   still runs, so a submit button submits the form natively.
 * - React's own replay of early form submissions is for a `<form action={fn}>`
 *   streamed by React's server renderer with its inline runtime. The remote's
 *   HTML is `renderToString` in another process and its forms use `onSubmit`.
 *
 * So the shell holds the first press itself. `holdEarlyPresses` runs inline in
 * `<head>` (`app/layout.tsx`), before any markup: a click on a control inside
 * a remote container still marked `data-hydrating` is stopped before the
 * browser or React acts on it, and kept on the container. When the remote's
 * root commits its hydration it calls `releaseEarlyPresses`, which hands over
 * what was typed and then replays the press on the same element — the same
 * node if hydration kept it, the same place in the tree if it did not — as the
 * sequence of events a real press makes, so a handler on `pointerdown`,
 * `mousedown` or `click` each sees it once. Keyboard presses arrive here as
 * the click the browser makes from Enter or Space.
 *
 * One press per screen: a second one while the first waits is dropped, since
 * replaying both would save twice. After hydration the container is no longer
 * marked and none of this runs.
 */

/** On a remote's container while its server HTML waits for the remote's code. */
export const WAITING = 'data-hydrating';
/** The expando on the container holding its press. */
const HELD = '__heldPress';

interface Press {
  readonly target: Element;
  /** Child indexes from the container to the target, for when hydration replaced it. */
  readonly path: readonly number[];
  readonly kind: 'click' | 'submit';
  readonly pointerType: string;
  readonly submitter: HTMLElement | null;
  /** The target's own `aria-busy`, put back when the press is replayed. */
  readonly busy: string | null;
  /** Whether the press left the focus on it. */
  readonly focused: boolean;
}

/**
 * Installed in the page as source, by `toString()`: it may use nothing but its
 * arguments and the browser's globals.
 */
export function holdEarlyPresses(doc: Document, waiting: string, held: string): void {
  // What a press activates. Not a text field: focusing and typing work
  // natively, and `releaseEarlyPresses` hands the value over. Not a file
  // input: its picker needs the press itself.
  const control =
    'a[href],button,summary,input[type=checkbox],input[type=radio],input[type=submit],input[type=button],input[type=reset],input[type=image],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=switch],[role=checkbox],[role=radio],[role=option],[role=combobox]';
  let pointerType = 'mouse';
  const waitingFor = (target: EventTarget | null): Element | null => {
    const at = target instanceof Element ? target.closest('[data-remote]') : null;
    return at !== null && at.hasAttribute(waiting) ? at : null;
  };
  const hold = (
    event: Event,
    container: Element,
    target: Element,
    kind: 'click' | 'submit',
    submitter: HTMLElement | null,
  ): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const box = container as unknown as Record<string, unknown>;
    if (box[held] !== undefined) return;
    const path: number[] = [];
    for (
      let n: Element = target;
      n !== container && n.parentElement !== null;
      n = n.parentElement
    ) {
      path.unshift(Array.prototype.indexOf.call(n.parentElement.children, n));
    }
    box[held] = {
      target,
      path,
      kind,
      pointerType,
      submitter,
      busy: target.getAttribute('aria-busy'),
      focused: doc.activeElement === target,
    } satisfies Press;
    // Pressed, and seen to be: dimmed in place, never moved (`globals.css`).
    target.setAttribute('data-early-press', '');
    target.setAttribute('aria-busy', 'true');
  };
  doc.addEventListener(
    'pointerdown',
    (event) => {
      pointerType = event.pointerType || 'mouse';
    },
    true,
  );
  doc.addEventListener(
    'click',
    (event) => {
      const container = waitingFor(event.target);
      if (container === null) return;
      const target = (event.target as Element).closest(control);
      if (target === null || !container.contains(target)) return;
      // Opened in a new tab or window: the browser's, as ever.
      const mouse = event as MouseEvent;
      if (
        target.matches('a[href]') &&
        (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey)
      ) {
        return;
      }
      hold(event, container, target, 'click', null);
    },
    true,
  );
  // A form submitted without a click on a button: Enter in its only field.
  doc.addEventListener(
    'submit',
    (event) => {
      const container = waitingFor(event.target);
      if (container === null) return;
      hold(event, container, event.target as Element, 'submit', event.submitter);
    },
    true,
  );
}

/** The inline script for `<head>`. */
export const EARLY_PRESSES_SCRIPT = `(${holdEarlyPresses.toString()})(document,${JSON.stringify(WAITING)},${JSON.stringify(HELD)})`;

/**
 * A field typed into before hydration, handed to React.
 *
 * React keeps what is in the box when it hydrates, but a controlled field's
 * state is still the server's value, and React's change tracking records the
 * box as it found it, so no `onChange` follows: the screen would save what the
 * server sent. Setting the server's value through React's tracker and the
 * typed one past it makes the next `input` event a change React reports.
 */
function handOver(field: HTMLInputElement | HTMLTextAreaElement): void {
  if (field instanceof HTMLInputElement && field.type === 'file') {
    // A file chosen before hydration: React reads `change` on a file input as is.
    if ((field.files?.length ?? 0) > 0) field.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
    return; // Pressed, so held: never changed before hydration.
  }
  if (field.value === field.defaultValue) return;
  const typed = field.value;
  field.value = field.defaultValue;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field) as object, 'value')?.set?.call(
    field,
    typed,
  );
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A press as a person makes it: down, up, click — the compatibility mouse events unless down was cancelled. */
function replay(target: Element, press: Press): void {
  if (press.kind === 'submit') {
    if (target instanceof HTMLFormElement) target.requestSubmit(press.submitter);
    return;
  }
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerType: press.pointerType,
  };
  const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const down = target.dispatchEvent(new Pointer('pointerdown', init));
  if (down) target.dispatchEvent(new MouseEvent('mousedown', init));
  target.dispatchEvent(new Pointer('pointerup', { ...init, buttons: 0 }));
  if (down) target.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
  if (target instanceof HTMLElement) target.click();
  else target.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
}

/**
 * The remote's root has hydrated `container`: stop holding presses there, hand
 * over what was typed, and replay the press it held, if any.
 *
 * `answered: false` when the screen will never answer it — the remote failed
 * to load — and the press is let go rather than replayed.
 */
export function releaseEarlyPresses(container: Element, answered = true): void {
  if (!container.hasAttribute(WAITING)) return;
  container.removeAttribute(WAITING);
  const box = container as unknown as Record<string, unknown>;
  const press = box[HELD] as Press | undefined;
  box[HELD] = undefined;
  if (answered) {
    for (const field of container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    )) {
      handOver(field);
    }
  }
  if (press === undefined) return;
  const pressed = press.target;
  pressed.removeAttribute('data-early-press');
  if (press.busy === null) pressed.removeAttribute('aria-busy');
  else pressed.setAttribute('aria-busy', press.busy);
  if (!answered) return;
  let target: Element | null = pressed;
  if (!container.contains(pressed)) {
    // Hydration rebuilt the tree: the same place in the new one, and the
    // focus back on it if the press had put it there.
    target = container;
    for (const i of press.path) target = target?.children.item(i) ?? null;
    if (press.focused && target instanceof HTMLElement) target.focus({ preventScroll: true });
  }
  if (target === null) return;
  // After React has rendered what was handed over, so the press sees it.
  const at = target;
  setTimeout(() => {
    replay(at, press);
  }, 0);
}
