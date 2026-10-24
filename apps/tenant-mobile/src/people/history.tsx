import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ChipGroup,
  ChipGroupItem,
  dateFormat,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Icon,
  Inline,
  KeyValues,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  Timeline,
  TimelineItem,
} from '@reach/ui-native';
import { ArrowRight, Bot, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useRead, valueOf, valuesOf, type Entry, type RecordField } from './api';
import { DisplayValue, longDate } from './display';
import { previousOf, titleOf, type HistoryChange } from './history-model';
import type { PeopleScreen } from './routes';
import { t } from '../i18n';

interface HistoryData {
  readonly person: { readonly id: string; readonly name: string };
  readonly asOf: string | null;
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly fields: readonly RecordField[];
  }[];
  readonly dated: readonly string[];
  readonly values: readonly Entry[];
  readonly changes: readonly (Omit<HistoryChange, 'value'> & { readonly value: Entry })[];
}

const ALL = 'all';
const time = dateFormat({ hour: '2-digit', minute: '2-digit' });

/** The day an instant fell on, here: what changes are grouped under. */
const dayOf = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * A record's history (design D6): every change, newest first, grouped by
 * day — who made it, what it replaced, when it takes effect, and whether it
 * corrects a mistake or was corrected since. One field or all, and the
 * record as it stood on any date.
 */
