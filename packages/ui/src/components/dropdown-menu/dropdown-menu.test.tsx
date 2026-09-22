import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';

/**
 * The flicker.
 *
 * A hover-opened menu that is also modal cannot work, and the reason is one
 * line in `@radix-ui/react-dismissable-layer`:
 *
 *     if (disableOutsidePointerEvents) {
 *       ownerDocument.body.style.pointerEvents = 'none';
 *
 * `modal` drives `disableOutsidePointerEvents`. The trigger is not inside the
 * content, so the instant the menu opens the trigger stops receiving pointer
 * events — `pointerleave` fires on a pointer that has not moved, the close
 * timer runs, the body is restored, the pointer is found over the trigger
 * again, and it reopens. The sidebar profile menu did this for as long as
 * somebody's pointer was near their own name.
 *
 * Asserted on the body rather than by driving a pointer, because the body
 * style *is* the mechanism: no other part of this is in doubt, and a test that
 * chased the loop would be timing-dependent for nothing.
 */
function menu(
  /*
   * `modal: boolean | undefined`, and the `undefined` is not an oversight.
   *
   * `exactOptionalPropertyTypes` means a caller cannot *type* `modal:
   * undefined` against `DropdownMenuProps` — but it is what a caller spreading
   * an args object produces at runtime, which is precisely the case that used
   * to put Radix back on its modal default. The cast below is the test, so it
   * is here rather than hidden behind a helper that types the problem away.
   */
  props: { openOnHover?: boolean; modal?: boolean | undefined } = {},
) {
  return (
    <DropdownMenu defaultOpen {...(props as { openOnHover?: boolean; modal?: boolean })}>
      <DropdownMenuTrigger>Grace Hopper</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('DropdownMenu', () => {
  it('does not disable pointer events on the body when it opens on hover', async () => {
    render(menu({ openOnHover: true }));

    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });
    expect(document.body.style.pointerEvents).not.toBe('none');
  });

  /*
   * The other half. A menu that is not hover-opened stays modal, because that
   * is Radix's default and the reason to leave it alone: an ordinary menu is
   * dismissed by the click that lands outside it, and swallowing that click is
   * what stops the same press also activating whatever was underneath.
   */
  it('stays modal when it opens on click alone', async () => {
    render(menu());

    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });
    expect(document.body.style.pointerEvents).toBe('none');
  });

  /*
   * `undefined` means "not asked", not "asked for the default".
   *
   * This is how the first fix failed. `DropdownMenuProps` extends Radix's root
   * props, so `modal` is a prop a caller may name — and a caller that spreads
   * an object carrying `modal: undefined` used to put the default back and
   * restore the flicker. Storybook's args do exactly that for every documented
   * prop, which is how it was caught.
   */
  it('treats an undefined modal as unset rather than as true', async () => {
    render(menu({ openOnHover: true, modal: undefined }));

    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });
    expect(document.body.style.pointerEvents).not.toBe('none');
  });

  it('lets a caller ask for a modal hover menu anyway', async () => {
    render(menu({ openOnHover: true, modal: true }));

    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });
    expect(document.body.style.pointerEvents).toBe('none');
  });
});

/**
 * Hover is in addition, never instead — which the component's own
 * documentation says and the implementation had stopped doing.
 *
 * `onOpenAutoFocus` was prevented for every hover-capable menu, so one opened
 * with Enter opened and could not be entered: focus stayed on the trigger,
 * the arrow keys had nothing to move through, and Sign out was unreachable
 * without a pointer.
 */
describe('DropdownMenu keyboard access', () => {
  function hoverMenu() {
    return (
      <DropdownMenu openOnHover>
        <DropdownMenuTrigger>Grace Hopper</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  it('moves focus into a hover menu opened from the keyboard', async () => {
    const user = userEvent.setup();
    render(hoverMenu());

    await user.tab();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }));
    });
  });

  /*
   * And the half that has to stay true. A menu the pointer opened on its way
   * past must not take focus — that is somebody's caret, pulled out of a field
   * they were typing in by a gesture they did not mean as a command.
   */
  it('leaves focus alone when the pointer is what opened it', async () => {
    const user = userEvent.setup();
    render(hoverMenu());

    const trigger = screen.getByRole('button', { name: 'Grace Hopper' });
    await user.hover(trigger);

    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });
    expect(document.activeElement).not.toBe(screen.getByRole('menuitem', { name: 'Sign out' }));
  });
});
