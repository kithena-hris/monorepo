import { DocsContainer } from '@storybook/addon-docs/blocks';
import type { Decorator, Preview } from '@storybook/react-vite';
import { TooltipProvider, ToastProvider } from '@reach/ui';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

import { darkDocsTheme, lightDocsTheme } from './manager-theme';
import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events';
import { addons } from 'storybook/preview-api';

import './preview.css';

/**
 * Puts the theme class on `<html>` from the channel, not only from the
 * decorator.
 *
 * `withThemeByClassName` below is a decorator, and decorators only run when a
 * story renders. An MDX page that declares no stories never runs one, so the
 * docs canvas kept whatever class the last story happened to leave behind:
 * open Welcome straight from a link and it was light regardless of the toolbar,
 * open it after viewing a story and it was dark while Storybook's own docs
 * chrome stayed white. Globals cross the channel on every page, so this is the
 * signal that is always there.
 *
 * The decorator stays. It is what registers the toolbar control, and having
 * both write the same class is harmless.
 */
const channel = addons.getChannel();
/*
 * Seeded from the document, which the inline script in `main.ts` has already
 * set before this module ran. Starting at a guess of `light` would make the
 * first channel message look like a change and rewrite the class for nothing.
 */
let appliedTheme: 'light' | 'dark' = document.documentElement.classList.contains('dark')
  ? 'dark'
  : 'light';
const themeListeners = new Set<() => void>();

const applyThemeClass = (payload: { globals?: Record<string, unknown> }): void => {
  const next = payload.globals?.['theme'] === 'dark' ? 'dark' : 'light';
  if (next === appliedTheme) return;
  appliedTheme = next;
  document.documentElement.classList.toggle('dark', next === 'dark');
  // Kept in step with the inline script in `main.ts`. Without it the canvas
  // outside the stylesheet's reach reverts to light on the next navigation.
  document.documentElement.style.colorScheme = next;
  for (const listener of themeListeners) listener();
};

/**
 * The current theme, for React code inside the preview.
 *
 * `useSyncExternalStore` rather than state plus an effect: the value already
 * lives outside React, and mirroring it into state would render the docs page
 * once with the old theme before correcting itself.
 */
// Hoisted, not inline. `useSyncExternalStore` re-subscribes whenever the
// subscribe function changes identity, so an arrow defined in the component
// body tears down and rebuilds the subscription on every render of every docs
// page.
const subscribeToTheme = (listener: () => void): (() => void) => {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
};
const readTheme = (): 'light' | 'dark' => appliedTheme;
const readThemeOnServer = (): 'light' | 'dark' => 'light';

function useThemeGlobal(): 'light' | 'dark' {
  return useSyncExternalStore(subscribeToTheme, readTheme, readThemeOnServer);
}

/**
 * The docs canvas, themed from the same tokens as everything else.
 *
 * Storybook renders a docs page with its own theme, entirely separate from the
 * preview inside it. Left alone it stays light: the props tables, the source
 * blocks and the page background keep a white that no amount of CSS in here
 * should have to chase. An earlier version did chase it, through about seventy
 * rules matched against Storybook's own class names, and still missed the
 * argument tables on Popover, Money and Kbd.
 *
 * `DocsContainer` accepts a theme. Handing it one built from the same snapshot
 * the manager uses themes every block at once, costs nothing at runtime, and
 * has no specificity to lose.
 */
function ReachDocsContainer({
  children,
  ...props
}: { children?: ReactNode } & Record<string, unknown>): React.JSX.Element {
  const theme = useThemeGlobal();
  return (
    // @ts-expect-error `DocsContainer` requires the docs `context`, which
    // Storybook passes through at runtime and does not type on this boundary.
    <DocsContainer {...props} theme={theme === 'dark' ? darkDocsTheme : lightDocsTheme}>
      {children}
    </DocsContainer>
  );
}
channel.on(SET_GLOBALS, applyThemeClass);
channel.on(GLOBALS_UPDATED, applyThemeClass);

/**
 * Every Radix tooltip needs a provider above it, and every `useToast` call
 * needs a toast provider. Putting both here means a story never has to
 * remember, and the shared delay stays consistent across the docs.
 */
const withProviders: Decorator = (Story) => (
  <TooltipProvider delayDuration={200}>
    <ToastProvider>
      <Story />
    </ToastProvider>
  </TooltipProvider>
);

/**
 * Platform and density are attributes on `<html>`, exactly as an app sets
 * them: the type scale keys off the root font size, so a wrapper `<div>`
 * would show the control heights change and the type stay put, the one
 * combination that never ships.
 */
const withPlatform: Decorator = (Story, context) => {
  // Storybook types globals loosely, so these arrive as `unknown`. A typeof
  // check costs nothing and means a toolbar misconfigured to yield a non-string
  // cannot reach `setAttribute`.
  const platform = typeof context.globals['platform'] === 'string' ? context.globals['platform'] : undefined;
  const density = typeof context.globals['density'] === 'string' ? context.globals['density'] : undefined;

  useEffect(() => {
    const root = document.documentElement;
    if (platform && platform !== 'web') root.setAttribute('data-platform', platform);
    else root.removeAttribute('data-platform');

    if (density && density !== 'default') root.setAttribute('data-density', density);
    else root.removeAttribute('data-density');
  }, [platform, density]);

  return <Story />;
};

