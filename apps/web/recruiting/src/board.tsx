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
import { t } from './i18n';

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
    <Loaded load={props.load} what={t('board.the_job_board', 'the job board')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={t('board.open_jobs', 'Open jobs')}
            description={
              data.bonus === null
                ? t(
                    'board.refer_someone_you_know_or_apply',
                    'Refer someone you know, or apply yourself.',
                  )
                : t(
                    'board.refer_someone_you_know_when_they',
                    'Refer someone you know: {{amountMinor}} when they pass {{after}}.',
                    {
                      amountMinor: money(data.bonus.amountMinor, data.bonus.currency),
                      after: words(data.bonus.after).toLowerCase(),
                    },
                  )
            }
          />
          <Refusal error={act.error} />
          {data.jobs.length === 0 ? (
            <EmptyState
              icon={<icons.work aria-hidden />}
              title={t('board.no_open_jobs_right_now', 'No open jobs right now')}
            />
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
                        {t('board.refer_someone', 'Refer someone')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={act.pending}
                        onClick={() => {
                          act.run('ApplyInternally', { jobId: j.id, input: {} });
                        }}
                      >
                        {t('board.apply', 'Apply')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle level={2}>{t('board.my_referrals', 'My referrals')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.referrals.length === 0 ? (
                <p className="text-sm text-fg-muted">{t('board.nobody_yet', 'Nobody yet.')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('board.person', 'Person')}</TableHead>
                      <TableHead>{t('board.job', 'Job')}</TableHead>
                      <TableHead>{t('board.referred', 'Referred')}</TableHead>
                      <TableHead>{t('board.where_it_stands', 'Where it stands')}</TableHead>
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
                <DialogTitle>
                  {t('board.refer_someone_2', 'Refer someone: {{value}}', {
                    value: referring?.title ?? '',
                  })}
                </DialogTitle>
                <DialogDescription>
                  {t(
                    'board.they_get_an_email_inviting_them',
                    'They get an email inviting them to apply; nothing is shared until they do.',
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <Field required>
                  <FieldLabel>{t('board.name', 'Name')}</FieldLabel>
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
                  <FieldLabel>{t('board.email', 'Email')}</FieldLabel>
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
                  <FieldLabel>{t('board.why_theyd_be_good', 'Why they’d be good')}</FieldLabel>
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
                  {t('board.cancel', 'Cancel')}
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
                  {t('board.send_invitation', 'Send invitation')}
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
            title={t('board.agencies', 'Agencies')}
            description={t(
              'board.an_agency_submits_through_its_own',
              'An agency submits through its own portal to the jobs you open to it. A candidate belongs to the first agency that submits them, for the ownership period.',
            )}
            actions={
              data.admin ? (
                <Button
                  startIcon={<icons.add aria-hidden />}
                  onClick={() => {
                    setEditing(blank());
                  }}
                >
                  {t('board.add_agency', 'Add agency')}
                </Button>
              ) : null
            }
          />
          <Refusal error={act.error} />
          <Card>
            <CardContent>
              {data.agencies.length === 0 ? (
                <EmptyState
                  icon={<icons.company aria-hidden />}
                  title={t('board.no_agencies', 'No agencies')}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('board.agency', 'Agency')}</TableHead>
                      <TableHead>{t('board.fee', 'Fee')}</TableHead>
                      <TableHead>{t('board.guarantee', 'Guarantee')}</TableHead>
                      <TableHead>{t('board.jobs', 'Jobs')}</TableHead>
                      <TableHead>{t('board.state', 'State')}</TableHead>
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
                            ? t('board.of_first_year_base', '{{value}}% of first-year base', {
                                value: String(a.fee.basisPoints / 100),
                              })
                            : money(a.fee.amountMinor, 'EUR')}
                        </TableCell>
                        <TableCell>
                          {t('board.days', '{{guaranteeDays}} days', {
                            guaranteeDays: String(a.guaranteeDays),
                          })}
                        </TableCell>
                        <TableCell>{String(a.jobIds.length)}</TableCell>
                        <TableCell>
                          <Badge size="sm" tone={a.active ? 'success' : 'neutral'}>
                            {a.active ? t('board.active', 'Active') : t('board.paused', 'Paused')}
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
          <DialogTitle>
            {agency.name === '' ? t('board.add_agency', 'Add agency') : agency.name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field required>
            <FieldLabel>{t('board.name', 'Name')}</FieldLabel>
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
            <FieldLabel>{t('board.contact_email', 'Contact email')}</FieldLabel>
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
            aria-label={t('board.fee', 'Fee')}
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
            <SegmentedControlItem value="percent">
              {t('board.percent', 'Percent')}
            </SegmentedControlItem>
            <SegmentedControlItem value="fixed">{t('board.fixed', 'Fixed')}</SegmentedControlItem>
          </SegmentedControl>
          {a.fee.kind === 'percent' ? (
            <NumberField
              label={t('board.fee_of_first_year_base', 'Fee, % of first-year base')}
              value={a.fee.basisPoints / 100}
              min={0}
              max={100}
              onChange={(n) => {
                setA({ ...a, fee: { kind: 'percent', basisPoints: Math.round((n ?? 0) * 100) } });
              }}
            />
          ) : (
            <NumberField
              label={t('board.fee', 'Fee')}
              value={a.fee.amountMinor / 100}
              min={0}
              onChange={(n) => {
                setA({ ...a, fee: { kind: 'fixed', amountMinor: Math.round((n ?? 0) * 100) } });
              }}
            />
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <NumberField
              label={t('board.guarantee_days', 'Guarantee, days')}
              value={a.guaranteeDays}
              min={0}
              max={365}
              onChange={(n) => {
                setA({ ...a, guaranteeDays: n ?? 0 });
              }}
            />
            <NumberField
              label={t('board.ownership_months', 'Ownership, months')}
              value={a.ownershipMonths}
              min={1}
              max={24}
              onChange={(n) => {
                setA({ ...a, ownershipMonths: n ?? 6 });
              }}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              {t('board.jobs_it_may_submit_to', 'Jobs it may submit to')}
            </legend>
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
            <label htmlFor="agency-active">{t('board.active', 'Active')}</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('board.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={a.name.trim() === '' || !a.contactEmail.includes('@')}
            loading={pending}
            onClick={() => {
              onSave(a);
            }}
          >
            {t('board.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
