import { t } from '../i18n';

/** Attendance's title and line, the same on each of its tabs, where no host frames the screen. */
export const ATTENDANCE = (): { readonly title: string; readonly description: string } => ({
  title: t('attendance.section.title', 'Attendance'),
  description: t('attendance.section.description', 'Clocked hours, breaks and overtime'),
});
