import type { SettingsModule } from '../components/settings-index';
import { moduleName } from './activity';
import type { ShellData } from './shell-data';

type Place = SettingsModule['settings'][number];

/**
 * A module's own Activity log, last among its settings: the company's log
 * (`docs/audit.md`) filtered to that module, which its administrators read.
 */
const activityOf = (module: string): Place => ({
  path: `/settings/activity?module=${module}`,
  label: 'Activity log',
  description: `Who did what in ${moduleName(module)}, and when. Never the values themselves.`,
  icon: 'history',
  now: null,
  attention: null,
});

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
      settings: [
        ...timeOff.map((place) => ({
          path: place.path,
          label: place.label,
          description: place.description,
          icon: place.icon,
          now: null,
          attention: null,
        })),
        activityOf('timeoff'),
      ],
    });
  }

  // Documents' settings, from its own manifest, and everybody's own signature.
  const documentsHere = shell.remotes?.['documents'] !== undefined;
  const docs = shell.remotes?.['documents']?.settings ?? [];
  if (documentsHere) {
    modules.push({
      key: 'documents',
      title: 'Documents',
      description: 'Your signature, document types, who sees what, and how long it is kept.',
      settings: [
        {
          path: '/settings/documents/signature',
          label: 'Your signature',
          description: 'The signature your documents are signed with: typed or drawn, kept here.',
          icon: 'edit',
          now: null,
          attention: null,
        },
        ...docs.map((place) => ({
          path: place.path,
          label: place.label,
          description: place.description,
          icon: place.icon,
          now: null,
          attention: null,
        })),
        ...(docs.length > 0 ? [activityOf('documents')] : []),
      ],
    });
  }

  // Recruiting's settings, from its own manifest, where this viewer has any.
  const recruiting = shell.remotes?.['recruiting']?.settings ?? [];
  if (recruiting.length > 0) {
    modules.push({
      key: 'recruiting',
      title: 'Recruiting',
      description:
        'How hiring runs: entities, pipelines, scorecards, pay bands, benefits and the careers page.',
      settings: [
        ...recruiting.map((place) => ({
          path: place.path,
          label: place.label,
          description: place.description,
          icon: place.icon,
          now: null,
          attention: null,
        })),
        activityOf('recruiting'),
      ],
    });
  }

  // Onboarding's settings, from its own manifest, where this viewer has any.
  const onboarding = shell.remotes?.['onboarding']?.settings ?? [];
  if (onboarding.length > 0) {
    modules.push({
      key: 'onboarding',
      title: 'Onboarding',
      description:
        'Who does HR’s and IT’s onboarding tasks, holidays, and the country of a People hire.',
      settings: [
        ...onboarding.map((place) => ({
          path: place.path,
          label: place.label,
          description: place.description,
          icon: place.icon,
          now: null,
          attention: null,
        })),
        activityOf('onboarding'),
      ],
    });
  }

  // Performance's settings, from its own manifest, where this viewer has any.
  const performanceSettings = shell.remotes?.['performance']?.settings ?? [];
  if (performanceSettings.length > 0) {
    modules.push({
      key: 'performance',
      title: 'Performance',
      description:
        'The scale, reviews, feedback, goals, learning, calibration, AI and who sees what.',
      settings: [
        ...performanceSettings.map((place) => ({
          path: place.path,
          label: place.label,
          description: place.description,
          icon: place.icon,
          now: null,
          attention: null,
        })),
        activityOf('performance'),
      ],
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
        path: '/settings/notifications',
        label: 'Notifications',
        description: 'Where your tasks and updates reach you: phone, email, quiet hours.',
        icon: 'notifications',
        now: null,
        attention: null,
      },
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
