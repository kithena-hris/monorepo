import {
  Alert,
  Badge,
  BarChart,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  type DataColumn,
  DataTable,
  DatePicker,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  formatList,
  icons,
  Input,
  List,
  ListItem,
  NumberField,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import {
  Choose,
  Modal,
  PersonPicker,
  Refusal,
  StepDialog,
  To,
  day,
  score,
  useAct,
  type Act,
} from './shared';
import type { ScaleOption, ScreenProps } from './types';
import { t } from './i18n';

/**
 * Calibration (PRD §17; design PF19 v2): sessions over a cycle's scores, the
 * nine-box with the company's labels and its guide, every change with a
 * reason, AI proposals a person accepts, and finalising, which releases the
 * scores held for it.
 */

export interface CalibrationsData {
  readonly rows: readonly {
    readonly id: string;
    readonly name: string;
    readonly cycle: string;
    readonly cycleId: string;
    readonly calibrators: readonly string[];
    readonly people: number;
    readonly meetsOn: string | null;
    readonly state: string;
  }[];
  readonly cycles: readonly { readonly id: string; readonly name: string }[];
  readonly hr: boolean;
}

const STATE: Readonly<Record<string, string>> = {
  not_started: t('calibration.not_started', 'Not started'),
  in_progress: t('calibration.in_progress', 'In progress'),
  finalised: t('calibration.finalised', 'Finalised'),
};

type SessionRow = CalibrationsData['rows'][number];
const sessionId = (s: SessionRow): string => s.id;
const sessionName = (s: SessionRow): string => s.name;

function sessionColumns(
  onNavigate: ScreenProps<CalibrationsData>['onNavigate'],
): readonly DataColumn<SessionRow>[] {
  return [
    {
      id: 'session',
      header: t('calibration.session', 'Session'),
      sortBy: (s) => s.name,
      cell: (s) => (
        <To href={`/performance/calibration/${s.id}`} onNavigate={onNavigate}>
          {s.name}
        </To>
      ),
    },
    {
      id: 'cycle',
      header: t('calibration.cycle', 'Cycle'),
      sortBy: (s) => s.cycle,
      cell: (s) => <span className="text-sm">{s.cycle}</span>,
    },
    {
      id: 'calibrators',
      header: t('calibration.calibrators', 'Calibrators'),
      hideOnCard: true,
      cell: (s) => <span className="text-sm">{s.calibrators.join(', ')}</span>,
    },
    {
      id: 'people',
      header: t('calibration.people', 'People'),
      numeric: true,
      sortBy: (s) => s.people,
      cell: (s) => <span className="text-sm">{String(s.people)}</span>,
    },
    {
      id: 'meets',
      header: t('calibration.meets', 'Meets'),
      sortBy: (s) => s.meetsOn ?? '',
      cell: (s) => <span className="text-sm">{day(s.meetsOn)}</span>,
    },
    {
      id: 'state',
      header: t('calibration.state', 'State'),
      cardTrailing: true,
      sortBy: (s) => s.state,
      cell: (s) => (
        <Badge
          size="sm"
          tone={
            s.state === 'finalised' ? 'success' : s.state === 'in_progress' ? 'warning' : 'neutral'
          }
        >
          {STATE[s.state] ?? s.state}
        </Badge>
      ),
    },
  ];
}

export function Calibrations(props: ScreenProps<CalibrationsData>): JSX.Element {
  const act = useAct(props);
  const [creating, setCreating] = useState(props.search?.['cycle'] !== undefined);
  return (
    <Loaded load={props.load} what="calibration">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={t('calibration.calibration', 'Calibration')}
            description={t(
              'calibration.calibrators_compare_scores_across_teams_before',
              'Calibrators compare scores across teams before they are released. Every change keeps its reason.',
            )}
            actions={
              data.hr ? (
                <Button
                  startIcon={<icons.add aria-hidden />}
                  disabled={data.cycles.length === 0}
                  onClick={() => {
                    setCreating(true);
                  }}
                >
                  {t('calibration.new_session', 'New session')}
                </Button>
              ) : null
            }
          />
          <Refusal error={act.error} />
          {data.rows.length === 0 ? (
            <EmptyState
              icon={<icons.people aria-hidden />}
              title={t('calibration.no_sessions', 'No sessions')}
              description={t(
                'calibration.a_session_takes_the_scores_of',
                'A session takes the scores of a cycle, or one department of it, and holds them until it is finalised.',
              )}
            />
          ) : (
            <DataTable<SessionRow>
              label={t('calibration.calibration_sessions', 'Calibration sessions')}
              rows={data.rows}
              rowId={sessionId}
              describeRow={sessionName}
              fill
              columns={sessionColumns(props.onNavigate)}
            />
          )}
          {creating && data.hr ? (
            <NewSession
              act={act}
              cycles={data.cycles}
              cycleId={props.search?.['cycle'] ?? data.cycles[0]?.id ?? ''}
              onClose={() => {
                setCreating(false);
                props.onFilter?.({ cycle: null });
              }}
              onNavigate={props.onNavigate}
            />
          ) : null}
        </div>
      )}
    </Loaded>
  );
}

