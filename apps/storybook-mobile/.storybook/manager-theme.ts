import type { ThemeVars } from 'storybook/theming';

import { buildReachTheme } from '../../storybook/.storybook/manager-theme';

/**
 * The web Storybook's chrome theme, under the mobile library's name.
 *
 * Imported rather than copied: its colours are a resolved snapshot of the
 * tokens that `pnpm storybook:theme-drift` keeps honest, and a second snapshot
 * would need a second drift check.
 */
const named = (theme: ThemeVars): ThemeVars => ({ ...theme, brandTitle: 'Reach Mobile' });

export const lightTheme = named(buildReachTheme('light'));
export const darkTheme = named(buildReachTheme('dark'));
export const lightDocsTheme = buildReachTheme('light', false);
export const darkDocsTheme = buildReachTheme('dark', false);
