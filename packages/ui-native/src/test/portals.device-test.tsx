import { PortalHost } from '@rn-primitives/portal';
import { act, type ReactNode } from 'react';
import { AppRegistry } from 'react-native';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  ActionSheetTrigger,
} from '../components/action-sheet/action-sheet.tsx';
import { Button } from '../components/button/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select/select.tsx';
import { ReachProvider } from '../provider.tsx';

/*
 * Overlays as a device draws them, in a browser.
 *
 * On the web the primitives portal through the DOM, which keeps React
 * context, so Storybook never sees what a phone does: `@rn-primitives`'
 * native builds send an overlay's content to a `PortalHost` at the app's
 * root, outside the component that opened it, and only the primitive's own
 * context goes with it. Here the native builds stand in for the web ones,
 * so a part that reads its parent's context across the portal fails as it
 * did on a phone ("SelectItem must be inside a Select.").
 */
vi.mock(
  '@rn-primitives/dialog',
  () => import('../../node_modules/@rn-primitives/dialog/dist/dialog.mjs'),
);
vi.mock(
  '@rn-primitives/dropdown-menu',
  () => import('../../node_modules/@rn-primitives/dropdown-menu/dist/dropdown-menu.mjs'),
);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The native builds move a screen reader's focus with `findNodeHandle`, which
// a phone has and react-native-web throws on, from a timer. That one error is
// stopped here, ahead of Vitest's own listener; any other still fails the run.
window.addEventListener(
  'error',
  (event) => {
    if (event.message.includes('findNodeHandle is not supported on web')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  { capture: true },
);

/** The app the test started, to stop: what react-native-web's `runApplication` hands back. */
let running: { readonly unmount: () => void } | null = null;

/**
 * `children` as the app, with the root portal host beside it as `ReachProvider`
 * has on a device: started the React Native way, which react-native-web runs
 * in this page, so nothing here imports the DOM's React.
 */
async function onDevice(children: ReactNode): Promise<void> {
  const tag = document.createElement('div');
  document.body.append(tag);
  const key = `device-${String(Date.now())}`;
  AppRegistry.registerComponent(key, () => () => (
    <ReachProvider theme="light">
      {children}
      <PortalHost />
    </ReachProvider>
  ));
  await act(async () => {
    // React Native's types say nothing comes back; on the web it is the app.
    running = (
      AppRegistry as unknown as {
        runApplication: (key: string, params: { rootTag: HTMLElement }) => { unmount: () => void };
      }
    ).runApplication(key, { rootTag: tag });
    await Promise.resolve();
  });
}

afterEach(() => {
  const app = running;
  if (app !== null) {
    act(() => {
      app.unmount();
    });
  }
  running = null;
  document.body.replaceChildren();
});

it('draws a Select’s options in the root portal host, and chooses one', async () => {
  const chosen = vi.fn();
  await onDevice(
    <Select defaultOpen onValueChange={chosen}>
      <SelectTrigger accessibilityLabel="Team">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {['Engineering', 'Design'].map((team) => (
          <SelectItem key={team} value={team}>
            {team}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>,
  );
  const design = page.getByRole('radio', { name: 'Design' });
  await expect.element(design).toBeVisible();
  await design.click();
  expect(chosen).toHaveBeenCalledWith('Design');
});

it('draws a menu-style ActionSheet’s actions in the root portal host, and runs one', async () => {
  const archived = vi.fn();
  await onDevice(
    <ActionSheet presentation="menu" defaultOpen>
      <ActionSheetTrigger>
        <Button>More</Button>
      </ActionSheetTrigger>
      <ActionSheetContent label="More actions">
        <ActionSheetItem onSelect={archived}>Archive</ActionSheetItem>
      </ActionSheetContent>
    </ActionSheet>,
  );
  const archive = page.getByRole('menuitem', { name: 'Archive' });
  await expect.element(archive).toBeVisible();
  await archive.click();
  expect(archived).toHaveBeenCalledTimes(1);
});
