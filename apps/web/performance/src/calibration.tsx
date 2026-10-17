import {
  Alert,
  Badge,
  BarChart,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  NumberField,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  icons,
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
  plural,
  score,
  useAct,
  type Act,
} from './shared';
import type { ScaleOption, ScreenProps } from './types';

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
  not_started: 'Not started',
  in_progress: 'In progress',
  finalised: 'Finalised',
};

export function Calibrations(props: ScreenProps<CalibrationsData>): JSX.Element {
  const act = useAct(props);
  const [creating, setCreating] = useState(props.search?.['cycle'] !== undefined);
  return (
    <Loaded load={props.load} what="calibration">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Calibration"
            description="Calibrators compare scores across teams before they are released. Every change keeps its reason."
            actions={
              data.hr ? (
                <Button
                  startIcon={<icons.add aria-hidden />}
                  disabled={data.cycles.length === 0}
                  onClick={() => {
                    setCreating(true);
                  }}
                >
                  New session
                </Button>
              ) : null
            }
          />
          <Refusal error={act.error} />
          <Card>
            <CardContent className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.people aria-hidden />}
                  title="No sessions"
                  description="A session takes the scores of a cycle, or one department of it, and holds them until it is finalised."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session</TableHead>
                      <TableHead>Cycle</TableHead>
                      <TableHead>Calibrators</TableHead>
                      <TableHead>People</TableHead>
                      <TableHead>Meets</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <To
                            href={`/performance/calibration/${s.id}`}
                            onNavigate={props.onNavigate}
                          >
                            {s.name}
                          </To>
                        </TableCell>
                        <TableCell className="text-sm">{s.cycle}</TableCell>
                        <TableCell className="text-sm">{s.calibrators.join(', ')}</TableCell>
                        <TableCell className="text-sm">{String(s.people)}</TableCell>
                        <TableCell className="text-sm">{day(s.meetsOn)}</TableCell>
                        <TableCell>
                          <Badge
                            size="sm"
                            tone={
                              s.state === 'finalised'
                                ? 'success'
                                : s.state === 'in_progress'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {STATE[s.state] ?? s.state}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
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
      title="New calibration session"
      steps={['Group', 'Calibrators', 'Confirm']}
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
            label="Cycle"
            value={cycle}
            options={cycles.map((c) => [c.id, c.name] as const)}
            onChange={setCycle}
          />
          <Field>
            <FieldLabel>Department</FieldLabel>
            <Input
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
              }}
              placeholder="Everyone in the cycle"
            />
          </Field>
          <Field>
            <FieldLabel>Name</FieldLabel>
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
          label="Calibrators"
          value={calibrators}
          onChange={setCalibrators}
          many
        />
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel>Meets on</FieldLabel>
            <Input
              type="date"
              value={meetsOn}
              onChange={(e) => {
                setMeetsOn(e.target.value);
              }}
            />
          </Field>
          <Alert tone="info" title="Scores are held from release">
            {`Submitted manager reviews in ${cycleName}${department === '' ? '' : `, ${department}`} are held until the session is finalised. ${plural(calibrators.length, 'calibrator')} besides HR.`}
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
              description={`${data.cycle} · ${data.session.calibrators.map((c) => c.name).join(', ') || 'HR'} · ${STATE[data.session.state] ?? data.session.state}`}
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
                      Suggest changes
                    </Button>
                  ) : null}
                  {data.may.finalise ? (
                    <Button
                      onClick={() => {
                        setFinalising(true);
                      }}
                    >
                      Finalise
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
                    ? 'Nothing stands out'
                    : `${plural(proposals.length, 'proposal')}, for you to accept or leave`
                }
              >
                <ul className="flex flex-col gap-2">
                  {proposals.map((p) => {
                    const row = data.rows.find((r) => r.personId === p.personId);
                    return (
                      <li key={p.personId} className="flex flex-wrap items-center gap-2">
                        <span>{`${row?.name ?? 'Someone'}: ${score(row?.now)} → ${score(p.now)}. ${p.reason}`}</span>
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
                          Accept
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Alert>
            )}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle level={2}>Performance and potential</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-2">
                    {[0, 1, 2].flatMap((row) => [
                      <span
                        key={`axis-${String(row)}`}
                        className="self-center text-xs text-fg-muted [writing-mode:vertical-rl]"
                      >
                        {row === 0 ? 'High potential' : row === 1 ? 'Potential' : 'Low'}
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
                            >{`${String(c.share)}% · guide ${String(c.guide)}%`}</span>
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
                  <p className="mt-2 text-center text-xs text-fg-muted">Performance: low to high</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle level={2}>Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarChart
                    label="People by score"
                    showValues
                    data={data.scale.map((o) => ({
                      label: o.label,
                      value: data.rows.filter(
                        (r) => r.now !== null && Math.round(r.now / 100) === o.value,
                      ).length,
                    }))}
                  />
                  <p className="mt-2 text-sm text-fg-muted">{`${plural(changed, 'score')} changed in this session`}</p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead>Was</TableHead>
                      <TableHead>Now</TableHead>
                      <TableHead>Reason</TableHead>
                      {data.may.change ? (
                        <TableHead>
                          <span className="sr-only">Change</span>
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
                          {r.now === null ? 'Not submitted' : `${score(r.now)} · ${r.label ?? ''}`}
                          {r.now !== r.was && r.now !== null ? (
                            <Badge size="sm" tone="accent" className="ml-2">
                              Changed
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
                                Change
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
                                Take out
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
                title={`Finalise ${data.session.name}?`}
                description="The scores become final, the reviews held for this session are released to the cycle's release rules, and the session can no longer change."
                footer={
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setFinalising(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      loading={act.pending}
                      onClick={() => {
                        act.run('FinalisePerformanceCalibration', { id: data.session.id }, () => {
                          setFinalising(false);
                        });
                      }}
                    >
                      Finalise
                    </Button>
                  </>
                }
              >
                <p className="text-sm">{`${plural(data.rows.length, 'person', 'people')}, ${plural(changed, 'score')} changed.`}</p>
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
      title={`Change ${row.name}’s score`}
      description={`Submitted by ${row.manager} as ${score(row.was)}. The reason is kept with the change and shown to HR.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
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
            Change
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <NumberField label="Score" value={value} min={lo} max={hi} step={0.1} onChange={setValue} />
      <Field required>
        <FieldLabel>Reason</FieldLabel>
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
