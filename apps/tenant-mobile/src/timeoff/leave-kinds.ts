import { t } from '../i18n';

/** The kinds of leave a type can be, with their glyph; and a type's key from its name. */
export const CATEGORIES = () =>
  [
    ['annual_leave', t('timeoff.leave-kinds.vacation', 'Vacation'), 'sun'],
    ['sick_leave', t('timeoff.leave-kinds.sick_leave', 'Sick leave'), 'thermometer'],
    ['parental_leave', t('timeoff.leave-kinds.parental_leave', 'Parental leave'), 'baby'],
    ['unpaid_leave', t('timeoff.leave-kinds.unpaid_leave', 'Unpaid leave'), 'circle-slash'],
    ['other', t('timeoff.leave-kinds.something_else', 'Something else'), 'flag'],
  ] as const;

export const keyOf = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
