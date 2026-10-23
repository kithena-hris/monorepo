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
  List,
  ListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  icons,
  DatePicker,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';
import { keyOf } from './add-leave-type';
import { Toggle, shortDate } from './shared';
import { t } from '../i18n';

/**
 * One holiday calendar, new or changed (T36's "Add calendar", TOF-099a): its
 * name, whether it is national, regional or a city's, whether a holiday on a
 * weekend moves to Monday, and its days in the year on show. Other years'
 * days are kept as they are. Time Off checks every day again.
 */

export interface Layer {
  readonly key: string;
  readonly name: string;
  readonly level: 'national' | 'regional' | 'city';
  readonly weekendRule: 'move_to_monday' | 'none';
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
}

export function HolidayCalendar({
  layer,
  year,
  onSave,
  onRemove,
  onClose,
}: {
  /** `null` for a new one. */
  readonly layer: Layer | null;
  readonly year: number;
  readonly onSave: (key: string, layer: Omit<Layer, 'key'>) => Promise<Outcome>;
  readonly onRemove?: (key: string) => Promise<Outcome>;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(layer?.name ?? '');
  const [level, setLevel] = useState<Layer['level']>(layer?.level ?? 'city');
  const [moves, setMoves] = useState(layer?.weekendRule === 'move_to_monday');
  const [days, setDays] = useState(layer?.holidays ?? []);
  const [date, setDate] = useState('');
  const [dayName, setDayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const key = layer?.key ?? keyOf(name);
  const shown = days
    .filter((d) => d.date.startsWith(String(year)))
    .toSorted((a, b) => a.date.localeCompare(b.date));
  const act = (run: () => Promise<Outcome>): void => {
    setBusy(true);
    setRefused(null);
    void run().then((outcome) => {
      setBusy(false);
      if (outcome.ok) onClose();
      else setRefused(outcome.message);
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
            {layer === null
              ? t('settings.holiday-calendar.add_a_calendar', 'Add a calendar')
              : layer.name}
          </DialogTitle>
          <DialogDescription>
            {t(
              'settings.holiday-calendar.its_days_in_a_location_keeps',
              'Its days in {{year}}. A location keeps it once it is ticked there.',
              { year: String(year) },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field required>
            <FieldLabel>{t('settings.holiday-calendar.name', 'Name')}</FieldLabel>
            <FieldControl>
              <Input
                value={name}
                maxLength={200}
                placeholder={t(
                  'settings.holiday-calendar.for_example_valencia_city',
                  'For example, Valencia city',
                )}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{t('settings.holiday-calendar.level', 'Level')}</FieldLabel>
            <Select
              value={level}
              onValueChange={(l) => {
                setLevel(l as Layer['level']);
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="national">
                  {t('settings.holiday-calendar.national', 'National')}
                </SelectItem>
                <SelectItem value="regional">
                  {t('settings.holiday-calendar.regional', 'Regional')}
                </SelectItem>
                <SelectItem value="city">{t('settings.holiday-calendar.city', 'City')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Toggle
            kind="checkbox"
            label={t(
              'settings.holiday-calendar.a_holiday_on_a_sunday_moves',
              'A holiday on a Sunday moves to Monday',
            )}
            checked={moves}
            onChange={setMoves}
          />
          {shown.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {t('settings.holiday-calendar.no_days_in_yet', 'No days in {{year}} yet.', {
                year: String(year),
              })}
            </p>
          ) : (
            <List
              aria-label={t('settings.holiday-calendar.days_in', 'Days in {{year}}', {
                year: String(year),
              })}
            >
              {shown.map((d) => (
                <ListItem
                  key={`${d.date} ${d.name}`}
                  description={shortDate(d.date)}
                  trailing={
                    <Button
                      variant="ghost"
                      aria-label={t('settings.holiday-calendar.remove', 'Remove {{name}}', {
                        name: d.name,
                      })}
                      startIcon={<icons.delete aria-hidden />}
                      onClick={() => {
                        setDays(days.filter((x) => x !== d));
                      }}
                    />
                  }
                >
                  {d.name}
                </ListItem>
              ))}
            </List>
          )}
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">
              {t('settings.holiday-calendar.add_a_day', 'Add a day')}
            </legend>
            <Field>
              <FieldLabel>{t('settings.holiday-calendar.date', 'Date')}</FieldLabel>
              <FieldControl>
                <DatePicker
                  label={t('settings.holiday-calendar.date', 'Date')}
                  min={`${String(year)}-01-01`}
                  max={`${String(year)}-12-31`}
                  value={date === '' ? null : date}
                  onChange={(d) => {
                    setDate(d ?? '');
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t('settings.holiday-calendar.holiday', 'Holiday')}</FieldLabel>
              <FieldControl>
                <Input
                  value={dayName}
                  maxLength={200}
                  onChange={(e) => {
                    setDayName(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {t(
                  'settings.holiday-calendar.as_people_will_read_it_on',
                  'As people will read it on their calendar.',
                )}
              </FieldDescription>
            </Field>
            <div>
              <Button
                size="sm"
                variant="secondary"
                startIcon={<icons.add aria-hidden />}
                disabled={date === '' || dayName.trim() === ''}
                onClick={() => {
                  setDays([...days, { date, name: dayName.trim() }]);
                  setDate('');
                  setDayName('');
                }}
              >
                {t('settings.holiday-calendar.add_day', 'Add day')}
              </Button>
            </div>
          </fieldset>
          {refused === null ? null : (
            <Alert tone="danger" title={t('settings.holiday-calendar.not_saved', 'Not saved')}>
              {refused}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          {layer === null || onRemove === undefined ? null : (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={() => {
                act(() => onRemove(layer.key));
              }}
            >
              {t('settings.holiday-calendar.remove_calendar', 'Remove calendar')}
            </Button>
          )}
          <Button onClick={onClose}>{t('settings.holiday-calendar.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            startIcon={<icons.confirm aria-hidden />}
            disabled={key === '' || name.trim() === ''}
            loading={busy}
            loadingLabel={t('settings.holiday-calendar.saving', 'Saving')}
            onClick={() => {
              act(() =>
                onSave(key, {
                  name: name.trim(),
                  level,
                  weekendRule: moves ? 'move_to_monday' : 'none',
                  holidays: days.toSorted((a, b) => a.date.localeCompare(b.date)),
                }),
              );
            }}
          >
            {t('settings.holiday-calendar.save_calendar', 'Save calendar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
