import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Toggle } from './shared';
import { t } from '../i18n';

/**
 * Adding a leave type (T29's "Add leave type", TOF-099a): its name, what kind
 * of time off it is, whether it draws a balance, how it is paid and what
 * teammates see. Time Off checks it again; the key is the name's, kept for
 * ever. A tracked type then wants a policy, which its page starts.
 */

type Category = 'annual_leave' | 'sick_leave' | 'parental_leave' | 'unpaid_leave' | 'other';

const CATEGORIES = (): readonly (readonly [Category, string, string])[] => [
  ['annual_leave', t('settings.add-leave-type.vacation', 'Vacation'), 'sun'],
  ['sick_leave', t('settings.add-leave-type.sick_leave', 'Sick leave'), 'thermometer'],
  ['parental_leave', t('settings.add-leave-type.parental_leave', 'Parental leave'), 'baby'],
  ['unpaid_leave', t('settings.add-leave-type.unpaid_leave', 'Unpaid leave'), 'circle-slash'],
  ['other', t('settings.add-leave-type.something_else', 'Something else'), 'flag'],
];

/** "Moving day" as `moving_day`: lowercase, underscores, starting with a letter. */
export const keyOf = (name: string): string =>
  name
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '')
    .replace(/^(\d)/u, 'x_$1')
    .slice(0, 63);

export interface NewLeaveType {
  readonly key: string;
  readonly name: { readonly default: string };
  readonly category: Category;
  readonly colorToken: string;
  readonly icon: string;
  readonly unit: 'day' | 'hour';
  readonly tracked: boolean;
  readonly paid: 'paid' | 'unpaid' | 'statutory';
  readonly visibility: 'type' | 'off_only';
}

export function AddLeaveType({
  onAdd,
  onClose,
}: {
  readonly onAdd: (
    definition: NewLeaveType,
  ) => Promise<
    { readonly ok: true; readonly key: string } | { readonly ok: false; readonly message: string }
  >;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('other');
  const [tracked, setTracked] = useState(true);
  const [hours, setHours] = useState(false);
  const [paid, setPaid] = useState<NewLeaveType['paid']>('paid');
  const [private_, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const key = keyOf(name);
  const save = (): void => {
    setBusy(true);
    setRefused(null);
    void onAdd({
      key,
      name: { default: name.trim() },
      category,
      colorToken: category === 'sick_leave' ? 'chart-3' : 'chart-4',
      icon: CATEGORIES().find(([c]) => c === category)?.[2] ?? 'flag',
      unit: hours ? 'hour' : 'day',
      tracked,
      paid,
      // Sick leave is always "Off" to teammates (§8.5).
      visibility: private_ || category === 'sick_leave' ? 'off_only' : 'type',
    }).then((outcome) => {
      setBusy(false);
      if (!outcome.ok) setRefused(outcome.message);
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('settings.add-leave-type.add_a_leave_type', 'Add a leave type')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'settings.add-leave-type.a_kind_of_time_off_people',
              'A kind of time off people can ask for. Its policy says how much they earn.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field required>
            <FieldLabel>{t('settings.add-leave-type.name', 'Name')}</FieldLabel>
            <FieldControl>
              <Input
                value={name}
                maxLength={100}
                placeholder={t(
                  'settings.add-leave-type.for_example_moving_day',
                  'For example, Moving day',
                )}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>
              {key === ''
                ? t(
                    'settings.add-leave-type.shown_to_everyone_who_can_book',
                    'Shown to everyone who can book it.',
                  )
                : t(
                    'settings.add-leave-type.kept_as_for_exports_and_integrations',
                    'Kept as “{{key}}” for exports and integrations.',
                    { key },
                  )}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t('settings.add-leave-type.kind', 'Kind')}</FieldLabel>
            <Select
              value={category}
              onValueChange={(c) => {
                setCategory(c as Category);
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {CATEGORIES().map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{t('settings.add-leave-type.how_it_is_paid', 'How it is paid')}</FieldLabel>
            <Select
              value={paid}
              onValueChange={(p) => {
                setPaid(p as NewLeaveType['paid']);
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="paid">
                  {t('settings.add-leave-type.paid_by_the_company', 'Paid by the company')}
                </SelectItem>
                <SelectItem value="unpaid">
                  {t('settings.add-leave-type.not_paid', 'Not paid')}
                </SelectItem>
                <SelectItem value="statutory">
                  {t('settings.add-leave-type.paid_by_social_security', 'Paid by Social Security')}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Toggle
            label={t('settings.add-leave-type.draws_a_balance', 'Draws a balance')}
            description={
              tracked
                ? t(
                    'settings.add-leave-type.people_earn_it_under_a_policy',
                    'People earn it under a policy and spend it',
                  )
                : t(
                    'settings.add-leave-type.off_booked_without_a_balance_like',
                    'Off: booked without a balance, like sick leave',
                  )
            }
            checked={tracked}
            onChange={setTracked}
          />
          {tracked ? (
            <Toggle
              kind="checkbox"
              label={t('settings.add-leave-type.counted_in_hours', 'Counted in hours')}
              description={t(
                'settings.add-leave-type.off_in_days_with_half_days',
                'Off: in days, with half days if the policy allows them',
              )}
              checked={hours}
              onChange={setHours}
            />
          ) : null}
          <Toggle
            kind="checkbox"
            label={t('settings.add-leave-type.teammates_see_only_off', 'Teammates see only “Off”')}
            description={
              category === 'sick_leave'
                ? t('settings.add-leave-type.always_for_sick_leave', 'Always, for sick leave')
                : t('settings.add-leave-type.off_they_see_the_type', 'Off: they see the type')
            }
            checked={private_ || category === 'sick_leave'}
            disabled={category === 'sick_leave'}
            onChange={setPrivate}
          />
          {refused === null ? null : (
            <Alert tone="danger" title={t('settings.add-leave-type.not_added', 'Not added')}>
              {refused}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{t('settings.add-leave-type.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            startIcon={<icons.add aria-hidden />}
            disabled={key === ''}
            loading={busy}
            loadingLabel={t('settings.add-leave-type.adding', 'Adding')}
            onClick={save}
          >
            {t('settings.add-leave-type.add_leave_type', 'Add leave type')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