/** PF19f v2: Group · Calibrators · Confirm. */
function NewSession({
  act,
  cycles,
  cycleId,
  onClose,
  onNavigate,
}: {
  readonly act: Act;
  readonly cycles: CalibrationsData['cycles'];
  readonly cycleId: string;
  readonly onClose: () => void;
  readonly onNavigate?: ((to: string) => void) | undefined;
}): JSX.Element {
  const [step, setStep] = useState(0);
  const [cycle, setCycle] = useState(cycleId);
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [calibrators, setCalibrators] = useState<readonly string[]>([]);
  const [meetsOn, setMeetsOn] = useState('');
  const cycleName = cycles.find((c) => c.id === cycle)?.name ?? '';
  return (
    <StepDialog
      open
      onClose={onClose}
      title={t('calibration.new_calibration_session', 'New calibration session')}
      steps={[
        t('calibration.group', 'Group'),
        t('calibration.calibrators', 'Calibrators'),
        t('calibration.confirm', 'Confirm'),
      ]}
      step={step}
      onStep={setStep}
      pending={act.pending}
      canNext={cycle !== ''}
      finishLabel="Open the session"
      finish={() => {
        act.run(
          'CreatePerformanceCalibration',
          {
            input: {
              name:
                name.trim() === ''
                  ? `${cycleName}${department === '' ? '' : ` · ${department}`}`
                  : name,
              cycleId: cycle,
              calibrators,
              subjects: [],
              department: department === '' ? null : department,
              meetsOn: meetsOn === '' ? null : meetsOn,
            },
          },
          (d) => {
            onNavigate?.(`/performance/calibration/${(d as { id: string }).id}`);
          },
        );
      }}
    >
      <Refusal error={act.error} />
      {step === 0 ? (
        <div className="flex flex-col gap-3">
          <Choose
            label={t('calibration.cycle', 'Cycle')}
            value={cycle}
            options={cycles.map((c) => [c.id, c.name] as const)}
            onChange={setCycle}
          />
          <Field>
            <FieldLabel>{t('calibration.department', 'Department')}</FieldLabel>
            <Input
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
              }}
              placeholder={t('calibration.everyone_in_the_cycle', 'Everyone in the cycle')}
            />
          </Field>
          <Field>
            <FieldLabel>{t('calibration.name', 'Name')}</FieldLabel>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder={cycleName}
            />
          </Field>
        </div>
      ) : null}
      {step === 1 ? (
        <PersonPicker
          act={act}
          label={t('calibration.calibrators', 'Calibrators')}
          value={calibrators}
          onChange={setCalibrators}
          many
        />
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel>{t('calibration.meets_on', 'Meets on')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={t('calibration.meets_on', 'Meets on')}
                value={meetsOn === '' ? null : meetsOn}
                onChange={(date) => {
                  setMeetsOn(date ?? '');
                }}
              />
            </FieldControl>
          </Field>
          <Alert
            tone="info"
            title={t('calibration.scores_are_held_from_release', 'Scores are held from release')}
          >
            {t(
              'calibration.submitted_manager_reviews_in_are_held',
              'Submitted manager reviews in {{cycleName}}{{value}} are held until the session is finalised. {{length}} besides HR.',
              {
                cycleName,
                value: department === '' ? '' : `, ${department}`,
                length: t(
                  'calibration.count_calibrators',
                  { one: '{{count}} calibrator', other: '{{count}} calibrators' },
                  { count: calibrators.length },
                ),
              },
            )}
          </Alert>
        </div>
      ) : null}
    </StepDialog>
  );
}

