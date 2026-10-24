import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
  DatePicker,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Inline,
  Input,
  KeyValues,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Switch,
  Text,
  useToast,
} from '@reach/ui-native';
import * as WebBrowser from 'expo-web-browser';
import { Sparkles } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useRead, useSigned } from '../api';
import { longDate } from '../display';
import { scheduleVariables } from '../insights/schedule';
import { parsed } from '../review/load';
import type { PeopleScreen } from '../routes';
import { t } from '../../i18n';

interface Builder {
  readonly today: string;
  readonly who: readonly { value: string; label: string; count: number | null }[];
  readonly sections: readonly {
    key: string;
    label: string;
    fields: readonly { key: string; label: string }[];
  }[];
}

interface Preview {
  readonly recipient: { accountId: string; name: string | null } | null;
  readonly candidates: readonly { accountId: string; name: string }[];
  readonly people: number;
  readonly sensitive: readonly string[];
  readonly gap: {
    fields: readonly { key: string; label: string; people: number }[];
    unlisted: number;
  } | null;
  readonly approvers: readonly { accountId: string; name: string | null }[];
  readonly tooLarge: boolean;
  readonly canSchedule: boolean;
}

interface Choice {
  readonly who: string;
  readonly conditions: readonly { key: string; op: string; values: readonly string[] }[];
  readonly match: 'all' | 'any';
  readonly fields: readonly string[];
  readonly asOf: string;
  readonly format: 'xlsx' | 'csv' | 'pdf';
  readonly photos: boolean;
  readonly reason: string;
}

type Mode = 'download' | 'send' | 'schedule';

/** The export's choice as People's `RequestExport` and `ShareChoice` take it. */
function asked(choice: Choice, audience: string | undefined) {
  const segmentId = choice.who.startsWith('segment:') ? choice.who.slice('segment:'.length) : null;
  const conditions = choice.who === 'conditions' ? choice.conditions : [];
  return {
    format: choice.format,
    fields: [...choice.fields],
    asOf: choice.asOf,
    ...(segmentId === null ? {} : { segmentId }),
    ...(conditions.length === 0
      ? {}
      : {
          conditions: conditions.map((c) => ({ key: c.key, op: c.op, values: [...c.values] })),
          match: choice.match,
          ...(audience === undefined ? {} : { filter: audience.slice(0, 500) }),
        }),
    ...(choice.reason.trim() === '' ? {} : { reason: choice.reason.trim() }),
  };
}

/**
 * Exporting (design F6, F7): described in words or chosen by hand — who,
 * which fields, as of when, which format — with a reason for the audit log,
 * then downloaded, sent to a colleague or scheduled. Only what the viewer can
 * see in People goes into it. Sending to somebody who cannot see all of it
 * waits for a People administrator, or goes now without those fields.
 */