export function History({ navigation, route }: PeopleScreen<'History'>): React.JSX.Element {
  const { personId, back } = route.params;
  const [asOf, setAsOf] = useState<string | null>(route.params.asOf ?? null);
  const [only, setOnly] = useState(ALL);
  const { load, reload } = useRead<HistoryData>('History', { personId: personId ?? null, asOf });

  const frame = (children: React.ReactNode): React.JSX.Element => (
    <Page
      title={t('people.history.history', 'History')}
      back={{ label: back, onPress: navigation.goBack }}
    >
      {children}
    </Page>
  );
  if (load.status === 'loading')
    return frame(
      <Loading label={t('people.history.loading_the_history', 'Loading the history')} />,
    );
  if (load.status === 'error') return frame(<Failed message={load.message} onRetry={reload} />);

  const data = load.data;
  const fields = new Map(data.sections.flatMap((s) => s.fields.map((f) => [f.key, f] as const)));
  const dated = new Set(data.dated);
  const changes = data.changes.map((c) => ({ ...c, value: valueOf(c.value) }));
  const shown = changes
    .filter((c) => fields.has(c.key) && (only === ALL || c.key === only))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const days = new Map<string, HistoryChange[]>();
  for (const c of shown)
    days.set(dayOf(c.recordedAt), [...(days.get(dayOf(c.recordedAt)) ?? []), c]);
  const today = dayOf(new Date().toISOString());
  const yesterday = dayOf(new Date(Date.now() - 86_400_000).toISOString());
  const dayTitle = (day: string): string =>
    day === today ? 'Today' : day === yesterday ? 'Yesterday' : longDate(day);
  const values = valuesOf(data.values);

  return frame(
    <>
      <Select value={only} onValueChange={setOnly}>
        <SelectTrigger accessibilityLabel={t('people.history.field', 'Field')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('people.history.all_fields', 'All fields')}</SelectItem>
          {[...fields.values()].map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <SegmentedControl
        value={asOf === null ? 'changes' : 'as-of'}
        fullWidth
        accessibilityLabel={t('people.history.show', 'Show')}
        onValueChange={(next) => {
          setAsOf(next === 'changes' ? null : new Date().toISOString().slice(0, 10));
        }}
      >
        <SegmentedControlItem value="changes">
          {t('people.history.changes', 'Changes')}
        </SegmentedControlItem>
        <SegmentedControlItem value="as-of">
          {t('people.history.as_of_a_date', 'As of a date')}
        </SegmentedControlItem>
      </SegmentedControl>

      {asOf !== null ? (
        <>
          <DatePicker
            label={t('people.history.see_the_record_as_it_was', 'See the record as it was on')}
            value={asOf}
            onChange={setAsOf}
          />
          <Alert
            tone="info"
            title={t('people.history.as_it_stood_on', 'As it stood on {{longDate}}', {
              longDate: longDate(asOf),
            })}
          >
            {t(
              'people.history.includes_later_corrections_fields_without_dates',
              'Includes later corrections. Fields without dates, like a phone number, show only their changes.',
            )}
          </Alert>
          {data.sections.map((section) => {
            const sectionFields = section.fields.filter((f) => only === ALL || f.key === only);
            return sectionFields.length === 0 ? null : (
              <Stack key={section.key} gap={2}>
                <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
                  {section.label}
                </Text>
                <Card>
                  <KeyValues
                    layout="stacked"
                    items={sectionFields.map((field) => ({
                      id: field.key,
                      label: field.label,
                      value: dated.has(field.key) ? (
                        <DisplayValue field={field} value={values[field.key]} />
                      ) : (
                        <Text tone="subtle">
                          {t('people.history.not_kept_by_date', 'Not kept by date')}
                        </Text>
                      ),
                    }))}
                  />
                </Card>
              </Stack>
            );
          })}
        </>
      ) : shown.length === 0 ? (
        <EmptyState title={t('people.history.no_changes_recorded', 'No changes recorded')} />
      ) : (
        [...days].map(([day, items]) => (
          <Stack key={day} gap={2}>
            <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
              {dayTitle(day)}
            </Text>
            <Card>
              <Timeline
                accessibilityLabel={t('people.history.changes_2', 'Changes, {{dayTitle}}', {
                  dayTitle: dayTitle(day),
                })}
              >
                {items.map((change, i) => {
                  const field = fields.get(change.key) as RecordField;
                  const previous = previousOf(change, changes);
                  const corrected =
                    change.supersedes === null
                      ? undefined
                      : changes.find((c) => c.id === change.supersedes);
                  const replacement =
                    change.supersededBy === null
                      ? undefined
                      : changes.find((c) => c.id === change.supersededBy);
                  const kind = change.actor?.kind ?? 'person';
                  const sealed =
                    typeof change.value === 'object' &&
                    change.value !== null &&
                    'last4' in change.value &&
                    change.value.last4 === null;
                  return (
                    <TimelineItem
                      key={change.id}
                      last={i === items.length - 1}
                      title={titleOf(field.label, change, previous)}
                      timestamp={time.format(new Date(change.recordedAt))}
                      marker={
                        kind === 'person' ? (
                          <Avatar name={change.by} size="sm" decorative />
                        ) : (
                          <Avatar name={change.by} size="sm" fallback={Bot} decorative />
                        )
                      }
                    >
                      <Stack gap={1}>
                        <Inline gap={1}>
                          {previous === undefined || corrected !== undefined ? null : (
                            <>
                              <DisplayValue
                                field={field}
                                value={previous.value}
                                className="text-fg-subtle line-through"
                              />
                              <Text tone="subtle">→</Text>
                            </>
                          )}
                          <DisplayValue
                            field={field}
                            value={change.value}
                            {...(replacement === undefined ? {} : { className: 'line-through' })}
                          />
                        </Inline>
                        <Text variant="footnote" tone="muted">
                          {(kind === 'system'
                            ? t('people.history.done_automatically', 'Done automatically')
                            : `By ${change.by}`) +
                            (dated.has(change.key) &&
                            change.effectiveFrom !== change.recordedAt.slice(0, 10)
                              ? ` · effective ${longDate(change.effectiveFrom)}`
                              : '')}
                        </Text>
                        {sealed ? (
                          <Inline gap={2}>
                            <Badge size="sm" icon={Lock}>
                              {t('people.history.sealed', 'Sealed')}
                            </Badge>
                            <Text variant="footnote" tone="muted">
                              {t(
                                'people.history.only_the_change_is_shown',
                                'Only the change is shown.',
                              )}
                            </Text>
                          </Inline>
                        ) : null}
                        {corrected !== undefined ? (
                          <Inline gap={2}>
                            <Badge size="sm" tone="accent">
                              {t('people.history.correction', 'Correction')}
                            </Badge>
                            <Text variant="footnote" tone="muted">
                              {t(
                                'people.history.replaces_the_value_recorded',
                                'Replaces the value recorded {{longDate}}.',
                                { longDate: longDate(corrected.recordedAt.slice(0, 10)) },
                              )}
                            </Text>
                          </Inline>
                        ) : replacement !== undefined ? (
                          <Inline gap={2}>
                            <Badge size="sm">{t('people.history.superseded', 'Superseded')}</Badge>
                            <Text variant="footnote" tone="muted">
                              {t('people.history.corrected_on', 'Corrected on {{longDate}}.', {
                                longDate: longDate(replacement.recordedAt.slice(0, 10)),
                              })}
                            </Text>
                          </Inline>
                        ) : null}
                      </Stack>
                    </TimelineItem>
                  );
                })}
              </Timeline>
            </Card>
          </Stack>
        ))
      )}
      {asOf === null ? null : (
        <Button
          onPress={() => {
            setAsOf(null);
          }}
        >
          {t('people.history.back_to_the_changes', 'Back to the changes')}
        </Button>
      )}
    </>,
  );
}

const short = dateFormat({ day: 'numeric', month: 'short' });

/**
 * History in a centred modal (design v3 P18): before and after on every
 * line, newest first, narrowed by section. "As it was on…" opens the whole
 * record rebuilt for a date.
 */
export function HistoryDialog({
  personId,
  name,
  onClose,
  onAsOf,
}: {
  personId: string | null;
  name: string;
  onClose: () => void;
  /** The record rebuilt for a date, on its own page. */
  onAsOf: () => void;
}): React.JSX.Element {
  const [only, setOnly] = useState(ALL);
  const { load, reload } = useRead<HistoryData>('History', { personId, asOf: null });
  const first = name.split(' ')[0] ?? name;
  const today = dayOf(new Date().toISOString());
  const yesterday = dayOf(new Date(Date.now() - 86_400_000).toISOString());
  const when = (iso: string): string => {
    const d = dayOf(iso);
    return d === today ? 'Today' : d === yesterday ? 'Yesterday' : short.format(new Date(iso));
  };
  let body: React.ReactNode;
  if (load.status === 'loading')
    body = <Loading label={t('people.history.loading_the_history', 'Loading the history')} />;
  else if (load.status === 'error') body = <Failed message={load.message} onRetry={reload} />;
  else {
    const data = load.data;
    const sectionOf = new Map(
      data.sections.flatMap((sec) => sec.fields.map((f) => [f.key, sec.key] as const)),
    );
    const fields = new Map(
      data.sections.flatMap((sec) => sec.fields.map((f) => [f.key, f] as const)),
    );
    const changes = data.changes.map((c) => ({ ...c, value: valueOf(c.value) }));
    const shown = changes
      .filter((c) => fields.has(c.key) && (only === ALL || sectionOf.get(c.key) === only))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, 40);
    body = (
      <>
        <View>
          <ChipGroup
            type="single"
            value={only}
            onValueChange={setOnly}
            accessibilityLabel={t('people.history.sections', 'Sections')}
            scroll
          >
            <ChipGroupItem value={ALL}>{t('people.history.all', 'All')}</ChipGroupItem>
            {data.sections
              .filter((sec) => changes.some((c) => sectionOf.get(c.key) === sec.key))
              .map((sec) => (
                <ChipGroupItem key={sec.key} value={sec.key}>
                  {sec.label}
                </ChipGroupItem>
              ))}
          </ChipGroup>
        </View>
        <ScrollView style={{ flexGrow: 0, maxHeight: 380 }}>
          {shown.length === 0 ? (
            <Text tone="muted">
              {t('people.history.no_changes_recorded_2', 'No changes recorded.')}
            </Text>
          ) : (
            shown.map((change, i) => {
              const field = fields.get(change.key) as RecordField;
              const previous = previousOf(change, changes);
              return (
                <View
                  key={change.id}
                  className={
                    i < shown.length - 1 ? 'gap-1.5 border-b border-border py-3' : 'gap-1.5 py-3'
                  }
                >
                  <View className="flex-row items-baseline gap-2">
                    <Text weight="semibold" className="flex-1">
                      {field.label}
                    </Text>
                    <Text variant="footnote" tone="subtle">
                      {`${when(change.recordedAt)} · ${change.actor?.kind === 'system' ? 'Kithena' : (change.by.split(' ')[0] ?? change.by)}`}
                    </Text>
                  </View>
                  <View className="flex-row flex-wrap items-center gap-2">
                    {previous === undefined ? null : (
                      <>
                        <DisplayValue
                          field={field}
                          value={previous.value}
                          className="text-fg-subtle line-through"
                        />
                        <Icon icon={ArrowRight} size={14} tone="subtle" />
                      </>
                    )}
                    <DisplayValue field={field} value={change.value} />
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </>
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('people.history.history', 'History')}</DialogTitle>
          <DialogDescription>
            {t(
              'people.history.every_change_to_record_newest_first',
              'Every change to {{value}} record, newest first.',
              { value: personId === null ? 'your' : `${first}’s` },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>{body}</DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onAsOf}>
            {t('people.history.see_the_record_as_it_was_2', 'See the record as it was on…')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