/**
 * The device matrix this system is held to. These are CSS pixel sizes, which
 * is what a layout responds to, an iPhone 15 Pro is 1179 physical pixels and
 * 393 CSS pixels, and only the second number matters here.
 *
 * The TV entries pair with the `platform: tv` toolbar: 1920 alone is a desk
 * monitor, and the difference is the 1.5× scale and the focus ring, not the
 * width.
 */
const devices = {
  iphoneSE: {
    name: 'iPhone SE. 375×667',
    styles: { width: '375px', height: '667px' },
    type: 'mobile',
  },
  iphone15: {
    name: 'iPhone 15 Pro. 393×852',
    styles: { width: '393px', height: '852px' },
    type: 'mobile',
  },
  iphone15Max: {
    name: 'iPhone 15 Pro Max. 430×932',
    styles: { width: '430px', height: '932px' },
    type: 'mobile',
  },
  iphoneLandscape: {
    name: 'iPhone landscape. 852×393',
    styles: { width: '852px', height: '393px' },
    type: 'mobile',
  },
  ipadMini: {
    name: 'iPad mini. 744×1133',
    styles: { width: '744px', height: '1133px' },
    type: 'tablet',
  },
  ipadPro11: {
    name: 'iPad Pro 11". 834×1194',
    styles: { width: '834px', height: '1194px' },
    type: 'tablet',
  },
  ipadPro13Landscape: {
    name: 'iPad Pro 13" landscape. 1366×1024',
    styles: { width: '1366px', height: '1024px' },
    type: 'tablet',
  },
  laptop: {
    name: 'Laptop. 1280×800',
    styles: { width: '1280px', height: '800px' },
    type: 'desktop',
  },
  desktop: {
    name: 'Desktop. 1680×1050',
    styles: { width: '1680px', height: '1050px' },
    type: 'desktop',
  },
  tv1080p: {
    name: 'TV 1080p. 1920×1080',
    styles: { width: '1920px', height: '1080px' },
    type: 'desktop',
  },
  tv4k: {
    name: 'TV 4K @1.5×. 2560×1440',
    styles: { width: '2560px', height: '1440px' },
    type: 'desktop',
  },
};

const preview: Preview = {
  decorators: [withProviders, withPlatform],
  globalTypes: {
    /*
     * The theme is ours rather than `@storybook/addon-themes`'s.
     *
     * That addon supplies the switcher through a decorator, and a decorator
     * runs only when a story renders: it never reached an MDX page, and on a
     * story it re-applied the class about a second after the click, at the end
     * of a full re-render. The class is now written straight from the channel
     * the moment the global changes, which is roughly 6ms, and this entry is
     * what puts the control in the toolbar. It matches how `platform` and
     * `density` already work here.
     */
    theme: {
      description: 'Colour scheme. Writes the `dark` class to `<html>`, as an app does.',
      // No `toolbar` here: a two-value menu costs a click for nothing. The
      // control is a single-press toggle registered in `manager.tsx`.
    },
    platform: {
      description: 'Declared platform. Drives control size, type scale and the focus ring.',
      toolbar: {
        title: 'Platform',
        icon: 'browser',
        items: [
          { value: 'web', title: 'Web / mobile' },
          { value: 'tv', title: 'Television (10-foot)' },
        ],
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Row and control density. Independent of the tap-target floor.',
      toolbar: {
        title: 'Density',
        icon: 'component',
        items: [
          { value: 'default', title: 'Default' },
          { value: 'compact', title: 'Compact' },
          { value: 'spacious', title: 'Spacious' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
    platform: 'web',
    density: 'default',
  },
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
      expanded: true,
      sort: 'requiredFirst',
    },
    a11y: {
      // Report violations in the panel and fail the test run. A story that
      // cannot pass axe is a component that will not pass a procurement review.
      test: 'error',
    },
    viewport: { options: devices },
    options: {
      storySort: {
        order: [
          'Welcome',
          'Foundations',
          ['Tokens', 'Motion', 'Responsive', 'Patterns'],
          'Layouts',
          ['Presets', 'Hierarchical', 'Modal page'],
          'Forms',
          [
            'Field',
            'Input',
            'NumberField',
            'PasswordField',
            'PinInput',
            'TagsInput',
            'Rating',
            'Select',
            'Combobox',
            'Checkbox',
            'RadioGroup',
            'Switch',
            'Toggle',
            'Slider',
            'Calendar',
            'DatePicker',
            'Typed fields',
            'ImageUploader',
            'Dropzone',
            'RichTextEditor',
          ],
          'Charts',
          [
            'Overview',
            'Bar',
            'Trend',
            'Distribution',
            'Heatmap',
            'Funnel',
            'Timeline',
            'Org chart',
            'Movement',
            'Pay',
          ],
          'Components',
          'Icons',
          '*',
        ],
      },
    },
    backgrounds: { disable: true },
    docs: { toc: true, container: ReachDocsContainer },
  },
  tags: ['autodocs'],
};

export default preview;