export function Export({ navigation, route }: PeopleScreen<'Export'>): React.JSX.Element {
  const signed = useSigned();
  const { toast } = useToast();
  const { act, busy } = useAct();
  const { load, reload } = useRead<Builder>('ExportBuilder', {});
  const [choice, setChoice] = useState<Choice | null>(null);
  const [mode, setMode] = useState<Mode>('download');
  const [sentence, setSentence] = useState(route.params?.sentence ?? '');
  const [note, setNote] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [shown, setShown] = useState(false);

  const builder = load.status === 'ready' ? load.data : null;
  const offered = useMemo(() => builder?.sections.flatMap((s) => s.fields) ?? [], [builder]);
  useEffect(() => {
    if (builder !== null && choice === null) {
      setChoice({
        who: 'everyone',
        conditions: [],
        match: 'all',
        fields: offered.map((f) => f.key),
        asOf: builder.today,
        format: 'xlsx',
        photos: false,
        reason: '',
      });
    }
  }, [builder, choice, offered]);

  // What sending would mean for this recipient: who they can't see, which fields need their access.
  useEffect(() => {
    if (choice === null || mode === 'download') return;
    let live = true;
    const audience = builder?.who.find((w) => w.value === choice.who)?.label;
    void ask<string>(signed, 'ExportSharePreview', {
      input: JSON.stringify({
        choice: asked(choice, audience),
        ...(recipient === null ? {} : { recipient }),
      }),
    }).then((answer) => {
      if (live && answer.ok) setPreview(parsed(answer.data) as Preview | null);
    });
    return () => {
      live = false;
    };
  }, [signed, choice, mode, recipient, builder]);

  const back = {
    label: t('people.transfer.export.import_export', 'Import & export'),
    onPress: navigation.goBack,
  };
  if (load.status === 'loading' || choice === null)
    return (
      <Page title={t('people.transfer.export.export', 'Export')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading
            label={t(
              'people.transfer.export.loading_what_you_can_export',
              'Loading what you can export',
            )}
          />
        )}
      </Page>
    );
  if (load.status === 'error')
    return (
      <Page title={t('people.transfer.export.export', 'Export')} back={back}>
        <Failed message={load.message} onRetry={reload} />
      </Page>
    );

  const audience = load.data.who.find((w) => w.value === choice.who);
  const set = (patch: Partial<Choice>): void => {
    setChoice({ ...choice, ...patch });
  };
  const describe = async (): Promise<void> => {
    if (sentence.trim() === '') return;
    setPlanning(true);
    const answer = await ask<string>(signed, 'ExportPlan', { sentence: sentence.trim() });
    setPlanning(false);
    if (!answer.ok) {
      toast({
        title: t('people.transfer.export.that_did_not_work', 'That did not work'),
        description: answer.message,
        tone: 'danger',
      });
      return;
    }
    const plan = parsed(answer.data) as
      (Choice & { by: string; note: string | null; notes: string[] }) | null;
    if (plan === null) return;
    setChoice({
      who: plan.who,
      conditions: plan.conditions,
      match: plan.match,
      fields: plan.fields,
      asOf: plan.asOf,
      format: plan.format,
      photos: plan.photos,
      reason: plan.reason,
    });
    setNote([plan.note, ...plan.notes].filter((x) => x !== null && x !== '').join(' ') || null);
  };
  const reasonMissing = choice.reason.trim() === '';

  const download = async (without: readonly string[] = []): Promise<void> => {
    setShown(true);
    if (reasonMissing) return;
    const made = await act<{ id: string; links: { url: string }[] }>(
      'RequestExport',
      asked(
        { ...choice, fields: choice.fields.filter((f) => !without.includes(f)) },
        audience?.label,
      ),
    );
    if (made === null) return;
    const url = made.links[0]?.url;
    if (url !== undefined) void WebBrowser.openBrowserAsync(url);
    navigation.replace('ExportRecord', { id: made.id });
  };
  const send = async (): Promise<void> => {
    setShown(true);
    if (reasonMissing || recipient === null) return;
    const sent = await act<string>('ShareExport', {
      input: JSON.stringify({ choice: asked(choice, audience?.label), recipient }),
    });
    if (sent === null) return;
    const done = parsed(sent) as
      { status: 'sent'; exportId: string } | { status: 'waiting'; requestId: string } | null;
    if (done?.status === 'sent') {
      toast({ title: t('people.transfer.export.sent', 'Sent'), tone: 'success' });
      navigation.replace('ExportRecord', { id: done.exportId });
    } else {
      toast({
        title: t('people.transfer.export.waiting_for_approval', 'Waiting for approval'),
        description: t(
          'people.transfer.export.it_is_sent_once_a_people',
          'It is sent once a People administrator approves.',
        ),
        tone: 'info',
      });
      navigation.goBack();
    }
  };
  const schedule = async (): Promise<void> => {
    setShown(true);
    if (reasonMissing || recipient === null) return;
    const segmentId = choice.who.startsWith('segment:')
      ? choice.who.slice('segment:'.length)
      : null;
    const filter: { key: string; value: string }[] = [];
    for (const c of choice.who === 'conditions' ? choice.conditions : []) {
      const value = c.values[0];
      if (
        !(c.op === 'is' || c.op === 'in') ||
        c.values.length !== 1 ||
        value === undefined ||
        choice.match === 'any'
      ) {
        toast({
          title: t(
            'people.transfer.export.this_group_cant_be_scheduled',
            'This group can’t be scheduled',
          ),
          description: t(
            'people.transfer.export.a_schedule_takes_a_saved_view',
            'A schedule takes a saved view or simple filters. Save this group as a view in the Directory first.',
          ),
          tone: 'warning',
        });
        return;
      }
      filter.push({ key: c.key, value });
    }
    const made = await act(
      'CreateReportSchedule',
      scheduleVariables({
        name: (
          choice.reason.trim() || t('people.transfer.export.monthly_export', 'Monthly export')
        ).slice(0, 80),
        segmentId,
        filter,
        kind: 'export',
        format: choice.format === 'pdf' ? 'pdf' : 'xlsx',
        fields: [...choice.fields],
        reason: choice.reason.trim(),
        every: 'month',
        weekday: 1,
        day: 1,
        hour: 7,
        legalEntityId: null,
        recipients: [recipient],
      }),
      t(
        'people.transfer.export.scheduled_on_the_1st_of_every',
        'Scheduled: on the 1st of every month',
      ),
    );
    if (made !== null) navigation.goBack();
  };

  const gap = preview?.gap ?? null;
  const foot =
    mode === 'download' ? (
      <Button
        className="flex-1"
        fullWidth
        variant="primary"
        loading={busy !== null}
        onPress={() => void download()}
      >
        {t('people.transfer.export.download', 'Download {{value}}', {
          value: choice.format === 'xlsx' ? 'Excel' : choice.format.toUpperCase(),
        })}
      </Button>
    ) : mode === 'send' ? (
      <Button
        className="flex-1"
        fullWidth
        variant="primary"
        loading={busy !== null}
        disabled={recipient === null}
        onPress={() => void send()}
      >
        {gap === null || preview?.approvers.length === 0
          ? t('people.transfer.export.send', 'Send')
          : t('people.transfer.export.send_when_approves', 'Send when {{value}} approves', {
              value: preview?.approvers[0]?.name?.split(' ')[0] ?? 'an administrator',
            })}
      </Button>
    ) : (
      <Button
        className="flex-1"
        fullWidth
        variant="primary"
        loading={busy !== null}
        disabled={recipient === null}
        onPress={() => void schedule()}
      >
        {t('people.transfer.export.schedule_monthly', 'Schedule monthly')}
      </Button>
    );

  return (
    <Page title={t('people.transfer.export.export', 'Export')} back={back} foot={foot}>
      <SearchField
        value={sentence}
        onValueChange={setSentence}
        onSearch={() => void describe()}
        placeholder={t(
          'people.transfer.export.describe_it_salaries_in_madrid_as',
          'Describe it: “salaries in Madrid as of 30 June”',
        )}
        label={t('people.transfer.export.describe_the_export', 'Describe the export')}
      />
      {planning ? (
        <Text tone="muted">{t('people.transfer.export.building_it', 'Building it…')}</Text>
      ) : null}
      {note === null ? null : (
        <Alert
          tone="accent"
          icon={Sparkles}
          title={t(
            'people.transfer.export.heres_the_export_ive_built',
            'Here’s the export I’ve built',
          )}
        >
          {t(
            'people.transfer.export.check_it_before_it_goes_anywhere',
            '{{note}} Check it before it goes anywhere.',
            { note },
          )}
        </Alert>
      )}
      <Card>
        <KeyValues
          items={[
            {
              label: t('people.transfer.export.who', 'Who'),
              value: `${audience?.label ?? 'Everyone'}${audience?.count == null ? '' : ` · ${String(audience.count)}`}`,
            },
            {
              label: t('people.transfer.export.fields', 'Fields'),
              value: String(choice.fields.length),
            },
            { label: t('people.transfer.export.as_of', 'As of'), value: longDate(choice.asOf) },
          ]}
        />
      </Card>
      <Field>
        <FieldLabel>{t('people.transfer.export.who', 'Who')}</FieldLabel>
        <Select
          value={choice.who}
          onValueChange={(who) => {
            set({ who, conditions: [] });
          }}
        >
          <SelectTrigger accessibilityLabel={t('people.transfer.export.who', 'Who')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {load.data.who.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.count === null ? w.label : `${w.label} · ${String(w.count)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>{t('people.transfer.export.as_of', 'As of')}</FieldLabel>
        <DatePicker
          label={t('people.transfer.export.as_of', 'As of')}
          value={choice.asOf}
          onChange={(asOf) => {
            if (asOf !== null) set({ asOf });
          }}
        />
      </Field>
      <Field>
        <FieldLabel>{t('people.transfer.export.format', 'Format')}</FieldLabel>
        <SegmentedControl
          value={choice.format}
          fullWidth
          accessibilityLabel={t('people.transfer.export.format', 'Format')}
          onValueChange={(format) => {
            set({ format: format as Choice['format'] });
          }}
        >
          <SegmentedControlItem value="xlsx">
            {t('people.transfer.export.excel', 'Excel')}
          </SegmentedControlItem>
          <SegmentedControlItem value="csv">
            {t('people.transfer.export.csv', 'CSV')}
          </SegmentedControlItem>
          <SegmentedControlItem value="pdf">
            {t('people.transfer.export.pdf', 'PDF')}
          </SegmentedControlItem>
        </SegmentedControl>
      </Field>
      {choice.format === 'pdf' ? (
        <Inline justify="between">
          <Text>{t('people.transfer.export.include_photos', 'Include photos')}</Text>
          <Switch
            checked={choice.photos}
            onCheckedChange={(photos) => {
              set({ photos });
            }}
            accessibilityLabel={t('people.transfer.export.include_photos', 'Include photos')}
          />
        </Inline>
      ) : null}
      {load.data.sections.map((section) => (
        <Card key={section.key}>
          <Stack gap={2}>
            <Text weight="semibold">{section.label}</Text>
            {section.fields.map((f) => (
              <Checkbox
                key={f.key}
                checked={choice.fields.includes(f.key)}
                onCheckedChange={(on) => {
                  set({
                    fields: on
                      ? [...choice.fields, f.key]
                      : choice.fields.filter((k) => k !== f.key),
                  });
                }}
              >
                {f.label}
              </Checkbox>
            ))}
          </Stack>
        </Card>
      ))}
      <Field required invalid={shown && reasonMissing}>
        <FieldLabel>
          {t('people.transfer.export.reason_for_the_audit_log', 'Reason, for the audit log')}
        </FieldLabel>
        <Input
          value={choice.reason}
          onChange={(reason) => {
            set({ reason });
          }}
          maxLength={200}
        />
        {shown && reasonMissing ? (
          <FieldError>
            {t('people.transfer.export.say_why_for_the_audit_log', 'Say why, for the audit log.')}
          </FieldError>
        ) : null}
      </Field>
      <SegmentedControl
        value={mode}
        fullWidth
        accessibilityLabel={t('people.transfer.export.what_to_do_with_it', 'What to do with it')}
        onValueChange={(next) => {
          setMode(next as Mode);
        }}
      >
        <SegmentedControlItem value="download">
          {t('people.transfer.export.download_2', 'Download')}
        </SegmentedControlItem>
        <SegmentedControlItem value="send">
          {t('people.transfer.export.send', 'Send')}
        </SegmentedControlItem>
        <SegmentedControlItem value="schedule">
          {t('people.transfer.export.schedule', 'Schedule')}
        </SegmentedControlItem>
      </SegmentedControl>
      {mode === 'download' ? (
        <Text variant="footnote" tone="muted">
          {t(
            'people.transfer.export.only_what_you_can_see_in',
            'Only what you can see in People. Its link expires in 24 hours.',
          )}
        </Text>
      ) : (
        <>
          <Field>
            <FieldLabel>
              {mode === 'send'
                ? t('people.transfer.export.send_to', 'Send to')
                : t('people.transfer.export.every_month_to', 'Every month to')}
            </FieldLabel>
            <Combobox
              label={t('people.transfer.export.send_to', 'Send to')}
              options={(preview?.candidates ?? []).map((c) => ({
                value: c.accountId,
                label: c.name,
              }))}
              value={recipient}
              onChange={(next) => {
                setRecipient(typeof next === 'string' ? next : null);
              }}
              placeholder={t('people.transfer.export.choose_a_colleague', 'Choose a colleague')}
              searchPlaceholder={t('people.transfer.export.type_a_name', 'Type a name')}
            />
            {mode === 'schedule' ? (
              <FieldDescription>
                {t(
                  'people.transfer.export.on_the_1st_of_every_month',
                  'On the 1st of every month at 07:00, built as they can see it.',
                )}
              </FieldDescription>
            ) : null}
          </Field>
          {gap !== null && mode === 'send' ? (
            <Alert
              tone="warning"
              title={
                gap.fields.length > 0
                  ? t(
                      'people.transfer.export.their_access',
                      { one: '{{join}} needs their access', other: '{{join}} need their access' },
                      { count: gap.fields.length, join: gap.fields.map((f) => f.label).join(', ') },
                    )
                  : t(
                      'people.transfer.export.they_cant_see_of_these_people',
                      'They can’t see {{String}} of these people',
                      { String: String(gap.unlisted) },
                    )
              }
            >
              <Stack gap={2}>
                <Text>
                  {t(
                    'people.transfer.export.it_waits_for_to_approve',
                    'It waits for {{value}} to approve.',
                    {
                      value:
                        preview?.approvers
                          .map((a) => a.name ?? 'a People administrator')
                          .join(' or ') ?? 'an administrator',
                    },
                  )}
                </Text>
                {gap.fields.length === 0 ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => void download(gap.fields.map((f) => f.key))}
                  >
                    {t(
                      'people.transfer.export.download_now_without',
                      'Download now (without {{join}})',
                      { join: gap.fields.map((f) => f.label.toLowerCase()).join(', ') },
                    )}
                  </Button>
                )}
              </Stack>
            </Alert>
          ) : null}
          {preview?.tooLarge === true ? (
            <Alert
              tone="warning"
              title={t('people.transfer.export.too_large_to_send', 'Too large to send')}
            >
              {t('people.transfer.export.download_it_instead', 'Download it instead.')}
            </Alert>
          ) : null}
          {preview !== null && preview.sensitive.length > 0 ? (
            <Inline gap={1}>
              {preview.sensitive.map((s) => (
                <Badge key={s} size="sm" tone="warning">
                  {s}
                </Badge>
              ))}
            </Inline>
          ) : null}
        </>
      )}
    </Page>
  );
}

interface Record_ {
  readonly id: string;
  readonly status: 'queued' | 'completed' | 'expired';
  readonly requestedBy: { name: string | null };
  readonly sentTo: { name: string | null } | null;
  readonly openedAt: string | null;
  readonly reason: string | null;
  readonly rowCount: number | null;
  readonly fields: readonly string[];
  readonly sensitive: number;
  readonly asOf: string | null;
  readonly format: string | null;
  readonly expiresAt: string | null;
  readonly keptUntil: string | null;
}

/** One export: what is in it, who asked and who has it, and its download while it lasts. */
export function ExportRecord({
  navigation,
  route,
}: PeopleScreen<'ExportRecord'>): React.JSX.Element {
  const signed = useSigned();
  const { load, reload } = useRead<string>('ExportRecord', { id: route.params.id });
  const [links, setLinks] = useState<readonly { name: string; url: string }[] | null>(null);
  const record = load.status === 'ready' ? (parsed(load.data) as Record_ | null) : null;
  useEffect(() => {
    if (record?.status !== 'completed') return;
    void ask<{ links: { name: string; url: string }[] }>(signed, 'ScheduledExport', {
      id: route.params.id,
    }).then((answer) => {
      if (answer.ok) setLinks(answer.data.links);
    });
  }, [signed, record?.status, route.params.id]);
  const back = {
    label: t('people.transfer.export.import_export', 'Import & export'),
    onPress: navigation.goBack,
  };
  if (load.status === 'loading')
    return (
      <Page title={t('people.transfer.export.export', 'Export')} back={back}>
        <Loading label={t('people.transfer.export.loading_the_export', 'Loading the export')} />
      </Page>
    );
  if (load.status === 'error' || record === null)
    return (
      <Page title={t('people.transfer.export.export', 'Export')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Alert
            tone="warning"
            title={t(
              'people.transfer.export.this_export_is_no_longer_available',
              'This export is no longer available',
            )}
          >
            {t(
              'people.transfer.export.it_was_made_for_somebody_else',
              'It was made for somebody else, or it no longer exists.',
            )}
          </Alert>
        )}
      </Page>
    );
  return (
    <Page title={t('people.transfer.export.export', 'Export')} back={back}>
      <Card>
        <KeyValues
          layout="stacked"
          items={[
            {
              label: t('people.transfer.export.status', 'Status'),
              value:
                record.status === 'queued'
                  ? t('people.transfer.export.being_made', 'Being made')
                  : record.status === 'completed'
                    ? 'Ready'
                    : 'Expired',
            },
            {
              label: t('people.transfer.export.asked_by', 'Asked by'),
              value: record.requestedBy.name ?? 'A colleague',
            },
            ...(record.sentTo === null
              ? []
              : [
                  {
                    label: t('people.transfer.export.sent_to', 'Sent to'),
                    value: `${record.sentTo.name ?? 'A colleague'}${record.openedAt === null ? '' : ' · opened'}`,
                  },
                ]),
            ...(record.reason === null
              ? []
              : [{ label: t('people.transfer.export.reason', 'Reason'), value: record.reason }]),
            ...(record.rowCount === null
              ? []
              : [
                  {
                    label: t('people.transfer.export.people', 'People'),
                    value: String(record.rowCount),
                  },
                ]),
            {
              label: t('people.transfer.export.fields', 'Fields'),
              value: `${String(record.fields.length)}${record.sensitive > 0 ? ` · ${String(record.sensitive)} sensitive` : ''}`,
            },
            ...(record.asOf === null
              ? []
              : [
                  {
                    label: t('people.transfer.export.as_of', 'As of'),
                    value: longDate(record.asOf),
                  },
                ]),
            ...(record.expiresAt === null
              ? []
              : [
                  {
                    label: t('people.transfer.export.link_expires', 'Link expires'),
                    value: new Date(record.expiresAt).toLocaleString(),
                  },
                ]),
            ...(record.keptUntil === null
              ? []
              : [
                  {
                    label: t('people.transfer.export.record_kept_until', 'Record kept until'),
                    value: longDate(record.keptUntil.slice(0, 10)),
                  },
                ]),
          ]}
        />
      </Card>
      {(links ?? []).map((l) => (
        <Button
          key={l.url}
          variant="primary"
          onPress={() => void WebBrowser.openBrowserAsync(l.url)}
        >
          {t('people.transfer.export.download_3', 'Download {{name}}', { name: l.name })}
        </Button>
      ))}
    </Page>
  );
}