interface Row {
  readonly personId: string;
  readonly name: string;
  readonly manager: string;
  readonly reviewId: string | null;
  readonly was: number | null;
  readonly now: number | null;
  readonly label: string | null;
  readonly reason: string | null;
  readonly state: string | null;
}

export interface CalibrationData {
  readonly session: {
    readonly id: string;
    readonly name: string;
    readonly state: string;
    readonly meetsOn: string | null;
    readonly calibrators: readonly { readonly personId: string; readonly name: string }[];
  };
  readonly cycle: string;
  readonly cells: readonly {
    readonly key: string;
    readonly label: string;
    readonly people: readonly { readonly personId: string; readonly name: string }[];
    readonly guide: number;
    readonly share: number;
  }[];
  readonly rows: readonly Row[];
  readonly scale: readonly ScaleOption[];
  readonly may: { readonly change: boolean; readonly finalise: boolean };
}

export function Calibration(props: ScreenProps<CalibrationData>): JSX.Element {
  const act = useAct(props);
  const [changing, setChanging] = useState<Row | null>(null);
  const [finalising, setFinalising] = useState(false);
  const [proposals, setProposals] = useState<
    readonly { personId: string; now: number; reason: string }[] | null
  >(null);
  return (
    <Loaded load={props.load} what="the session">
      {(data) => {
        const changed = data.rows.filter((r) => r.now !== r.was).length;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={data.session.name}
              description={t('calibration.text', '{{cycle}} · {{value}} · {{value2}}', {
                cycle: data.cycle,
                value:
                  formatList(
                    data.session.calibrators.map((c) => c.name),
                    'unit',
                  ) || t('calibration.hr', 'HR'),
                value2: STATE[data.session.state] ?? data.session.state,
              })}
              actions={
                <>
                  {data.may.change ? (
                    <Button
                      variant="secondary"
                      loading={act.pending}
                      onClick={() => {
                        void act
                          .call('PerformanceCalibrationSuggestions', { id: data.session.id })
                          .then((d) => {
                            if (d.ok)
                              setProposals(
                                (d.data as { proposals: NonNullable<typeof proposals> }).proposals,
                              );
                          });
                      }}
                    >
                      {t('calibration.suggest_changes', 'Suggest changes')}
                    </Button>
                  ) : null}
                  {data.may.finalise ? (
                    <Button
                      onClick={() => {
                        setFinalising(true);
                      }}
                    >
                      {t('calibration.finalise', 'Finalise')}
                    </Button>
                  ) : null}
                </>
              }
            />
            <Refusal error={act.error} />
            {proposals === null ? null : (
              <Alert
                tone="info"
                title={
                  proposals.length === 0
                    ? t('calibration.nothing_stands_out', 'Nothing stands out')
                    : t(
                        'calibration.for_you_to_accept_or_leave',
                        '{{length}}, for you to accept or leave',
                        {
                          length: t(
                            'calibration.count_proposals',
                            { one: '{{count}} proposal', other: '{{count}} proposals' },
                            { count: proposals.length },
                          ),
                        },
                      )
                }
              >
                <List className="mt-2">
                  {proposals.map((p) => {
                    const row = data.rows.find((r) => r.personId === p.personId);
                    return (
                      <ListItem
                        key={p.personId}
                        description={p.reason}
                        meta={t('calibration.text_2', '{{score}} → {{score2}}', {
                          score: score(row?.now),
                          score2: score(p.now),
                        })}
                        trailing={
                          <Button
                            size="xs"
                            variant="secondary"
                            loading={act.pending}
                            onClick={() => {
                              act.run('ChangePerformanceScore', {
                                id: data.session.id,
                                input: { personId: p.personId, now: p.now, reason: p.reason },
                              });
                            }}
                          >
                            {t('calibration.accept', 'Accept')}
                          </Button>
                        }
                      >
                        {row?.name ?? t('calibration.someone', 'Someone')}
                      </ListItem>
                    );
                  })}
                </List>
              </Alert>
            )}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle level={2}>
                    {t('calibration.performance_and_potential', 'Performance and potential')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-2">
                    {[0, 1, 2].flatMap((row) => [
                      <span
                        key={`axis-${String(row)}`}
                        className="self-center text-xs text-fg-muted [writing-mode:vertical-rl]"
                      >
                        {row === 0
                          ? t('calibration.high_potential', 'High potential')
                          : row === 1
                            ? t('calibration.potential', 'Potential')
                            : t('calibration.low', 'Low')}
                      </span>,
                      ...data.cells.slice(row * 3, row * 3 + 3).map((c) => (
                        <div
                          key={c.key}
                          className="flex min-h-24 flex-col gap-1 rounded-md bg-surface-sunken p-2"
                        >
                          <span className="flex items-baseline justify-between gap-1 text-xs">
                            <span className="font-semibold">{c.label}</span>
                            <span
                              className={
                                Math.abs(c.share - c.guide) > 10
                                  ? 'text-warning-fg'
                                  : 'text-fg-muted'
                              }
                            >
                              {t('calibration.guide', '{{share}}% · guide {{guide}}%', {
                                share: String(c.share),
                                guide: String(c.guide),
                              })}
                            </span>
                          </span>
                          {c.people.map((p) => (
                            <span key={p.personId} className="truncate text-sm">
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )),
                    ])}
                  </div>
                  <p className="mt-2 text-center text-xs text-fg-muted">
                    {t('calibration.performance_low_to_high', 'Performance: low to high')}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle level={2}>{t('calibration.distribution', 'Distribution')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarChart
                    label={t('calibration.people_by_score', 'People by score')}
                    showValues
                    data={data.scale.map((o) => ({
                      label: o.label,
                      value: data.rows.filter(
                        (r) => r.now !== null && Math.round(r.now / 100) === o.value,
                      ).length,
                    }))}
                  />
                  <p className="mt-2 text-sm text-fg-muted">
                    {t(
                      'calibration.changed_in_this_session',
                      '{{changed}} changed in this session',
                      {
                        changed: t(
                          'calibration.count_scores',
                          { one: '{{count}} score', other: '{{count}} scores' },
                          { count: changed },
                        ),
                      },
                    )}
                  </p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('calibration.person', 'Person')}</TableHead>
                      <TableHead>{t('calibration.manager', 'Manager')}</TableHead>
                      <TableHead>{t('calibration.was', 'Was')}</TableHead>
                      <TableHead>{t('calibration.now', 'Now')}</TableHead>
                      <TableHead>{t('calibration.reason', 'Reason')}</TableHead>
                      {data.may.change ? (
                        <TableHead>
                          <span className="sr-only">{t('calibration.change', 'Change')}</span>
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.personId}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-sm">{r.manager}</TableCell>
                        <TableCell className="text-sm">{score(r.was)}</TableCell>
                        <TableCell className="text-sm">
                          {r.now === null
                            ? t('calibration.not_submitted', 'Not submitted')
                            : t('calibration.text_3', '{{score}} · {{value}}', {
                                score: score(r.now),
                                value: r.label ?? '',
                              })}
                          {r.now !== r.was && r.now !== null ? (
                            <Badge size="sm" tone="accent" className="ml-2">
                              {t('calibration.changed', 'Changed')}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm text-fg-muted">{r.reason ?? '—'}</TableCell>
                        {data.may.change ? (
                          <TableCell>
                            <span className="flex gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={r.now === null}
                                onClick={() => {
                                  setChanging(r);
                                }}
                              >
                                {t('calibration.change', 'Change')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={act.pending}
                                onClick={() => {
                                  act.run('RemovePerformanceCalibrationSubject', {
                                    id: data.session.id,
                                    input: { personId: r.personId },
                                  });
                                }}
                              >
                                {t('calibration.take_out', 'Take out')}
                              </Button>
                            </span>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            {changing === null ? null : (
              <ChangeDialog
                act={act}
                id={data.session.id}
                row={changing}
                scale={data.scale}
                onClose={() => {
                  setChanging(null);
                }}
              />
            )}
            {finalising ? (
              <Modal
                open
                onClose={() => {
                  setFinalising(false);
                }}
                title={t('calibration.finalise_2', 'Finalise {{name}}?', {
                  name: data.session.name,
                })}
                description={t(
                  'calibration.the_scores_become_final_the_reviews',
                  "The scores become final, the reviews held for this session are released to the cycle's release rules, and the session can no longer change.",
                )}
                footer={
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setFinalising(false);
                      }}
                    >
                      {t('calibration.cancel', 'Cancel')}
                    </Button>
                    <Button
                      loading={act.pending}
                      onClick={() => {
                        act.run('FinalisePerformanceCalibration', { id: data.session.id }, () => {
                          setFinalising(false);
                        });
                      }}
                    >
                      {t('calibration.finalise', 'Finalise')}
                    </Button>
                  </>
                }
              >
                <p className="text-sm">
                  {t('calibration.changed_2', '{{length}}, {{changed}} changed.', {
                    length: t(
                      'calibration.count_people',
                      { one: '{{count}} person', other: '{{count}} people' },
                      { count: data.rows.length },
                    ),
                    changed: t(
                      'calibration.count_scores',
                      { one: '{{count}} score', other: '{{count}} scores' },
                      { count: changed },
                    ),
                  })}
                </p>
              </Modal>
            ) : null}
          </div>
        );
      }}
    </Loaded>
  );
}

function ChangeDialog({
  act,
  id,
  row,
  scale,
  onClose,
}: {
  readonly act: Act;
  readonly id: string;
  readonly row: Row;
  readonly scale: readonly ScaleOption[];
  readonly onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState<number | null>(row.now === null ? null : row.now / 100);
  const [reason, setReason] = useState('');
  const lo = scale[0]?.value ?? 1;
  const hi = scale.at(-1)?.value ?? 5;
  return (
    <Modal
      open
      onClose={onClose}
      title={t('calibration.change_s_score', 'Change {{name}}’s score', { name: row.name })}
      description={t(
        'calibration.submitted_by_as_the_reason_is',
        'Submitted by {{manager}} as {{score}}. The reason is kept with the change and shown to HR.',
        { manager: row.manager, score: score(row.was) },
      )}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('calibration.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={value === null || reason.trim() === ''}
            loading={act.pending}
            onClick={() => {
              act.run(
                'ChangePerformanceScore',
                {
                  id,
                  input: { personId: row.personId, now: Math.round((value ?? 0) * 100), reason },
                },
                onClose,
              );
            }}
          >
            {t('calibration.change', 'Change')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <NumberField
        label={t('calibration.score', 'Score')}
        value={value}
        min={lo}
        max={hi}
        step={0.1}
        onChange={setValue}
      />
      <Field required>
        <FieldLabel>{t('calibration.reason', 'Reason')}</FieldLabel>
        <Textarea
          autoResize
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </Field>
    </Modal>
  );
}
