import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Inline,
  KeyValues,
  List,
  ListItem,
  locale,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Stepper,
  Switch,
  Text,
} from '@reach/ui-native';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { FileSpreadsheet, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { Page } from '../../frame';
import { ask, useSigned } from '../api';
import { blobOf, put, type Target } from '../media';
import { parsed } from '../review/load';
import type { PeopleScreen } from '../routes';
import {
  FOR_EXISTING,
  mappingOf,
  type ColumnProposal,
  type MapStage,
  type Mapping,
  type NewFieldsView,
  type PlaceChoice,
  type PlanView,
  type ProposedColumn,
} from './model';
import { t } from '../../i18n';

/** Where the flow is: the three steps the design names, and the file before them. */
type Step = 'pick' | 'map' | 'fields' | 'plan';

const IGNORE = '#ignore';

/**
 * Importing people from a file (design F2–F4): the file, its columns as
 * stacked rows (a column is never dropped quietly), the fields People
 * proposes for columns that are not fields yet, one at a time, and who fills
 * them for the people already here; then the plan from a dry run, its
 * workplaces, and Approve and run. The run is followed on its own screen.
 * Nothing is written before Approve.
 */
export function Import({ navigation }: PeopleScreen<'Import'>): React.JSX.Element {
  const signed = useSigned();
  const [step, setStep] = useState<Step>('pick');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [stage, setStage] = useState<MapStage | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [fields, setFields] = useState<NewFieldsView | null>(null);
  const [proposals, setProposals] = useState<readonly ColumnProposal[]>([]);
  const [at, setAt] = useState(0);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [places, setPlaces] = useState<Readonly<Record<string, PlaceChoice>>>({});
  const [withoutApproval, setWithoutApproval] = useState(false);

  const fail = (message: string, where?: string): void => {
    setBusy(false);
    setProblem(message);
    setLink(where ?? null);
  };
  const step2 = (mapped: Mapping) => ({
    uploadId,
    mapping: Object.fromEntries(Object.entries(mapped)),
  });

  const pick = async (): Promise<void> => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        'text/csv',
        'text/comma-separated-values',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ],
      copyToCacheDirectory: true,
    });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (asset === undefined) return;
    setBusy(true);
    setProblem(null);
    const body = await blobOf(asset.uri);
    if (body.size > 100 * 1024 * 1024) {
      fail(t('people.transfer.import.a_file_can_be_up_to', 'A file can be up to 100 MB.'));
      return;
    }
    const target = await ask<Target>(signed, 'StartImportUpload', {
      name: asset.name.slice(0, 255),
      size: body.size,
    });
    if (!target.ok) {
      fail(target.message);
      return;
    }
    if (!(await put(target.data, body))) {
      fail('The upload did not go through; try again.');
      return;
    }
    const done = await ask<MapStage>(signed, 'CompleteImportUpload', {
      uploadId: target.data.uploadId,
    });
    if (!done.ok) {
      fail(done.message);
      return;
    }
    setUploadId(target.data.uploadId);
    setStage(done.data);
    setMapping(mappingOf(done.data.columns));
    setBusy(false);
    setStep('map');
  };

  const propose = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const answer = await ask<string>(signed, 'ProposeImportFields', {
      step: JSON.stringify(step2(mapping)),
    });
    if (!answer.ok) {
      fail(answer.message);
      return;
    }
    const view = parsed(answer.data) as NewFieldsView | null;
    if (view === null) {
      fail(
        t(
          'people.transfer.import.people_answered_in_a_way_this',
          'People answered in a way this screen cannot read.',
        ),
      );
      return;
    }
    setFields(view);
    setProposals(view.proposals);
    setAt(0);
    setBusy(false);
    // Nothing to decide about new fields: straight to the plan.
    if (view.proposals.length === 0) void makePlan(view.proposals);
    else setStep('fields');
  };

  const makePlan = async (chosen: readonly ColumnProposal[] = proposals): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const answer = await ask<string>(signed, 'PlanImport', {
      input: JSON.stringify({ ...step2(mapping), proposals: chosen, places }),
    });
    if (!answer.ok) {
      fail(answer.message);
      return;
    }
    const view = parsed(answer.data) as PlanView | null;
    if (view === null) {
      fail(
        t(
          'people.transfer.import.people_answered_in_a_way_this',
          'People answered in a way this screen cannot read.',
        ),
      );
      return;
    }
    setPlan(view);
    setBusy(false);
    setStep('plan');
  };

  const run = async (): Promise<void> => {
    if (plan === null) return;
    setBusy(true);
    setProblem(null);
    const answer = await ask<string>(signed, 'RunImport', {
      input: JSON.stringify({
        ...step2(mapping),
        proposals,
        places,
        basedOn: plan.basedOn ?? plan.version,
        ...(withoutApproval ? { applySensitiveWithoutApproval: true } : {}),
      }),
    });
    if (!answer.ok) {
      fail(answer.message);
      return;
    }
    const ran = parsed(answer.data) as { runId?: string } | null;
    if (typeof ran?.runId !== 'string') {
      fail(
        t(
          'people.transfer.import.the_import_did_not_start_try',
          'The import did not start. Try again.',
        ),
      );
      return;
    }
    navigation.replace('ImportRun', { id: ran.runId });
  };

  const steps = [
    { id: 'map', label: t('people.transfer.import.upload_and_map', 'Upload and map') },
    { id: 'fields', label: t('people.transfer.import.decide', 'Decide') },
    { id: 'plan', label: t('people.transfer.import.approve', 'Approve') },
  ];
  const current = step === 'pick' || step === 'map' ? 0 : step === 'fields' ? 1 : 2;
  const proposal = proposals[at];
  const decided = stage === null ? 0 : stage.columns.filter((c) => mapping[c.index] != null).length;
  const pending =
    stage === null
      ? []
      : stage.columns.filter((c) => c.status === 'review' || c.status === 'refused');
  const workplaces = plan?.review.dryRun.workplaces ?? [];
  const here = plan?.review.dryRun.here ?? null;

  const foot =
    step === 'map' ? (
      <>
        <Button
          className="flex-1"
          fullWidth
          onPress={() => {
            setStep('pick');
          }}
        >
          {t('people.transfer.import.back', 'Back')}
        </Button>
        <Button
          className="flex-1"
          fullWidth
          variant="primary"
          loading={busy}
          onPress={() => void propose()}
        >
          {t('people.transfer.import.next', 'Next')}
        </Button>
      </>
    ) : step === 'fields' && proposal !== undefined ? (
      <>
        <Button
          className="flex-1"
          fullWidth
          onPress={() => {
            setProposals((p) => p.map((x, i) => (i === at ? { ...x, include: false } : x)));
            if (at + 1 < proposals.length) setAt(at + 1);
            else void makePlan(proposals.map((x, i) => (i === at ? { ...x, include: false } : x)));
          }}
        >
          {t('people.transfer.import.skip', 'Skip')}
        </Button>
        <Button
          className="flex-1"
          fullWidth
          variant="primary"
          loading={busy}
          disabled={fields?.canCreate === false}
          onPress={() => {
            const next = proposals.map((x, i) => (i === at ? { ...x, include: true } : x));
            setProposals(next);
            if (at + 1 < proposals.length) setAt(at + 1);
            else void makePlan(next);
          }}
        >
          {fields?.canCreate === false
            ? t('people.transfer.import.next', 'Next')
            : t('people.transfer.import.create_field', 'Create field')}
        </Button>
      </>
    ) : step === 'plan' && plan !== null ? (
      <Button
        className="flex-1"
        fullWidth
        variant="primary"
        loading={busy}
        disabled={plan.blocked !== null}
        onPress={() => void run()}
      >
        {t('people.transfer.import.approve_and_run', 'Approve and run')}
      </Button>
    ) : undefined;

  return (
    <Page
      title={
        step === 'fields'
          ? t('people.transfer.import.new_fields_of', 'New fields · {{String}} of {{String2}}', {
              String: String(at + 1),
              String2: String(proposals.length),
            })
          : step === 'plan'
            ? t('people.transfer.import.review_plan', 'Review plan')
            : t('people.transfer.import.import', 'Import')
      }
      back={{
        label: t('people.transfer.import.import_export', 'Import & export'),
        onPress: navigation.goBack,
      }}
      {...(foot === undefined ? {} : { foot })}
    >
      {step === 'pick' ? null : (
        <Stepper
          label={t('people.transfer.import.import_steps', 'Import steps')}
          orientation="horizontal"
          steps={steps.map((s, i) => ({
            label: s.label,
            status: i < current ? 'done' : i === current ? 'current' : 'todo',
          }))}
        />
      )}
      {problem === null ? null : (
        <Alert
          tone="danger"
          title={t('people.transfer.import.that_did_not_work', 'That did not work')}
        >
          <Stack gap={2}>
            <Text>{problem}</Text>
            {link === null ? null : (
              <Button
                size="sm"
                onPress={() => {
                  navigation.navigate('ImportExport');
                }}
              >
                {t(
                  'people.transfer.import.see_the_import_that_is_running',
                  'See the import that is running',
                )}
              </Button>
            )}
          </Stack>
        </Alert>
      )}

      {step === 'pick' ? (
        <EmptyState
          icon={FileSpreadsheet}
          title={t('people.transfer.import.choose_a_file', 'Choose a file')}
          description={t(
            'people.transfer.import.an_excel_or_csv_file_of',
            'An Excel or CSV file of people, one row each, up to 100 MB. Nothing is written until you approve the plan.',
          )}
          action={
            <Button
              variant="primary"
              loading={busy}
              loadingLabel="Uploading"
              onPress={() => void pick()}
            >
              Choose a file
            </Button>
          }
        />
      ) : null}

      {step === 'map' && stage !== null ? (
        <>
          <Text tone="muted">
            {t(
              'people.transfer.import.rows_of_columns_mapped',
              '{{toLocaleString}} rows · {{String}} of {{String2}} columns mapped',
              {
                toLocaleString: stage.file.rows.toLocaleString(locale()),
                String: String(decided),
                String2: String(stage.columns.length),
              },
            )}
          </Text>
          {pending.length === 0 ? null : (
            <Alert
              tone="warning"
              title={t(
                'people.transfer.import.a_decision',
                {
                  one: '{{count}} column needs a decision',
                  other: '{{count}} columns need a decision',
                },
                { count: pending.length },
              )}
            >
              {t(
                'people.transfer.import.a_column_is_never_dropped_quietly',
                'A column is never dropped quietly.',
              )}
            </Alert>
          )}
          <Card>
            <Stack gap={3}>
              {stage.columns.map((c: ProposedColumn) => (
                <Stack key={c.index} gap={1}>
                  <Inline gap={2} justify="between">
                    <Text variant="subhead" tone="muted" className="flex-1">
                      {c.header === ''
                        ? t('people.transfer.import.column', 'Column {{String}}', {
                            String: String(c.index + 1),
                          })
                        : c.header}
                    </Text>
                    {c.confidence === null ? null : (
                      <Badge size="sm" tone={c.confidence >= 0.9 ? 'success' : 'warning'}>
                        {c.confidence >= 0.9
                          ? c.confidence.toFixed(2)
                          : t('people.transfer.import.check_this', '{{toFixed}}, check this', {
                              toFixed: c.confidence.toFixed(2),
                            })}
                      </Badge>
                    )}
                  </Inline>
                  <Select
                    value={mapping[c.index] ?? IGNORE}
                    onValueChange={(next) => {
                      setMapping((m) => ({ ...m, [c.index]: next === IGNORE ? null : next }));
                    }}
                  >
                    <SelectTrigger
                      accessibilityLabel={t(
                        'people.transfer.import.field_for',
                        'Field for {{header}}',
                        { header: c.header },
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={IGNORE}>
                        {t('people.transfer.import.leave_this_column_out', 'Leave this column out')}
                      </SelectItem>
                      {stage.fields.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.sensitive === true
                            ? t('people.transfer.import.sensitive', '{{label}} (sensitive)', {
                                label: f.label,
                              })
                            : f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {c.reason === null ? null : (
                    <Text variant="footnote" tone={c.status === 'refused' ? 'danger' : 'muted'}>
                      {c.reason}
                    </Text>
                  )}
                </Stack>
              ))}
            </Stack>
          </Card>
        </>
      ) : null}

      {step === 'fields' && proposal !== undefined ? (
        <>
          {at === 0 ? (
            <Card>
              <Inline gap={2}>
                <Sparkles size={16} />
                <Text weight="semibold">
                  {t(
                    'people.transfer.import.these_columns_arent_fields_yet',
                    'These columns aren’t fields yet',
                  )}
                </Text>
              </Inline>
              <Text variant="subhead" tone="muted">
                {t(
                  'people.transfer.import.each_is_designed_from_the_shape',
                  'Each is designed from the shape of the data, never a value.',
                )}
              </Text>
            </Card>
          ) : null}
          {fields?.blocked == null ? null : (
            <Alert
              tone="warning"
              title={t(
                'people.transfer.import.only_a_people_administrator_creates_fields',
                'Only a People administrator creates fields',
              )}
            >
              {fields.blocked}
            </Alert>
          )}
          <Card>
            <Stack gap={3}>
              <Inline gap={2}>
                <Text variant="subhead" tone="muted" className="font-mono">
                  {proposal.header}
                </Text>
                <Text tone="subtle">→</Text>
                <Text variant="title3">{proposal.field.label}</Text>
              </Inline>
              <Inline gap={1}>
                <Badge size="sm">{proposal.field.dataType.replaceAll('_', ' ')}</Badge>
                <Badge size="sm">
                  {'sectionKey' in proposal.placement
                    ? (fields?.sections.find(
                        (s) =>
                          'sectionKey' in proposal.placement &&
                          s.key === proposal.placement.sectionKey,
                      )?.label ?? proposal.placement.sectionKey)
                    : t('people.transfer.import.new_section', 'New section: {{newSection}}', {
                        newSection: proposal.placement.newSection,
                      })}
                </Badge>
                <Badge size="sm" tone={proposal.sensitive == null ? 'neutral' : 'warning'}>
                  {proposal.field.classification}
                </Badge>
              </Inline>
              <Text>{proposal.why}</Text>
              <Text variant="footnote" tone="muted">
                {t('people.transfer.import.confidence', '{{value}} confidence · {{shape}}', {
                  value: proposal.confidence === 'high' ? 'High' : 'Medium',
                  shape: proposal.shape,
                })}
              </Text>
              {proposal.counts === undefined || proposal.counts.existingWithout === 0 ? null : (
                <Stack gap={2}>
                  <Text weight="semibold">
                    {t(
                      'people.transfer.import.people_already_here_have_no',
                      '{{toLocaleString}} people already here have no {{label}}',
                      {
                        toLocaleString: proposal.counts.existingWithout.toLocaleString(locale()),
                        label: proposal.field.label,
                      },
                    )}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <Inline gap={2} wrap={false}>
                      {FOR_EXISTING.map((f) => (
                        <Chip
                          key={f.kind}
                          selected={proposal.forExisting.kind === f.kind}
                          onPress={() => {
                            setProposals((p) =>
                              p.map((x, i) =>
                                i === at
                                  ? {
                                      ...x,
                                      forExisting: {
                                        kind: f.kind,
                                      } as ColumnProposal['forExisting'],
                                    }
                                  : x,
                              ),
                            );
                          }}
                        >
                          {f.label}
                        </Chip>
                      ))}
                    </Inline>
                  </ScrollView>
                  <Text variant="footnote" tone="muted">
                    {proposal.forExistingWhy}
                  </Text>
                </Stack>
              )}
            </Stack>
          </Card>
        </>
      ) : null}

      {step === 'plan' && plan !== null ? (
        <>
          {plan.blocked === null ? null : (
            <Alert
              tone="danger"
              title={t('people.transfer.import.this_cant_run_yet', 'This can’t run yet')}
            >
              {plan.blocked}
            </Alert>
          )}
          {plan.problems.map((p) => (
            <Alert key={p.column} tone="warning" title={p.header}>
              {p.message}
            </Alert>
          ))}
          <Card>
            <Inline gap={2}>
              <Sparkles size={16} />
              <Text weight="semibold">{t('people.transfer.import.the_plan', 'The plan')}</Text>
            </Inline>
            <Text>{plan.short}</Text>
          </Card>
          <List>
            {plan.steps.map((s, i) => (
              <ListItem key={`${s.kind}-${String(i)}`} description={s.detail}>
                {s.title}
              </ListItem>
            ))}
          </List>
          <Card>
            <KeyValues
              items={[
                {
                  label: t('people.transfer.import.new_people', 'New people'),
                  value: String(plan.review.dryRun.counts.create),
                },
                {
                  label: t('people.transfer.import.updated', 'Updated'),
                  value: String(plan.review.dryRun.counts.update),
                },
                {
                  label: t('people.transfer.import.unchanged', 'Unchanged'),
                  value: String(plan.review.dryRun.counts.unchanged),
                },
                {
                  label: t('people.transfer.import.skipped', 'Skipped'),
                  value: String(plan.review.dryRun.counts.blocked),
                },
                {
                  label: t('people.transfer.import.possible_duplicates', 'Possible duplicates'),
                  value: String(plan.review.dryRun.counts.duplicate),
                },
              ]}
            />
          </Card>
          {(plan.review.dryRun.blocked ?? []).length === 0 ? null : (
            <Stack gap={2}>
              <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
                {t('people.transfer.import.rows_that_will_be_skipped', 'Rows that will be skipped')}
              </Text>
              <List>
                {(plan.review.dryRun.blocked ?? []).slice(0, 20).map((b) => (
                  <ListItem
                    key={`${String(b.row)}-${b.cell}`}
                    description={`${b.cell} · ${b.problem}`}
                  >
                    {b.name ??
                      t('people.transfer.import.row', 'Row {{String}}', { String: String(b.row) })}
                  </ListItem>
                ))}
              </List>
              {plan.review.blockedUrl == null ? null : (
                <Button
                  size="sm"
                  onPress={() => void WebBrowser.openBrowserAsync(plan.review.blockedUrl ?? '')}
                >
                  {t(
                    'people.transfer.import.download_the_skipped_rows',
                    'Download the skipped rows',
                  )}
                </Button>
              )}
            </Stack>
          )}
          {workplaces.length === 0 || here === null ? null : (
            <Stack gap={2}>
              <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
                {t(
                  'people.transfer.import.work_locations_in_the_file',
                  'Work locations in the file',
                )}
              </Text>
              {workplaces.map((w) => {
                const choice = places[w.key] ?? w.proposed;
                const value =
                  choice.kind === 'map'
                    ? choice.locationId
                    : choice.kind === 'add'
                      ? '#add'
                      : '#leave';
                return (
                  <Card key={w.key}>
                    <Text weight="semibold">
                      {t(
                        'people.transfer.import.rows',
                        { one: '{{value}} · {{count}} row', other: '{{value}} · {{count}} rows' },
                        { count: w.rows, value: w.value },
                      )}
                    </Text>
                    {w.note === null ? null : (
                      <Text variant="footnote" tone="muted">
                        {w.note}
                      </Text>
                    )}
                    <Select
                      value={value}
                      onValueChange={(next) => {
                        const entity = here.entities[0];
                        const picked: PlaceChoice =
                          next === '#leave'
                            ? { kind: 'leave' }
                            : next === '#add'
                              ? {
                                  kind: 'add',
                                  name: w.value,
                                  country: entity?.country ?? '',
                                  timeZone: entity?.timeZone ?? 'Etc/UTC',
                                  ...(entity === undefined ? {} : { legalEntityId: entity.id }),
                                }
                              : { kind: 'map', locationId: next };
                        setPlaces((p) => ({ ...p, [w.key]: picked }));
                      }}
                    >
                      <SelectTrigger
                        accessibilityLabel={t(
                          'people.transfer.import.location_for',
                          'Location for {{value}}',
                          { value: w.value },
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {here.locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                        <SelectItem value="#add">
                          {t(
                            'people.transfer.import.add_as_a_location',
                            'Add “{{value}}” as a location',
                            { value: w.value },
                          )}
                        </SelectItem>
                        <SelectItem value="#leave">
                          {t('people.transfer.import.leave_it_empty', 'Leave it empty')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Card>
                );
              })}
              <Button size="sm" loading={busy} onPress={() => void makePlan()}>
                {t('people.transfer.import.update_the_plan', 'Update the plan')}
              </Button>
            </Stack>
          )}
          {plan.review.dryRun.sensitive === undefined ||
          plan.review.dryRun.sensitive.values === 0 ? null : (
            <Card>
              <Inline gap={3} justify="between" wrap={false}>
                <Stack gap={1} className="flex-1">
                  <Text weight="semibold">
                    {t('people.transfer.import.sensitive_values', '{{String}} sensitive values', {
                      String: String(plan.review.dryRun.sensitive.values),
                    })}
                  </Text>
                  <Text variant="footnote" tone="muted">
                    {t(
                      'people.transfer.import.they_wait_for_approval_unless_you',
                      '{{join}}. They wait for approval unless you apply them now.',
                      { join: plan.review.dryRun.sensitive.fields.join(', ') },
                    )}
                  </Text>
                </Stack>
                <Switch
                  checked={withoutApproval}
                  onCheckedChange={setWithoutApproval}
                  accessibilityLabel={t(
                    'people.transfer.import.apply_sensitive_values_without_approval',
                    'Apply sensitive values without approval',
                  )}
                />
              </Inline>
            </Card>
          )}
          <Text variant="footnote" tone="muted">
            {t(
              'people.transfer.import.nobody_is_invited_invite_each_person',
              'Nobody is invited. Invite each person from their record.',
            )}
          </Text>
        </>
      ) : null}
    </Page>
  );
}
