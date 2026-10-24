import type { SettingsModule } from '../components/settings-index';
import { moduleName } from './activity';
import type { ShellData } from './shell-data';
import { t } from './t';

type Place = SettingsModule['settings'][number];

/**
 * A module's own Activity log, last among its settings: the company's log
 * (`docs/audit.md`) filtered to that module, which its administrators read.
 */
const activityOf = (module: string): Place => ({
  path: `/settings/activity?module=${module}`,
  label: t('lib.settings-modules.activity_log', 'Activity log'),
  description: t(
    'lib.settings-modules.who_did_what_in_module',
    'Who did what in {{module}}, and when. Never the values themselves.',
    { module: moduleName(module) },
  ),
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
      title: t('lib.settings-modules.people', 'People'),
      description: t(
        'lib.settings-modules.your_employee_records_what_they_hold',
        'Your employee records: what they hold, who can see and change them, and where they go.',
      ),
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
      title: t('lib.settings-modules.time_off', 'Time off'),
      description: t(
        'lib.settings-modules.leave_types_holidays_and_attendance_how',
        'Leave types, holidays and attendance: how time off is earned, asked for and approved.',
      ),
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
      title: t('lib.settings-modules.documents', 'Documents'),
      description: t(
        'lib.settings-modules.your_signature_document_types_who_sees',
        'Your signature, document types, who sees what, and how long it is kept.',
      ),
      settings: [
        {
          path: '/settings/documents/signature',
          label: t('lib.settings-modules.your_signature', 'Your signature'),
          description: t(
            'lib.settings-modules.the_signature_your_documents_are_signed',
            'The signature your documents are signed with: typed or drawn, kept here.',
          ),
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
      title: t('lib.settings-modules.recruiting', 'Recruiting'),
      description: t(
        'lib.settings-modules.your_careers_page_the_hiring_rules',
        'Your careers page, the hiring rules, pipelines and approvals, scorecards, pay and benefits.',
      ),
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
      title: t('lib.settings-modules.onboarding', 'Onboarding'),
      description: t(
        'lib.settings-modules.who_does_hrs_and_its_onboarding',
        'Who does HR’s and IT’s onboarding tasks, holidays, and the country of a People hire.',
      ),
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
      title: t('lib.settings-modules.performance', 'Performance'),
      description: t(
        'lib.settings-modules.the_scale_reviews_feedback_goals_learning',
        'The scale, reviews, feedback, goals, learning, calibration, AI and who sees what.',
      ),
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
      title: t('lib.settings-modules.activity', 'Activity'),
      description: t(
        'lib.settings-modules.who_did_what_and_when_across',
        'Who did what, and when, across every module your company has.',
      ),
      settings: [
        {
          path: '/settings/activity',
          label: t('lib.settings-modules.activity_log', 'Activity log'),
          description: t(
            'lib.settings-modules.settings_changes_imports_and_exports_sensitive',
            'Settings changes, imports and exports, sensitive access and Kithena support’s sign-ins, with filters.',
          ),
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
    title: t('lib.settings-modules.you', 'You'),
    description: t(
      'lib.settings-modules.how_the_app_works_for_you',
      'How the app works for you. Only you see and change these.',
    ),
    settings: [
      {
        path: '/settings/notifications',
        label: t('lib.settings-modules.notifications', 'Notifications'),
        description: t(
          'lib.settings-modules.where_your_tasks_and_updates_reach',
          'Where your tasks and updates reach you: phone, email, quiet hours.',
        ),
        icon: 'notifications',
        now: null,
        attention: null,
      },
      {
        path: '/settings/shortcuts',
        label: t('lib.settings-modules.keyboard_shortcuts', 'Keyboard shortcuts'),
        description: t(
          'lib.settings-modules.the_keys_that_take_you_somewhere',
          'The keys that take you somewhere, and whether single keys work at all.',
        ),
        icon: 'shortcuts',
        now: shortcutsNow,
        attention: null,
      },
    ],
  });
  return modules;
}
