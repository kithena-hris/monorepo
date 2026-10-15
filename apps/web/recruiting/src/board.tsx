import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  NumberField,
  PageHeader,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
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
import { Refusal, StateBadge, day, money, newId, useAct, words } from './shared';
import type { Agency, BoardData, ScreenProps, SettingsData } from './types';

/** R8: the internal job board, with refer and apply, and my referrals. */
export function Board(props: ScreenProps<BoardData>): JSX.Element {
  const act = useAct(props);
  const [referring, setReferring] = useState<{ id: string; title: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const close = () => {
    setReferring(null);
    setName('');
    setEmail('');
    setNote('');
  };
  return (
    <Loaded load={props.load} what="the job board">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Open jobs"
            description={
              data.bonus === null
                ? 'Refer someone you know, or apply yourself.'
                : `Refer someone you know: ${money(data.bonus.amountMinor, data.bonus.currency)} when they pass ${words(data.bonus.after).toLowerCase()}.`
            }
          />
          <Refusal error={act.error} />
          {data.jobs.length === 0 ? (
            <EmptyState icon={<icons.work aria-hidden />} title="No open jobs right now" />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.jobs.map((j) => (
                <Card key={j.id}>
                  <CardHeader>
                    <CardTitle level={2}>{j.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <span className="text-sm text-fg-muted">
                      {[j.department, words(j.workMode)].filter(Boolean).join(' · ')}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setReferring({ id: j.id, title: j.title });
                        }}
                      >
                        Refer someone
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={act.pending}
                        onClick={() => {
                          act.run('ApplyInternally', { jobId: j.id, input: {} });
                        }}
                      >
                        Apply
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle level={2}>My referrals</CardTitle>
            </CardHeader>
            <CardContent>
              {data.referrals.length === 0 ? (
                <p className="text-sm text-fg-muted">Nobody yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead>Referred</TableHead>
                      <TableHead>Where it stands</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.referrals.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell>{r.job}</TableCell>
                        <TableCell>{day(r.at)}</TableCell>
                        <TableCell>
                          <StateBadge state={r.outcome} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Dialog
            open={referring !== null}
            onOpenChange={(open) => {
              if (!open) close();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{`Refer someone: ${referring?.title ?? ''}`}</DialogTitle>
                <DialogDescription>
                  They get an email inviting them to apply; nothing is shared until they do.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <Field required>
                  <FieldLabel>Name</FieldLabel>
                  <FieldControl>
                    <Input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                      }}
                    />
                  </FieldControl>
                </Field>
                <Field required>
                  <FieldLabel>Email</FieldLabel>
                  <FieldControl>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                      }}
                    />
                  </FieldControl>
                </Field>
                <Field>
                  <FieldLabel>Why they’d be good</FieldLabel>
                  <FieldControl>
                    <Textarea
                      autoResize
                      value={note}
                      onChange={(e) => {
                        setNote(e.target.value);
                      }}
                    />
                  </FieldControl>
                </Field>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button
                  disabled={name.trim() === '' || !email.includes('@')}
                  loading={act.pending}
                  onClick={() => {
                    act.run(
                      'Refer',
                      {
                        jobId: referring?.id ?? '',
                        input: { name, email, note: note === '' ? null : note },
                      },
                      close,
                    );
                  }}
                >
                  Send invitation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </Loaded>
  );
}

const blank = (): Agency => ({
  id: newId(),
  name: '',
  contactEmail: '',
  fee: { kind: 'percent', basisPoints: 2000 },
  guaranteeDays: 90,
  ownershipMonths: 6,
  active: true,
  jobIds: [],
});

/** R9: agencies, their terms, and the jobs each may submit to. */
export function Agencies(props: ScreenProps<SettingsData>): JSX.Element {
  const act = useAct(props);
  const [editing, setEditing] = useState<Agency | null>(null);
  return (
    <Loaded load={props.load} what="agencies">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Agencies"
            description="An agency submits through its own portal to the jobs you open to it. A candidate belongs to the first agency that submits them, for the ownership period."
            actions={
              data.admin ? (
                <Button
                  startIcon={<icons.add aria-hidden />}
                  onClick={() => {
                    setEditing(blank());
                  }}
                >
                  Add agency
                </Button>
              ) : null
            }
          />
          <Refusal error={act.error} />
          <Card>
            <CardContent>
              {data.agencies.length === 0 ? (
                <EmptyState icon={<icons.company aria-hidden />} title="No agencies" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agency</TableHead>
                      <TableHead>Fee</TableHead>
                      <TableHead>Guarantee</TableHead>
                      <TableHead>Jobs</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.agencies.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          {data.admin ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditing(a);
                              }}
                            >
                              {a.name}
                            </Button>
                          ) : (
                            a.name
                          )}
                          <span className="block text-sm text-fg-muted">{a.contactEmail}</span>
                        </TableCell>
                        <TableCell>
                          {a.fee.kind === 'percent'
                            ? `${String(a.fee.basisPoints / 100)}% of first-year base`
                            : money(a.fee.amountMinor, 'EUR')}
                        </TableCell>
                        <TableCell>{`${String(a.guaranteeDays)} days`}</TableCell>
                        <TableCell>{String(a.jobIds.length)}</TableCell>
                        <TableCell>
                          <Badge size="sm" tone={a.active ? 'success' : 'neutral'}>
                            {a.active ? 'Active' : 'Paused'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {editing === null ? null : (
            <AgencyDialog
              agency={editing}
              jobs={data.jobs}
              pending={act.pending}
              onClose={() => {
                setEditing(null);
              }}
              onSave={(a) => {
                const { id, ...input } = a;
                act.run('SaveAgency', { id, input }, () => {
                  setEditing(null);
                });
              }}
            />
          )}
        </div>
      )}
    </Loaded>
  );
}

function AgencyDialog({
  agency,
  jobs,
  pending,
  onClose,
  onSave,
}: {
  readonly agency: Agency;
  readonly jobs: SettingsData['jobs'];
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onSave: (a: Agency) => void;
}): JSX.Element {
  const [a, setA] = useState(agency);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{agency.name === '' ? 'Add agency' : agency.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <FieldControl>
              <Input
                value={a.name}
                onChange={(e) => {
                  setA({ ...a, name: e.target.value });
                }}
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>Contact email</FieldLabel>
            <FieldControl>
              <Input
                type="email"
                value={a.contactEmail}
                onChange={(e) => {
                  setA({ ...a, contactEmail: e.target.value });
                }}
              />
            </FieldControl>
          </Field>
          <SegmentedControl
            aria-label="Fee"
            value={a.fee.kind}
            onValueChange={(k) => {
              setA({
                ...a,
                fee:
                  k === 'percent'
                    ? { kind: 'percent', basisPoints: 2000 }
                    : { kind: 'fixed', amountMinor: 0 },
              });
            }}
          >
            <SegmentedControlItem value="percent">Percent</SegmentedControlItem>
            <SegmentedControlItem value="fixed">Fixed</SegmentedControlItem>
          </SegmentedControl>
          {a.fee.kind === 'percent' ? (
            <NumberField
              label="Fee, % of first-year base"
              value={a.fee.basisPoints / 100}
              min={0}
              max={100}
              onChange={(n) => {
                setA({ ...a, fee: { kind: 'percent', basisPoints: Math.round((n ?? 0) * 100) } });
              }}
            />
          ) : (
            <NumberField
              label="Fee"
              value={a.fee.amountMinor / 100}
              min={0}
              onChange={(n) => {
                setA({ ...a, fee: { kind: 'fixed', amountMinor: Math.round((n ?? 0) * 100) } });
              }}
            />
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <NumberField
              label="Guarantee, days"
              value={a.guaranteeDays}
              min={0}
              max={365}
              onChange={(n) => {
                setA({ ...a, guaranteeDays: n ?? 0 });
              }}
            />
            <NumberField
              label="Ownership, months"
              value={a.ownershipMonths}
              min={1}
              max={24}
              onChange={(n) => {
                setA({ ...a, ownershipMonths: n ?? 6 });
              }}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Jobs it may submit to</legend>
            {jobs.map((j) => (
              <div key={j.id} className="flex items-center gap-3">
                <Switch
                  id={`agency-job-${j.id}`}
                  checked={a.jobIds.includes(j.id)}
                  onCheckedChange={(on) => {
                    setA({
                      ...a,
                      jobIds: on ? [...a.jobIds, j.id] : a.jobIds.filter((x) => x !== j.id),
                    });
                  }}
                />
                <label htmlFor={`agency-job-${j.id}`}>{j.title}</label>
              </div>
            ))}
          </fieldset>
          <div className="flex items-center gap-3">
            <Switch
              id="agency-active"
              checked={a.active}
              onCheckedChange={(on) => {
                setA({ ...a, active: on });
              }}
            />
            <label htmlFor="agency-active">Active</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={a.name.trim() === '' || !a.contactEmail.includes('@')}
            loading={pending}
            onClick={() => {
              onSave(a);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
