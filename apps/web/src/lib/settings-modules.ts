import type { SettingsModule } from '../components/settings-index';
import type { ShellData } from './shell-data';

/** The People settings whose card says how each is set now (`peopleNow` on the Settings page). */
export const PEOPLE_NOW_PATHS = [
  '/settings/people/fields',
  '/settings/people/organisation',
  '/settings/people/roles',
  '/settings/people/integrations',
] as const;

/**
 * The Settings page's modules, in order: People's settings where this viewer
 * has any, Time Off's likewise, the activity log for People administrators and HR, and their own.
 *
 * One list for the page and for its loading state, which draws it from the
 * shell's copy with every "how it is set now" still to come: the same cards,
 * so the page arriving moves nothing.
 */
export function settingsModules(
  shell: Pick<ShellData, 'settings' | 'roles' | 'remotes'>,
  people: {
    readonly now: Readonly<Record<string, string | null>>;
    readonly attention: Readonly<Record<string, { badge: string; chip: string }>>;
  },
  shortcutsNow: string,
): SettingsModule[] {
  const modules: SettingsModule[] = [];
  if (shell.settings.length > 0) {
    modules.push({
      key: 'people',
      title: 'People',
      description:
        'Your employee records: what they hold, who can see and change them, and where they go.',
      settings: shell.settings.map((place) => ({
        path: place.path,
        label: place.label,
        description: place.description,
        icon: place.icon,
        now: people.now[place.path] ?? null,
        attention: people.attention[place.path] ?? null,
      })),
    });
  }

  // Time Off's settings, from its own manifest, where this viewer has any.
  const timeOff = shell.remotes?.['timeoff']?.settings ?? [];
  if (timeOff.length > 0) {
    modules.push({
      key: 'time-off',
      title: 'Time off',
      description:
        'Leave types, holidays and attendance: how time off is earned, asked for and approved.',
      settings: timeOff.map((place) => ({
        path: place.path,
        label: place.label,
        description: place.description,
        icon: place.icon,
        now: null,
        attention: null,
      })),
    });
  }

  // The company's activity log (`/settings/activity`): the shell's, across
  // modules, for whoever may read it — People administrators and HR.
  if (shell.roles.admin || shell.roles.hr) {
    modules.push({
      key: 'activity',
      title: 'Activity',
      description: 'Who did what, and when, across every module your company has.',
      settings: [
        {
          path: '/settings/activity',
          label: 'Activity log',
          description:
            'Settings changes, imports and exports, sensitive access and Kithena support’s sign-ins, with filters.',
          icon: 'history',
          now: null,
          attention: null,
        },
      ],
    });
  }

  // A person's own settings, after the company's: everybody has these.
  modules.push({
    key: 'you',
    title: 'You',
    description: 'How the app works for you. Only you see and change these.',
    settings: [
      {
        path: '/settings/shortcuts',
        label: 'Keyboard shortcuts',
        description: 'The keys that take you somewhere, and whether single keys work at all.',
        icon: 'shortcuts',
        now: shortcutsNow,
        attention: null,
      },
    ],
  });
  return modules;
}
