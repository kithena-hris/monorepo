import {
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChatDivider,
  ChatLog,
  ChatMessage,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  KeyValues,
  List,
  ListItem,
  PageHeader,
  SegmentedControl,
  SegmentedControlItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  icons,
  IconTile,
  ModalPageBody,
  ModalPageFooter,
  ModalPageHeader,
  Stepper,
} from '@reach/ui';
import { Fragment, useEffect, useState, type JSX, type ReactNode } from 'react';

import { Loaded } from './load';
import {
  CATEGORY_TONE,
  MoreMenu,
  Refusal,
  StateBadge,
  To,
  day,
  money,
  useAct,
  when,
  whereFrom,
  words,
  type MoreItem,
} from './shared';
import { EmailComposer, type ComposedEmail } from './composer';
import { AskList } from './interviews';
import { Journey } from './journey';
import { OfferModal } from './offers';
import { RejectDialog, type Rejecting } from './reject-dialog';
import type {
  Category,
  CandidateData,
  CandidatesData,
  OfferData,
  PoolsData,
  ScreenProps,
} from './types';
import { t as tr } from './i18n';

/**
 * R11, R12, a candidate (design R11–R12): one record across applications.
 * The applications on the left; on the right the chosen one's stage and
 * actions, then tabs for the profile, answers, interviews, messages,
 * activity and offers, each as the viewer's role allows. The tab is in the
 * address.
 */

const VERDICT: Readonly<Record<string, { label: string; tone: 'success' | 'info' | 'neutral' }>> = {
  met: {
    get label(): string {
      return tr('candidate.met', 'Met');
    },
    tone: 'success',
  },
  partly_met: {
    get label(): string {
      return tr('candidate.partly_met', 'Partly met');
    },
    tone: 'info',
  },
  not_met: {
    get label(): string {
      return tr('candidate.not_met', 'Not met');
    },
    tone: 'neutral',
  },
  not_evidenced: {
    get label(): string {
      return tr('candidate.not_evidenced', 'Not evidenced');
    },
    tone: 'neutral',
  },
};

/**
 * PRD §14.3, §22.4, §22.5: the evidence matrix beside the person's own view.
 * Each verdict shows its quotes, the model and the date, and asks whether it
 * was right; the band is a label beside the stage, never instead of it.
 */
function Evidence({
  application,
  props,
}: {
  readonly application: CandidateData['applications'][number];
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const matrix = application.matrix ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>
          {tr('candidate.evidence_against_the_criteria', 'Evidence against the criteria')}
        </CardTitle>
        <CardDescription>
          {matrix === null
            ? tr(
                'candidate.a_model_reads_the_masked_application',
                'A model reads the masked application against the job’s criteria and quotes what it found. You decide.',
              )
            : tr(
                'candidate.match_a_label_not_a_decision',
                '{{model}} · {{at}} · {{band}} match. A label, not a decision.',
                { model: matrix.model, at: day(matrix.at), band: words(matrix.band) },
              )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Refusal error={act.error} />
        {matrix === null ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr('candidate.criterion', 'Criterion')}</TableHead>
                <TableHead>{tr('candidate.verdict', 'Verdict')}</TableHead>
                <TableHead>{tr('candidate.what_it_read', 'What it read')}</TableHead>
                <TableHead>{tr('candidate.was_this_right', 'Was this right?')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.findings.map((f) => (
                <TableRow key={f.criterionId}>
                  <TableCell>
                    {f.criterion}
                    {f.must ? (
                      <span className="block text-xs text-fg-muted">
                        {tr('candidate.must_have', 'Must-have')}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge size="sm" tone={VERDICT[f.verdict]?.tone ?? 'neutral'}>
                      {VERDICT[f.verdict]?.label ?? f.verdict}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {f.passages.map((q) => (
                      <q key={q} className="block">
                        {q}
                      </q>
                    ))}
                    {f.why === '' ? null : <span className="block text-fg-muted">{f.why}</span>}
                  </TableCell>
                  <TableCell>
                    <SegmentedControl
                      aria-label={tr(
                        'candidate.was_the_verdict_on_right',
                        'Was the verdict on {{criterion}} right?',
                        { criterion: f.criterion },
                      )}
                      value={f.agreed === null ? '' : f.agreed ? 'yes' : 'no'}
                      disabled={act.pending}
                      onValueChange={(v) => {
                        act.run('AgreeWithFinding', {
                          applicationId: application.applicationId,
                          assessmentId: matrix.assessmentId,
                          criterionId: f.criterionId,
                          input: { agreed: v === 'yes' },
                        });
                      }}
                    >
                      <SegmentedControlItem value="yes">
                        {tr('candidate.yes', 'Yes')}
                      </SegmentedControlItem>
                      <SegmentedControlItem value="no">
                        {tr('candidate.no', 'No')}
                      </SegmentedControlItem>
                    </SegmentedControl>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Button
          variant="secondary"
          loading={act.pending}
          onClick={() => {
            act.run('AssessMatrix', { applicationId: application.applicationId });
          }}
        >
          {matrix === null
            ? tr('candidate.read_against_the_criteria', 'Read against the criteria')
            : tr('candidate.read_again', 'Read again')}
        </Button>
      </CardContent>
    </Card>
  );
}

interface Said {
  readonly value: string;
  readonly passage: string;
}
interface Parsed {
  readonly profile: {
    readonly work: readonly {
      readonly employer: Said;
      readonly title: Said;
      readonly from: Said;
      readonly to: Said | null;
    }[];
    readonly skills: readonly Said[];
    readonly languages: readonly (Said & { readonly level: string | null })[];
    readonly certifications: readonly Said[];
  };
  readonly issues: readonly { readonly code: string; readonly path: string }[];
  readonly confirmedAt: string | null;
  readonly note: string | null;
}

/** PRD §14.2: what the model read from the masked CV, each line with its passage; a person checks it. */
function ReadCv({
  application,
  props,
}: {
  readonly application: CandidateData['applications'][number];
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const { call } = act;
  useEffect(() => {
    void call('RecruitingParsedProfile', { applicationId: application.applicationId }).then(
      (done) => {
        setParsed(done.ok ? (done.data as Parsed | null) : null);
      },
    );
  }, [call, application.applicationId]);
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{tr('candidate.read_from_the_cv', 'Read from the CV')}</CardTitle>
        <CardDescription>
          {tr(
            'candidate.a_model_read_the_masked_text',
            'A model read the masked text; anything it could not quote was left out.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Refusal error={act.error} />
        {parsed === null ? (
          <Button
            variant="secondary"
            loading={act.pending}
            onClick={() => {
              act.run('ParseCv', { applicationId: application.applicationId }, (data) => {
                setParsed(data as Parsed);
              });
            }}
          >
            {tr('candidate.read_the_cv', 'Read the CV')}
          </Button>
        ) : (
          <>
            {parsed.confirmedAt === null ? (
              <Badge size="sm" tone="neutral">
                {tr(
                  'candidate.not_yet_checked_by_the_candidate',
                  'Not yet checked by the candidate',
                )}
              </Badge>
            ) : (
              <Badge size="sm" tone="success">
                {tr(
                  'candidate.checked_by_the_candidate',
                  'Checked by the candidate {{confirmedAt}}',
                  { confirmedAt: day(parsed.confirmedAt) },
                )}
              </Badge>
            )}
            {parsed.note === null ? null : (
              <Alert tone="info" title={tr('candidate.the_candidate_says', 'The candidate says')}>
                {parsed.note}
              </Alert>
            )}
            {parsed.issues.some((i) => i.code !== 'not_in_text') ? (
              <Alert tone="warning" title={tr('candidate.dates_to_check', 'Dates to check')}>
                {tr(
                  'candidate.some_dates_are_out_of_order',
                  'Some dates are out of order or after today; they are shown as written.',
                )}
              </Alert>
            ) : null}
            <ul className="flex flex-col gap-2">
              {parsed.profile.work.map((w) => (
                <li key={`${w.employer.value}:${w.from.value}`}>
                  <span className="font-medium">
                    {tr('candidate.text', '{{value}}, {{value2}}', {
                      value: w.title.value,
                      value2: w.employer.value,
                    })}
                  </span>
                  <span className="block text-sm text-fg-muted">
                    {w.to === null
                      ? tr('candidate.from_to_now', '{{value}} – now · “{{passage}}”', {
                          value: w.from.value,
                          passage: w.employer.passage,
                        })
                      : tr('candidate.text_2', '{{value}} – {{value2}} · “{{passage}}”', {
                          value: w.from.value,
                          value2: w.to.value,
                          passage: w.employer.passage,
                        })}
                  </span>
                </li>
              ))}
            </ul>
            <ChipRow>
              {[...parsed.profile.skills, ...parsed.profile.certifications].map((x) => (
                <Chip key={x.value}>{x.value}</Chip>
              ))}
              {parsed.profile.languages.map((l) => (
                <Chip key={l.value}>
                  {l.level === null
                    ? l.value
                    : tr('candidate.text_3', '{{value}} {{level}}', {
                        value: l.value,
                        level: l.level,
                      })}
                </Chip>
              ))}
            </ChipRow>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The offer, on the candidate's profile, from the offer stage on: one card
 * to press, whether there is an offer yet or not. With none it starts one;
 * with one it shows where it stands and opens it.
 */
function OfferCard({
  name,
  offer,
  onOpen,
}: {
  readonly name: string;
  readonly offer: {
    readonly state: string;
    readonly version: number;
    readonly startDate: string;
    readonly baseMinor: number;
    readonly currency: string;
  } | null;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <Card padded className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <IconTile tone="accent">
          <icons.document aria-hidden />
        </IconTile>
        <div className="min-w-0">
          <p className="font-semibold">
            {offer === null
              ? tr('candidate.ready_for_an_offer', 'Ready for an offer')
              : tr('candidate.offer_version_state', 'Offer, version {{version}}', {
                  version: offer.version,
                })}
          </p>
          <p className="text-sm text-fg-muted">
            {offer === null
              ? tr(
                  'candidate.make_the_offer_hint',
                  'Write the terms, pay and benefits for {{name}}: they are checked against the band and approved before {{name}} sees them.',
                  { name },
                )
              : tr('candidate.offer_summary', '{{pay}} · starts {{start}}', {
                  pay: money(offer.baseMinor, offer.currency),
                  start: day(offer.startDate),
                })}
          </p>
        </div>
        {offer === null ? null : <StateBadge state={offer.state} />}
      </div>
      <Button onClick={onOpen} startIcon={offer === null ? <icons.add aria-hidden /> : undefined}>
        {offer === null
          ? tr('candidate.make_an_offer', 'Make an offer')
          : tr('candidate.open_the_offer', 'Open the offer')}
      </Button>
    </Card>
  );
}

/**
 * The contract stage: the accepted offer becomes a contract. The card opens
 * it, where Kithena drafts it from the offer and the law of the employing
 * entity, HR checks every fact, and sends it to sign.
 */
function ContractCard({
  name,
  onOpen,
}: {
  readonly name: string;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <Card padded className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <IconTile tone="accent">
          <icons.document aria-hidden />
        </IconTile>
        <div className="min-w-0">
          <p className="font-semibold">
            {tr('candidate.prepare_the_contract_title', 'Prepare the contract')}
          </p>
          <p className="text-sm text-fg-muted">
            {tr(
              'candidate.prepare_the_contract_hint',
              '{{name}} accepted the offer. Kithena drafts the contract from it and the law of the employing entity; you check every fact and send it to {{name}} to sign.',
              { name },
            )}
          </p>
        </div>
      </div>
      <Button onClick={onOpen} startIcon={<icons.document aria-hidden />}>
        {tr('candidate.prepare_the_contract', 'Prepare the contract')}
      </Button>
    </Card>
  );
}

interface HireAccount {
  readonly personId: string;
  readonly status: string;
  readonly state: 'not_invited' | 'scheduled' | 'invited' | 'signed_up';
  readonly sendOn: string | null;
  readonly sentAt: string | null;
}

/**
 * Hired: the invitation to set up an account at the company, now or on a
 * day. People holds the hire from the signature on, and the sign-up page has
 * their details filled in from it; signing up makes them an employee who is
 * onboarding until the first day. Hidden where the company has no People.
 */
function AccountCard({
  name,
  email,
  props,
  onPerson,
}: {
  readonly name: string;
  readonly email: string;
  readonly props: ScreenProps<CandidateData>;
  /** Their record in People, once it is there: what the links beside it open. */
  readonly onPerson?: (personId: string) => void;
}): JSX.Element | null {
  const act = useAct(props);
  const [account, setAccount] = useState<HireAccount | null | 'loading' | 'absent'>('loading');
  const [sendOn, setSendOn] = useState<string | null>(null);
  const load = (): void => {
    void act.call('HireAccount', { email }).then((done) => {
      const found = done.ok ? ((done.data as HireAccount | null) ?? null) : 'absent';
      setAccount(found);
      if (found !== 'absent' && found !== null) onPerson?.(found.personId);
    });
  };
  useEffect(load, [email]);
  if (account === 'absent') return null;
  const invite = (on: string | null): void => {
    act.run(
      'InviteHire',
      { personId: account === 'loading' || account === null ? '' : account.personId, sendOn: on },
      (made) => {
        setAccount(made as HireAccount);
        setSendOn(null);
      },
    );
  };
  const said =
    account === 'loading'
      ? tr('candidate.account_loading', 'Looking up {{name}}’s account…', { name })
      : account === null
        ? tr(
            'candidate.account_no_record_yet',
            '{{name}}’s record in People is being made from the signed contract. It is here in a moment.',
            { name },
          )
        : account.state === 'signed_up'
          ? tr(
              'candidate.account_signed_up',
              '{{name}} signed up and is an employee, onboarding until their first day.',
              { name },
            )
          : account.state === 'invited'
            ? tr(
                'candidate.account_invited',
                'Invitation sent on {{date}}. {{name}} confirms the details already filled in, adds what is missing, and signs up.',
                { name, date: day((account.sentAt ?? '').slice(0, 10)) },
              )
            : account.state === 'scheduled'
              ? tr('candidate.account_scheduled', 'The invitation goes to {{name}} on {{date}}.', {
                  name,
                  date: day(account.sendOn ?? ''),
                })
              : tr(
                  'candidate.account_not_invited',
                  'Invite {{name}} to set up their account at the company, now or on a day you choose. The sign-up page has their details filled in from the contract.',
                  { name },
                );
  const live = account !== 'loading' && account !== null && account.state !== 'signed_up';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <IconTile
          tone={account !== 'loading' && account?.state === 'signed_up' ? 'success' : 'accent'}
        >
          <icons.people aria-hidden />
        </IconTile>
        <div className="min-w-0">
          <p className="font-semibold">{tr('candidate.account_title', 'Account at the company')}</p>
          <p className="text-sm text-fg-muted">{said}</p>
        </div>
        {account !== 'loading' && account !== null ? (
          <StateBadge
            state={
              account.state === 'signed_up'
                ? 'approved'
                : account.state === 'not_invited'
                  ? 'draft'
                  : 'pending_approval'
            }
            label={
              account.state === 'signed_up'
                ? tr('candidate.account_state_onboarding', 'Onboarding')
                : account.state === 'invited'
                  ? tr('candidate.account_state_invited', 'Invited')
                  : account.state === 'scheduled'
                    ? tr('candidate.account_state_scheduled', 'Scheduled')
                    : tr('candidate.account_state_not_invited', 'Not invited')
            }
          />
        ) : null}
      </div>
      <Refusal error={act.error} />
      {live ? (
        <div className="flex flex-wrap items-end gap-3">
          <Button
            loading={act.pending}
            startIcon={<icons.email aria-hidden />}
            onClick={() => {
              invite(null);
            }}
          >
            {account.state === 'invited'
              ? tr('candidate.send_invitation_again', 'Send it again')
              : tr('candidate.send_invitation_now', 'Send the invitation now')}
          </Button>
          {account.state === 'invited' ? null : (
            <>
              <DatePicker
                label={tr('candidate.or_send_it_on', 'Or send it on')}
                value={sendOn ?? account.sendOn}
                onChange={(d) => {
                  setSendOn(d);
                }}
              />
              <Button
                variant="secondary"
                disabled={sendOn === null}
                loading={act.pending}
                onClick={() => {
                  invite(sendOn);
                }}
              >
                {tr('candidate.schedule_invitation', 'Schedule')}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Hired, until the first day (PRD §21.3): one place for what is left. Their
 * account at the company and the invitation to sign up, now or on a day;
 * each pre-hire condition, met or waived here; and where to ask for
 * anything more: what the sign-up page asks (People's fields), a document
 * (Documents), and their onboarding plan (Onboarding), each where the
 * company has it.
 */
function FirstDay({
  name,
  email,
  application,
  planId,
  props,
}: {
  readonly name: string;
  readonly email: string | undefined;
  readonly application: CandidateData['applications'][number];
  readonly planId: string | null;
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const [personId, setPersonId] = useState<string | null>(null);
  const prehire = application.prehire;
  const decide = (kind: string, state: 'met' | 'waived'): void => {
    act.run('DecideCondition', {
      applicationId: application.applicationId,
      kind,
      input: { state, note: null },
    });
  };
  const links = [
    personId === null
      ? null
      : { href: `/people/${personId}`, label: tr('candidate.first_day_profile', 'Their profile') },
    personId === null
      ? null
      : {
          href: `/documents/people/${personId}`,
          label: tr('candidate.first_day_documents', 'Ask for a document'),
        },
    {
      href: '/settings/people/fields',
      label: tr('candidate.first_day_signup', 'What sign-up asks'),
    },
    planId === null
      ? null
      : {
          href: `/onboarding/plans/${planId}`,
          label: tr('candidate.first_day_plan', 'Onboarding plan'),
        },
  ].filter((l) => l !== null);
  return (
    <Section
      id="first-day"
      title={tr('candidate.first_day_title', 'Before the first day')}
      description={
        prehire === null
          ? tr(
              'candidate.first_day_hint',
              'What is left before {{name}} starts, and where to ask them for anything more.',
              { name },
            )
          : tr(
              'candidate.first_day_hint_dated',
              'What is left before {{name}} starts on {{date}}, and where to ask them for anything more.',
              { name, date: day(prehire.startDate) },
            )
      }
      action={prehire === null ? null : <StateBadge state={prehire.state} />}
    >
      <div className="flex flex-col gap-6">
        {email === undefined ? null : (
          <AccountCard name={name} email={email} props={props} onPerson={setPersonId} />
        )}
        {prehire === null || prehire.conditions.length === 0 ? null : (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="font-semibold">{tr('candidate.first_day_conditions', 'Conditions')}</h3>
            <Refusal error={act.error} />
            <ul className="flex flex-col gap-2">
              {prehire.conditions.map((c) => (
                <li key={c.kind} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">{words(c.kind)}</span>
                  {c.state === 'open' ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={act.pending}
                        onClick={() => {
                          decide(c.kind, 'met');
                        }}
                      >
                        {tr('candidate.condition_met', 'Met')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={act.pending}
                        onClick={() => {
                          decide(c.kind, 'waived');
                        }}
                      >
                        {tr('candidate.condition_waive', 'Waive')}
                      </Button>
                    </>
                  ) : (
                    <StateBadge state={c.state} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="font-semibold">{tr('candidate.first_day_more', 'Ask for more')}</h3>
          <p className="text-sm text-fg-muted">
            {tr(
              'candidate.first_day_more_hint',
              'The sign-up page asks for the fields People collects at sign-up; anything else, ask for as a document or a task in their onboarding plan.',
            )}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {links.map((l) => (
              <To key={l.href} href={l.href} onNavigate={props.onNavigate}>
                {l.label}
              </To>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

/** R18: the referees the candidate named; each is asked only when someone here says so. */
function References({
  application,
  props,
}: {
  readonly application: CandidateData['applications'][number];
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const can = application.may.includes('candidate.message');
  return (
    <div className="flex flex-col gap-4">
      {application.references.length === 0 ? (
        <EmptyState
          icon={<icons.people aria-hidden />}
          title={tr('candidate.no_referees_named', 'No referees named')}
          description={tr(
            'candidate.the_candidate_names_referees_on_their',
            'The candidate names referees on their page; nobody is contacted before that.',
          )}
        />
      ) : null}
      {application.references.map((r) => (
        <div key={r.id} className="flex flex-col gap-2 border-b border-[var(--reach-line)] pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold">{r.refereeName}</span>
            <span className="text-sm text-fg-muted">
              {[r.relationship, r.refereeEmail].filter(Boolean).join(' · ')}
            </span>
            <StateBadge state={r.state} />
            {can && r.state === 'named' ? (
              <Button
                size="sm"
                variant="secondary"
                loading={act.pending}
                onClick={() => {
                  act.run('RequestReference', {
                    applicationId: application.applicationId,
                    referenceId: r.id,
                  });
                }}
              >
                {tr('candidate.ask_for_the_reference', 'Ask for the reference')}
              </Button>
            ) : null}
          </div>
          {r.answers === null ? null : (
            <KeyValues
              items={Object.entries(r.answers).map(([k, v]) => ({ label: words(k), value: v }))}
            />
          )}
        </div>
      ))}
      <Refusal error={act.error} />
    </div>
  );
}

/**
 * One email in the thread: who sent it above the bubble, the subject, and a
 * long body folded to its first lines until asked for. The candidate's on the
 * left, the team's on the right, each with a face.
 */
function Email({
  message: m,
  sender,
  face,
}: {
  readonly message: CandidateData['messages'][number];
  readonly sender: string;
  /** Whose face it wears: the person who wrote it, or the company for one sent on its own. */
  readonly face: string;
}): JSX.Element {
  const [whole, setWhole] = useState(false);
  const long = m.body.length > 320 || m.body.split('\n').length > 6;
  return (
    <ChatMessage
      from={m.direction === 'out' ? 'self' : 'other'}
      author={sender}
      named
      soft
      avatar={<Avatar name={face} size="sm" className="size-7 text-[0.625rem]" />}
      unsent={m.direction === 'out' && m.sentAt === null}
      meta={
        m.direction === 'out'
          ? m.sentAt === null
            ? tr('candidate.sends', 'Sends {{sendAt}}', { sendAt: when(m.sendAt) })
            : tr('candidate.sent', 'Sent {{sentAt}}', { sentAt: when(m.sentAt) })
          : tr('candidate.received', 'Received {{createdAt}}', { createdAt: when(m.createdAt) })
      }
      {...(long
        ? {
            footer: (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={whole}
                onClick={() => {
                  setWhole(!whole);
                }}
              >
                {whole
                  ? tr('candidate.show_less', 'Show less')
                  : tr('candidate.show_the_whole_email', 'Show the whole email')}
              </Button>
            ),
          }
        : {})}
    >
      <span className="block font-semibold">{m.subject}</span>
      <span
        className={`block whitespace-pre-wrap [overflow-wrap:anywhere] ${long && !whole ? 'line-clamp-5' : ''}`}
      >
        {m.body}
      </span>
    </ChatMessage>
  );
}

function Messages({
  data,
  application,
  props,
}: {
  readonly data: CandidateData;
  readonly application: CandidateData['applications'][number];
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [intent, setIntent] = useState('');
  // The form opens when there is something to write, so the thread is what the section shows.
  const [writing, setWriting] = useState(false);
  const can = application.may.includes('candidate.message');
  return (
    <div className="flex flex-col gap-4">
      {data.messages.length === 0 ? (
        <EmptyState
          icon={<icons.message aria-hidden />}
          title={tr('candidate.no_messages_yet', 'No messages yet')}
          description={tr(
            'candidate.emails_to_and_from_the_candidate',
            'Emails to and from the candidate land here; replies arrive on the thread.',
          )}
        />
      ) : (
        // A thread, as a mail app shows one: the newest at the bottom, in view; the rest a scroll up.
        <ChatLog
          label={tr('candidate.emails_with', 'Emails with {{name}}', { name: data.candidate.name })}
          className="max-h-[32rem] pe-1"
        >
          {data.messages.map((m, i) => {
            const at = m.direction === 'out' ? (m.sentAt ?? m.sendAt) : m.createdAt;
            const before = data.messages[i - 1];
            const beforeAt =
              before === undefined
                ? null
                : before.direction === 'out'
                  ? (before.sentAt ?? before.sendAt)
                  : before.createdAt;
            return (
              <Fragment key={m.id}>
                {beforeAt !== null && day(beforeAt) === day(at) ? null : (
                  <ChatDivider>{day(at)}</ChatDivider>
                )}
                <Email
                  message={m}
                  face={
                    m.direction === 'in'
                      ? data.candidate.name
                      : m.fromPerson == null
                        ? (data.company ?? tr('candidate.the_company', 'The company'))
                        : (data.names?.[m.fromPerson] ??
                          data.company ??
                          tr('candidate.the_company', 'The company'))
                  }
                  sender={
                    m.direction === 'in'
                      ? data.candidate.name
                      : m.fromPerson == null
                        ? tr('candidate.company_automatically', '{{company}}, sent automatically', {
                            company: data.company ?? tr('candidate.the_company', 'The company'),
                          })
                        : tr('candidate.person_at_company', '{{person}}, {{company}}', {
                            person:
                              data.names?.[m.fromPerson] ??
                              data.company ??
                              tr('candidate.the_company', 'The company'),
                            company: data.company ?? tr('candidate.the_company', 'The company'),
                          })
                  }
                />
              </Fragment>
            );
          })}
        </ChatLog>
      )}
      {!can ? null : writing ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Refusal error={act.error} />
          <div className="flex flex-wrap items-end gap-2">
            <Field className="min-w-0 flex-1">
              <FieldLabel>{tr('candidate.draft_it_for_me', 'Draft it for me')}</FieldLabel>
              <FieldControl>
                <Input
                  value={intent}
                  placeholder={tr(
                    'candidate.invite_to_a_second_interview_next',
                    'Invite to a second interview next week',
                  )}
                  onChange={(e) => {
                    setIntent(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
            <Button
              variant="secondary"
              loading={act.pending}
              disabled={intent.trim() === ''}
              onClick={() => {
                act.run(
                  'DraftEmail',
                  {
                    applicationId: application.applicationId,
                    input: { intent },
                  },
                  (d) => {
                    const draft = d as { subject: string; body: string };
                    setSubject(draft.subject);
                    setBody(draft.body);
                  },
                );
              }}
            >
              {tr('candidate.draft', 'Draft')}
            </Button>
          </div>
          <Field required>
            <FieldLabel>{tr('candidate.subject', 'Subject')}</FieldLabel>
            <FieldControl>
              <Input
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>{tr('candidate.message', 'Message')}</FieldLabel>
            <FieldControl>
              <Textarea
                rows={5}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setWriting(false);
              }}
            >
              {tr('candidate.cancel', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              startIcon={<icons.send aria-hidden />}
              loading={act.pending}
              disabled={subject.trim() === '' || body.trim() === ''}
              onClick={() => {
                act.run(
                  'SendMessage',
                  {
                    applicationId: application.applicationId,
                    input: { subject, body, templateId: null },
                  },
                  () => {
                    setSubject('');
                    setBody('');
                    setWriting(false);
                  },
                );
              }}
            >
              {tr('candidate.send', 'Send')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            startIcon={<icons.edit aria-hidden />}
            onClick={() => {
              setWriting(true);
            }}
          >
            {tr('candidate.write_an_email', 'Write an email')}
          </Button>
        </div>
      )}
    </div>
  );
}

function Notes({
  data,
  application,
  props,
}: {
  readonly data: CandidateData;
  readonly application: CandidateData['applications'][number];
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const [note, setNote] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{tr('candidate.notes', 'Notes')}</CardTitle>
        <CardDescription>
          {tr(
            'candidate.private_to_the_hiring_team_interviewers',
            'Private to the hiring team; interviewers see them only after their scorecard',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.notes.map((n) => (
          <div key={n.id} className="flex gap-2">
            <Avatar name={data.names?.[n.authorId] ?? n.authorId} size="sm" />
            <div>
              <div className="text-xs text-fg-muted">
                {[data.names?.[n.authorId], day(n.createdAt)].filter(Boolean).join(' · ')}
              </div>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </div>
          </div>
        ))}
        <Refusal error={act.error} />
        <Field>
          <FieldLabel>{tr('candidate.add_a_note', 'Add a note')}</FieldLabel>
          <FieldControl>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </FieldControl>
        </Field>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            disabled={note.trim() === ''}
            loading={act.pending}
            onClick={() => {
              act.run(
                'AddNote',
                {
                  candidateId: data.candidate.id,
                  input: { applicationId: application.applicationId, body: note, mentions: [] },
                },
                () => {
                  setNote('');
                },
              );
            }}
          >
            {tr('candidate.add_note', 'Add note')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/*
 * THESIS: one application, one surface. The candidate leads, the stage rail is
 * the control, and the next step is the one button in view; it refuses the
 * tabbed profile whose header is a row of buttons.
 * OWN-WORLD: Reach as it is: canvas, raised cards, the accent only on the
 * current stage and the primary action, Stepper as the rail, ModalPage over
 * the board.
 * STORY: the recruiter sees who it is, where they stand and what is owed, moves
 * them on from the rail or the one button, and reads interviews, scorecards,
 * answers and notes without changing tab.
 * FIRST VIEWPORT: name and stage meta in the header with the next action,
 * Reject and More; under it the identity strip (avatar, job, contact) and the
 * rail across the page; then the work column and the notes column.
 * FORM: Operate, an established world; the seed script answered nothing, so
 * the first-ranked structure (rail-led single page) was built.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */

type Application = CandidateData['applications'][number];
type Actions = Pick<ScreenProps<unknown>, 'onAct' | 'onRefresh' | 'onNavigate' | 'onFilter'>;

/** A section of the spotlight: a card with its heading, a line under it and, at most, one action. */
function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly action?: JSX.Element | null;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle level={2}>{title}</CardTitle>
          {description === undefined ? null : <CardDescription>{description}</CardDescription>}
        </div>
        {action ?? null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A recommendation in words and a tone: what a scorecard said, at a glance. */
/** Scorecards that are in: who scored, their recommendation, how they rated each competency, their notes and when. */
function Scorecards({
  cards,
  names,
  competencies,
}: {
  readonly cards: CandidateData['applications'][number]['scorecards'];
  readonly names: Readonly<Record<string, string>>;
  readonly competencies: Readonly<Record<string, string>>;
}): JSX.Element | null {
  if (cards.length === 0) return null;
  return (
    <List aria-label={tr('candidate.scorecards_in', 'Scorecards in')}>
      {cards.map((c) => {
        const ratings = Object.entries(c.ratings);
        const average =
          ratings.length === 0
            ? null
            : ratings.reduce((a, [, b]) => a + b, 0) / ratings.length;
        const name = names[c.interviewerId] ?? tr('candidate.an_interviewer', 'An interviewer');
        const notes = c.notes ?? null;
        return (
          <ListItem
            key={`${c.interviewId}:${c.interviewerId}`}
            leading={<Avatar name={name} size="sm" />}
            description={
              average === null
                ? tr('candidate.submitted_on', 'Submitted {{at}}', {
                    at: when(c.submittedAt ?? ''),
                  })
                : tr(
                    'candidate.rated_of_four',
                    'Rated {{average}} of 4 across {{count}} · submitted {{at}}',
                    {
                      average: average.toFixed(1),
                      count: String(ratings.length),
                      at: when(c.submittedAt ?? ''),
                    },
                  )
            }
            supporting={
              ratings.length === 0 && notes === null ? undefined : (
                <span className="flex flex-col gap-1">
                  {ratings.length === 0 ? null : (
                    <span className="flex flex-wrap gap-1.5">
                      {ratings.map(([key, rating]) => (
                        <Badge key={key} size="sm" variant="outline">
                          {tr('candidate.competency_rating', '{{competency}} {{rating}} of 4', {
                            competency: competencies[key] ?? words(key),
                            rating: String(rating),
                          })}
                        </Badge>
                      ))}
                    </span>
                  )}
                  {notes === null ? null : (
                    <span className="whitespace-pre-line text-sm text-fg">{notes}</span>
                  )}
                </span>
              )
            }
            trailing={<Recommendation value={c.recommendation} />}
          >
            {name}
          </ListItem>
        );
      })}
    </List>
  );
}

const VERDICTS = ['strong_yes', 'yes', 'no', 'strong_no'] as const;

/**
 * What the panel concluded so far, for the hiring team: how many scorecards
 * are in, how they recommend, and each competency's average, with the way to
 * the debrief where it is decided.
 */
function PanelResults({
  results,
  applicationId,
  onNavigate,
}: {
  readonly results: NonNullable<CandidateData['applications'][number]['results']>;
  readonly applicationId: string;
  readonly onNavigate: ((to: string) => void) | undefined;
}): JSX.Element {
  const rated = results.rows.filter((r) => r.average !== null);
  return (
    <div className="flex flex-col gap-3 rounded-control bg-surface-sunken p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {results.expected === 0
            ? tr('candidate.results_in', '{{submitted}} scorecards in', {
                submitted: String(results.submitted),
              })
            : tr('candidate.results_of', '{{submitted}} of {{expected}} scorecards in', {
                submitted: String(results.submitted),
                expected: String(results.expected),
              })}
        </h3>
        <To
          href={`/recruiting/applications/${applicationId}/debrief`}
          onNavigate={onNavigate}
          className="text-sm font-medium text-fg hover:underline"
        >
          {tr('candidate.open_the_debrief', 'Open the debrief')}
        </To>
      </div>
      <div className="flex flex-wrap gap-2">
        {VERDICTS.filter((v) => (results.recommendations[v] ?? 0) > 0).map((v) => (
          <span key={v} className="flex items-center gap-1.5 text-sm">
            <Recommendation value={v} />
            <span className="tabular-nums">{String(results.recommendations[v] ?? 0)}</span>
          </span>
        ))}
      </div>
      {rated.length === 0 ? null : (
        <KeyValues
          items={rated.map((r) => ({
            label: r.competency,
            value: tr('candidate.average_of_four', '{{average}} of 4', {
              average: r.average ?? '',
            }),
          }))}
        />
      )}
    </div>
  );
}

function Recommendation({ value }: { readonly value: string | null }): JSX.Element {
  if (value === null)
    return (
      <Badge size="sm" tone="neutral" variant="soft">
        {tr('candidate.no_recommendation', 'No recommendation')}
      </Badge>
    );
  const tone =
    value === 'strong_yes' || value === 'yes'
      ? 'success'
      : value === 'strong_no' || value === 'no'
        ? 'danger'
        : 'neutral';
  return (
    <Badge size="sm" tone={tone} variant="soft">
      {words(value)}
    </Badge>
  );
}

/**
 * R11, R12 as one surface: an application of a candidate, opened as a page or
 * over the board it came from. The identity strip and the stage rail lead;
 * interviews with their scorecards, the questionnaire, the evidence, the offer,
 * references, messages and the activity follow in one column, the notes and
 * the details in the other. Every write is the module's; the rail moves the
 * candidate, asking what each stage needs.
 */
export function Spotlight({
  data,
  actions,
  applicationId,
  onApplication,
  overlay,
  offerOpen,
}: {
  readonly data: CandidateData;
  readonly actions: Actions;
  readonly applicationId: string | undefined;
  readonly onApplication: (id: string) => void;
  /** The offer open over the board (`?offer=`); a page's own arrives in its data. */
  readonly offerOpen?: OfferData | null | undefined;
  readonly overlay?: {
    readonly onPrevious: (() => void) | null;
    readonly onNext: (() => void) | null;
    readonly position: string | null;
  };
}): JSX.Element {
  const props = { ...actions, load: { status: 'ready', data } } as ScreenProps<CandidateData>;
  const act = useAct(props);
  const [rejecting, setRejecting] = useState<Rejecting | null>(null);
  const [asking, setAsking] = useState(false);
  const [askLabel, setAskLabel] = useState('');
  const [askDetail, setAskDetail] = useState('');
  const [telling, setTelling] = useState(false);
  const [tellMessage, setTellMessage] = useState<ComposedEmail | null>(null);
  const [moving, setMoving] = useState<{ to: string; name: string; interview: boolean } | null>(
    null,
  );
  const [interviewType, setInterviewType] = useState('');
  const [moveEmailing, setMoveEmailing] = useState(true);
  const [moveMessage, setMoveMessage] = useState<ComposedEmail | null>(null);
  const [pooling, setPooling] = useState(false);
  const [poolId, setPoolId] = useState('');

  const chosen: Application | undefined =
    data.applications.find((a) => a.applicationId === applicationId) ?? data.applications[0];

  // J and K walk the board behind the overlay, as a list of mail does.
  useEffect(() => {
    if (overlay === undefined) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'j' && overlay.onNext !== null) overlay.onNext();
      if (event.key === 'k' && overlay.onPrevious !== null) overlay.onPrevious();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [overlay]);

  const name = data.candidate.name;
  if (chosen === undefined) {
    const empty = (
      <EmptyState
        icon={<icons.person aria-hidden />}
        title={tr('candidate.no_application_you_can_see', 'No application you can see')}
      />
    );
    return overlay === undefined ? (
      <div className="flex flex-col gap-4">
        <PageHeader title={name} />
        {empty}
      </div>
    ) : (
      <>
        <ModalPageHeader title={name} />
        <ModalPageBody>{empty}</ModalPageBody>
      </>
    );
  }

  const at = chosen.stages.findIndex((s) => s.id === chosen.stageId);
  const stage = chosen.stages[at];
  const next = chosen.stages[at + 1];
  const active = chosen.outcome === 'active';
  const mayMove = active && chosen.may.includes('pipeline.move');
  const mayOffer = chosen.may.includes('offer.edit');
  const maySchedule = chosen.may.includes('interview.schedule');
  const mayMessage = active && chosen.may.includes('candidate.message');
  // The offer of this visit to the offer stage; a withdrawn or expired one is history.
  const offer = chosen.offers.find((o) => o.state !== 'withdrawn' && o.state !== 'expired');
  const accepted = chosen.offers.find((o) => o.state === 'accepted');
  // A step's work belongs to it: once past the interviews, booking and chasing times give way to the offer.
  const offerAt = chosen.stages.findIndex((s) => s.category === 'offer');
  const interviewing = active && (offerAt === -1 || at < offerAt);
  const go = (to: string): void => {
    actions.onNavigate?.(to);
  };
  const schedule = (): void => {
    go(`/recruiting/applications/${chosen.applicationId}/schedule`);
  };
  // The offer opens over this page, which stays where it was; one not made yet is drafted from the job first.
  const showOffer = (id: string): void => {
    actions.onFilter?.({ offer: id });
  };
  const openOffer = (): void => {
    if (offer !== undefined) {
      showOffer(offer.id);
      return;
    }
    act.run('PrepareOffer', { applicationId: chosen.applicationId }, (drafted) => {
      showOffer((drafted as { id: string }).id);
    });
  };
  const askMove = (to: string): void => {
    const target = chosen.stages.find((s) => s.id === to);
    if (target === undefined || to === chosen.stageId) return;
    setMoveMessage(null);
    setInterviewType('');
    setMoving({ to, name: target.name, interview: target.category === 'interview' });
  };
  // Stages a person may move to from here: not the ones the process reaches on its own.
  const movable = (category: Category): boolean =>
    category !== 'hired' && category !== 'contract' && category !== 'works_council';

  /** The one button in view: what this stage asks for next. */
  const primary = ((): { label: string; icon: JSX.Element; run: () => void } | null => {
    if (!active) return null;
    if (stage?.category === 'contract' && accepted !== undefined && mayOffer)
      return {
        label: tr('candidate.open_the_contract', 'Open the contract'),
        icon: <icons.document aria-hidden />,
        run: () => {
          go(`/recruiting/offers/${accepted.id}/contract`);
        },
      };
    if (stage?.category === 'offer' && mayOffer)
      return {
        label:
          offer === undefined
            ? tr('candidate.create_offer', 'Create offer')
            : tr('candidate.open_offer', 'Open offer'),
        icon: <icons.agreement aria-hidden />,
        run: openOffer,
      };
    if (stage?.category === 'interview' && maySchedule && interviewing)
      return {
        label: tr('candidate.schedule_interview', 'Schedule interview'),
        icon: <icons.meeting aria-hidden />,
        run: schedule,
      };
    if (mayMove && next !== undefined && movable(next.category))
      return {
        label: tr('candidate.move_to', 'Move to {{name}}', { name: next.name }),
        icon: <icons.next aria-hidden />,
        run: () => {
          askMove(next.id);
        },
      };
    return null;
  })();

  const more: MoreItem[] = [
    {
      id: 'schedule',
      label: tr('candidate.schedule_interview', 'Schedule interview'),
      icon: <icons.meeting aria-hidden />,
      hidden: !maySchedule || !interviewing || stage?.category === 'interview',
      onSelect: schedule,
      group: 'do',
    },
    {
      id: 'debrief',
      label: tr('candidate.debrief', 'Debrief'),
      icon: <icons.review aria-hidden />,
      hidden: !chosen.may.includes('scorecards.all'),
      onSelect: () => {
        go(`/recruiting/applications/${chosen.applicationId}/debrief`);
      },
      group: 'do',
    },
    {
      id: 'ask',
      label: tr('candidate.ask_for_information', 'Ask for information…'),
      icon: <icons.help aria-hidden />,
      hidden: !mayMessage,
      onSelect: () => {
        setAsking(true);
      },
      group: 'tell',
    },
    {
      id: 'expect',
      label: tr('candidate.what_to_expect', 'What to expect…'),
      icon: <icons.email aria-hidden />,
      hidden: !mayMessage,
      onSelect: () => {
        setTellMessage(null);
        setTelling(true);
      },
      group: 'tell',
    },
    {
      id: 'pool',
      label: tr('candidate.add_to_a_talent_pool', 'Add to a talent pool…'),
      icon: <icons.people aria-hidden />,
      hidden: data.allPools.length === 0,
      onSelect: () => {
        setPoolId('');
        setPooling(true);
      },
      group: 'tell',
    },
    {
      id: 'page',
      label: tr('candidate.open_as_a_page', 'Open as a page'),
      icon: <icons.externalLink aria-hidden />,
      hidden: overlay === undefined,
      onSelect: () => {
        go(`/recruiting/candidates/${data.candidate.id}?application=${chosen.applicationId}`);
      },
      group: 'page',
    },
  ];

  const headerActions = (
    <>
      {primary === null ? null : (
        <Button variant="primary" startIcon={primary.icon} onClick={primary.run}>
          {primary.label}
        </Button>
      )}
      {mayMove ? (
        <Button
          variant="secondary"
          onClick={() => {
            setRejecting({ ids: [chosen.applicationId], names: [name] });
          }}
        >
          {tr('candidate.reject', 'Reject…')}
        </Button>
      ) : null}
    </>
  );
  const moreMenu = (
    <MoreMenu label={tr('candidate.more_for', 'More for {{name}}', { name })} items={more} />
  );
  const meta = active ? (
    <Badge tone={CATEGORY_TONE[stage?.category ?? 'applied']}>{stage?.name ?? ''}</Badge>
  ) : (
    <StateBadge state={chosen.outcome} />
  );
  const origin =
    chosen.history[0] === undefined
      ? tr('candidate.via', 'Via {{source}}', { source: whereFrom(chosen.source) })
      : tr('candidate.via_applied', 'Via {{source}} · Applied {{day}}', {
          source: whereFrom(chosen.source),
          day: day(chosen.history[0].at),
        });
  const steps = chosen.stages
    .filter((s) => s.category !== 'hired' || chosen.outcome === 'hired')
    .map((s) => ({
      id: s.id,
      label: s.name,
      disabled: !mayMove || !movable(s.category) || s.id === chosen.stageId,
    }));
  const current = Math.max(
    0,
    steps.findIndex((s) => s.id === chosen.stageId),
  );

  const body = (
    <div className="flex flex-col gap-5">
      <Refusal error={act.error} />
      {/* The identity strip: who, for what, how to reach them, and which of their applications this is. */}
      <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
        <Avatar name={name} size="2xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* The title above names the person; here the job, then where they came from and when. */}
          <p className="text-lg font-semibold tracking-tight text-fg [overflow-wrap:anywhere]">
            {chosen.job.title}
          </p>
          <p className="text-sm text-fg-muted">{origin}</p>
          <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-fg-muted">
            {data.candidate.email === undefined ? null : (
              <li className="flex items-center gap-1.5">
                <icons.email aria-hidden className="size-4" />
                <a className="text-fg hover:underline" href={`mailto:${data.candidate.email}`}>
                  {data.candidate.email}
                </a>
              </li>
            )}
            {data.candidate.phone == null ? null : (
              <li className="flex items-center gap-1.5">
                <icons.phone aria-hidden className="size-4" />
                <a className="text-fg hover:underline" href={`tel:${data.candidate.phone}`}>
                  {data.candidate.phone}
                </a>
              </li>
            )}
            {data.candidate.location == null ? null : (
              <li className="flex items-center gap-1.5">
                <icons.location aria-hidden className="size-4" />
                {data.candidate.location}
              </li>
            )}
            {(data.candidate.links ?? []).map((l) => (
              <li key={l} className="flex items-center gap-1.5">
                <icons.link aria-hidden className="size-4" />
                <a className="text-fg hover:underline" href={l} target="_blank" rel="noreferrer">
                  {l.replace(/^https?:\/\/(www\.)?/u, '').replace(/\/$/u, '')}
                </a>
              </li>
            ))}
            {chosen.flagged ? (
              <li>
                <Badge size="sm" tone="warning">
                  {tr('candidate.knockout_to_review', 'Knockout to review')}
                </Badge>
              </li>
            ) : null}
            {chosen.matrix == null ? null : (
              <li>
                <Badge
                  size="sm"
                  variant="soft"
                  tone={
                    chosen.matrix.band === 'strong'
                      ? 'success'
                      : chosen.matrix.band === 'good'
                        ? 'accent'
                        : 'neutral'
                  }
                >
                  {tr('candidate.match', '{{round}}% match', {
                    round: String(Math.round(chosen.matrix.scoreBp / 100)),
                  })}
                </Badge>
              </li>
            )}
          </ul>
        </div>
        {data.applications.length > 1 ? (
          <Select value={chosen.applicationId} onValueChange={onApplication}>
            <SelectTrigger
              aria-label={tr('candidate.application', 'Application')}
              size="sm"
              className="w-60"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.applications.map((a) => (
                <SelectItem key={a.applicationId} value={a.applicationId}>
                  {a.job.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {/* The rail: where they stand, and, pressed, where they go next. */}
      {active ? (
        <Card padded>
          <Stepper
            label={tr('candidate.stages_of', 'Stages of {{title}}', { title: chosen.job.title })}
            steps={steps}
            current={current}
            free
            size="sm"
            {...(mayMove
              ? {
                  onStepChange: (_: number, step: { id: string }) => {
                    askMove(step.id);
                  },
                }
              : {})}
          />
        </Card>
      ) : chosen.rejection === null ? null : (
        <Alert
          tone="neutral"
          title={tr('candidate.rejected_on', 'Rejected {{at}}', { at: day(chosen.rejection.at) })}
        >
          {words(chosen.rejection.reasonKey)}
        </Alert>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {mayOffer && stage?.category === 'contract' && accepted !== undefined ? (
            <ContractCard
              name={name}
              onOpen={() => {
                go(`/recruiting/offers/${accepted.id}/contract`);
              }}
            />
          ) : null}
          {mayOffer && chosen.outcome === 'hired' ? (
            <FirstDay
              name={name}
              email={data.candidate.email}
              application={chosen}
              planId={data.plans?.[chosen.applicationId] ?? null}
              props={props}
            />
          ) : null}
          {mayOffer && active && stage?.category === 'offer' ? (
            <OfferCard name={name} offer={offer ?? null} onOpen={openOffer} />
          ) : null}
          <Section
            id="interviews"
            title={tr('candidate.interviews_and_scorecards', 'Interviews and scorecards')}
            action={
              maySchedule && interviewing ? (
                <Button
                  size="sm"
                  variant="secondary"
                  startIcon={<icons.add aria-hidden />}
                  onClick={schedule}
                >
                  {tr('candidate.schedule', 'Schedule')}
                </Button>
              ) : null
            }
          >
            <div className="flex flex-col gap-4">
              {(chosen.results?.submitted ?? 0) === 0 || chosen.results == null ? null : (
                <PanelResults
                  results={chosen.results}
                  applicationId={chosen.applicationId}
                  onNavigate={actions.onNavigate}
                />
              )}
              {/* What is still waiting, while the interviews are this stage's work; the rest is in the journey. */}
              {interviewing ? (
                <AskList
                  asks={chosen.asks.filter((a) => a.state === 'open')}
                  applicationId={chosen.applicationId}
                  act={act}
                />
              ) : null}
              {chosen.interviews.length === 0 ? (
                <EmptyState
                  icon={<icons.meeting aria-hidden />}
                  title={tr('candidate.no_interviews_yet', 'No interviews yet')}
                  description={tr(
                    'candidate.book_one_or_send_a_link',
                    'Book one, or send a link for the candidate to give their times.',
                  )}
                />
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {chosen.interviews.map((i) => {
                    const cards = chosen.scorecards.filter((c) => c.interviewId === i.id);
                    return (
                      <li key={i.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <To
                            href={`/recruiting/interviews/${i.id}`}
                            onNavigate={actions.onNavigate}
                            className="font-semibold text-fg hover:underline"
                          >
                            {i.title}
                          </To>
                          <span className="text-sm text-fg-muted tabular-nums">
                            {when(i.startsAt)} ·{' '}
                            {tr('candidate.minutes', '{{minutes}} min', {
                              minutes: String(i.minutes),
                            })}
                          </span>
                          <StateBadge state={i.state} />
                        </div>
                        {/* Every scorecard that is in, from the panel or not; then who still owes one. */}
                        <Scorecards
                          cards={cards.filter((c) => c.submittedAt !== null)}
                          names={data.names ?? {}}
                          competencies={chosen.results?.competencies ?? {}}
                        />
                        <ul className="flex flex-wrap gap-2">
                          {i.interviewerIds
                            .filter((person) =>
                              cards.every(
                                (c) => c.interviewerId !== person || c.submittedAt === null,
                              ),
                            )
                            .map((person) => (
                              <li
                                key={person}
                                className="flex items-center gap-2 rounded-control bg-surface-sunken py-1 ps-1 pe-2"
                              >
                                <Avatar name={data.names?.[person] ?? person} size="sm" />
                                <span className="text-sm font-medium text-fg">
                                  {data.names?.[person] ?? ''}
                                </span>
                                <span className="text-xs text-fg-muted">
                                  {i.state === 'completed'
                                    ? tr('candidate.scorecard_owed', 'Scorecard owed')
                                    : tr('candidate.on_the_panel', 'On the panel')}
                                </span>
                              </li>
                            ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* A scorecard for an interview no longer listed, a rebooked one, still counts. */}
              <Scorecards
                cards={chosen.scorecards.filter(
                  (c) =>
                    c.submittedAt !== null &&
                    chosen.interviews.every((i) => i.id !== c.interviewId),
                )}
                names={data.names ?? {}}
                competencies={chosen.results?.competencies ?? {}}
              />
            </div>
          </Section>
          <Section
            id="answers"
            title={tr('candidate.questionnaire', 'Questionnaire')}
            description={tr(
              'candidate.what_they_answered_when_they_applied',
              'What they answered when they applied.',
            )}
          >
            {Object.keys(chosen.answers).length === 0 ? (
              <EmptyState
                icon={<icons.list aria-hidden />}
                title={tr('candidate.no_answers_you_can_see', 'No answers you can see')}
              />
            ) : (
              <KeyValues
                layout="aligned"
                items={Object.entries(chosen.answers).map(([k, v]) => ({
                  label: words(k.replace(/^q_/u, '')),
                  value:
                    typeof v === 'object' && v !== null && 'name' in v
                      ? (v as { name: string }).name
                      : String(v),
                }))}
              />
            )}
          </Section>
          {chosen.may.includes('candidate.profile') ? (
            <Evidence application={chosen} props={props} />
          ) : null}
          {chosen.prehire === null || (mayOffer && chosen.outcome === 'hired') ? null : (
            <Section
              id="prehire"
              title={tr('candidate.pre_hire', 'Pre-hire')}
              action={<StateBadge state={chosen.prehire.state} />}
            >
              <ul className="flex flex-col gap-2">
                {chosen.prehire.conditions.map((c) => (
                  <li key={c.kind} className="flex items-center justify-between gap-3 text-sm">
                    {words(c.kind)} <StateBadge state={c.state} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section id="references" title={tr('candidate.references', 'References')}>
            <References application={chosen} props={props} />
          </Section>
          <Section
            id="messages"
            title={tr('candidate.messages_title', 'Messages')}
            description={tr(
              'candidate.emails_between',
              'Emails between {{company}} and {{name}}: theirs on the left, the team’s on the right. Their replies arrive here.',
              {
                company: data.company ?? tr('candidate.the_company', 'The company'),
                name: data.candidate.name,
              },
            )}
          >
            <Messages data={data} application={chosen} props={props} />
          </Section>
          <Section
            id="journey"
            title={tr('candidate.journey', 'Journey')}
            description={tr(
              'candidate.every_stage_and_what_happened_there',
              'Every stage they reached, newest first, and what happened while they were there.',
            )}
          >
            <Journey data={data} application={chosen} />
          </Section>
        </div>
        <aside
          className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-4"
          aria-label={tr('candidate.notes_and_details', 'Notes and details')}
        >
          <Notes data={data} application={chosen} props={props} />
          <Section id="details" title={tr('candidate.details', 'Details')}>
            <KeyValues
              layout="stacked"
              items={[
                {
                  label: tr('candidate.files', 'Files'),
                  value:
                    data.files.map((f) => `${f.fileName} (${words(f.kind)})`).join(', ') || '—',
                },
                {
                  label: tr('candidate.consent', 'Consent'),
                  value:
                    data.consents
                      .filter((c) => c.withdrawnAt === null)
                      .map((c) =>
                        c.expiresOn === null
                          ? words(c.purpose)
                          : tr('candidate.consent_until', '{{purpose}} until {{day}}', {
                              purpose: words(c.purpose),
                              day: day(c.expiresOn),
                            }),
                      )
                      .join(' · ') || '—',
                },
                {
                  label: tr('candidate.adjustments', 'Adjustments'),
                  value: chosen.adjustments ?? tr('candidate.none_asked', 'None asked'),
                },
                {
                  label: tr('candidate.talent_pools_label', 'Talent pools'),
                  value:
                    data.pools
                      .map((p) => data.allPools.find((x) => x.id === p.poolId)?.name ?? '')
                      .filter(Boolean)
                      .join(', ') || '—',
                },
                {
                  label: tr('candidate.tags', 'Tags'),
                  value: (data.candidate.tags ?? []).map(words).join(', ') || '—',
                },
              ]}
            />
          </Section>
          {chosen.may.includes('candidate.profile') ? (
            <ReadCv application={chosen} props={props} />
          ) : null}
        </aside>
      </div>
    </div>
  );

  const dialogs = (
    <>
      <Dialog
        open={moving !== null}
        onOpenChange={(open) => {
          if (!open) setMoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr('candidate.move_to_2', 'Move to {{value}}', { value: moving?.name ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {tr(
                'candidate.moves_on_tell_them_in_the',
                '{{name}} moves on. Tell them, in the company’s words or your own.',
                { name },
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {moving?.interview === true ? (
              <Field required>
                <FieldLabel>{tr('candidate.which_interview', 'Which interview')}</FieldLabel>
                <FieldControl>
                  <Input
                    value={interviewType}
                    onChange={(e) => {
                      setInterviewType(e.target.value);
                    }}
                    placeholder={tr('candidate.technical_interview', 'Technical interview')}
                  />
                </FieldControl>
              </Field>
            ) : null}
            <EmailComposer
              applicationId={chosen.applicationId}
              purpose="selection"
              templates={data.templates}
              act={act}
              enabled={moveEmailing}
              onEnabledChange={setMoveEmailing}
              value={moveMessage}
              onChange={setMoveMessage}
            />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setMoving(null);
              }}
            >
              {tr('candidate.cancel', 'Cancel')}
            </Button>
            <Button
              loading={act.pending}
              disabled={
                (moving?.interview === true && interviewType.trim() === '') ||
                (moveEmailing &&
                  (moveMessage === null ||
                    moveMessage.subject.trim() === '' ||
                    moveMessage.body.trim() === ''))
              }
              onClick={() => {
                if (moving === null) return;
                act.run(
                  'MoveApplication',
                  {
                    applicationId: chosen.applicationId,
                    input: {
                      to: moving.to,
                      ...(moving.interview ? { interviewType: interviewType.trim() } : {}),
                      message: moveEmailing ? moveMessage : null,
                    },
                  },
                  (answer) => {
                    setMoving(null);
                    const moved = answer as {
                      opensOffer?: boolean;
                      offerId?: string | null;
                    } | null;
                    // Arriving at the offer stage drafted the offer from the job: open it, filled in, over this page.
                    if (moved?.opensOffer === true && moved.offerId != null)
                      showOffer(moved.offerId);
                  },
                );
              }}
            >
              {moveEmailing
                ? tr('candidate.move_and_send', 'Move and send')
                : tr('candidate.move_without_an_email', 'Move without an email')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr('candidate.ask_the_candidate_for_something', 'Ask the candidate for something')}
            </DialogTitle>
            <DialogDescription>
              {tr(
                'candidate.it_lands_on_their_page',
                'It lands on {{name}}’s page and in their inbox the moment you send it; the answer comes back here.',
                { name },
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <Field required>
              <FieldLabel>{tr('candidate.what_you_need', 'What you need')}</FieldLabel>
              <FieldControl>
                <Input
                  value={askLabel}
                  onChange={(e) => {
                    setAskLabel(e.target.value);
                  }}
                  placeholder={tr(
                    'candidate.your_notice_period_a_portfolio_link',
                    'Your notice period, a portfolio link, two references…',
                  )}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>
                {tr('candidate.more_detail_optional', 'More detail (optional)')}
              </FieldLabel>
              <FieldControl>
                <Textarea
                  autoResize
                  value={askDetail}
                  onChange={(e) => {
                    setAskDetail(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setAsking(false);
              }}
            >
              {tr('candidate.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={askLabel.trim() === ''}
              loading={act.pending}
              onClick={() => {
                act.run(
                  'RequestInformation',
                  {
                    applicationId: chosen.applicationId,
                    input: {
                      label: askLabel.trim(),
                      detail: askDetail.trim() === '' ? null : askDetail.trim(),
                    },
                  },
                  () => {
                    setAsking(false);
                    setAskLabel('');
                    setAskDetail('');
                  },
                );
              }}
            >
              {tr('candidate.send', 'Send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={telling} onOpenChange={setTelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr('candidate.tell_them_what_to_expect', 'Tell them what to expect')}
            </DialogTitle>
            <DialogDescription>
              {tr(
                'candidate.what_happens_at_s_current_stage',
                'What happens at {{name}}’s current stage, from the job’s own plan. Change anything before it goes.',
                { name },
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <EmailComposer
              applicationId={chosen.applicationId}
              purpose="stage_expectations"
              templates={data.templates}
              act={act}
              enabled
              optional={false}
              onEnabledChange={() => undefined}
              value={tellMessage}
              onChange={setTellMessage}
            />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setTelling(false);
              }}
            >
              {tr('candidate.cancel', 'Cancel')}
            </Button>
            <Button
              loading={act.pending}
              disabled={
                tellMessage === null ||
                tellMessage.subject.trim() === '' ||
                tellMessage.body.trim() === ''
              }
              onClick={() => {
                if (tellMessage === null) return;
                act.run(
                  'SendStageExpectations',
                  { applicationId: chosen.applicationId, input: tellMessage },
                  () => {
                    setTelling(false);
                  },
                );
              }}
            >
              {tr('candidate.send', 'Send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pooling} onOpenChange={setPooling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr('candidate.add_to_a_talent_pool_title', 'Add to a talent pool')}
            </DialogTitle>
            <DialogDescription>
              {tr(
                'candidate.without_consent_they_are_asked_first',
                'Without their consent on file, {{name}} is asked by email first.',
                { name },
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field required>
              <FieldLabel>{tr('candidate.talent_pool', 'Talent pool')}</FieldLabel>
              <Select value={poolId} onValueChange={setPoolId}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue placeholder={tr('candidate.choose_a_pool', 'Choose a pool')} />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {data.allPools
                    .filter((p) => !data.pools.some((m) => m.poolId === p.id))
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPooling(false);
              }}
            >
              {tr('candidate.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={poolId === ''}
              loading={act.pending}
              onClick={() => {
                act.run(
                  'AddToPool',
                  {
                    poolId,
                    input: {
                      candidateId: data.candidate.id,
                      reason: tr('candidate.added_from_the_profile', 'Added from the profile'),
                    },
                  },
                  () => {
                    setPooling(false);
                  },
                );
              }}
            >
              {tr('candidate.ask_to_join', 'Ask to join')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OfferModal
        offer={offerOpen ?? data.openOffer}
        props={actions}
        onClose={() => actions.onFilter?.({ offer: null })}
      />
      <RejectDialog
        options={{
          jobTitle: chosen.job.title,
          rejectionReasons: data.rejectionReasons,
          templates: data.templates,
          pools: data.allPools,
        }}
        rejecting={rejecting}
        onClose={() => {
          setRejecting(null);
        }}
        props={props}
      />
    </>
  );

  if (overlay === undefined)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title={name}
          meta={meta}
          actions={
            <>
              {headerActions}
              {moreMenu}
            </>
          }
        />
        {body}
        {dialogs}
      </div>
    );
  return (
    <>
      <ModalPageHeader
        title={name}
        meta={
          <span className="flex items-center gap-2">
            {meta}
            {overlay.position === null ? null : (
              <span className="text-sm text-fg-muted tabular-nums @max-2xl:hidden">
                {overlay.position}
              </span>
            )}
          </span>
        }
        actions={
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={tr('candidate.previous_candidate', 'Previous candidate (K)')}
              startIcon={<icons.previous aria-hidden />}
              disabled={overlay.onPrevious === null}
              onClick={() => overlay.onPrevious?.()}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={tr('candidate.next_candidate', 'Next candidate (J)')}
              startIcon={<icons.next aria-hidden />}
              disabled={overlay.onNext === null}
              onClick={() => overlay.onNext?.()}
            />
            {moreMenu}
          </span>
        }
      />
      <ModalPageBody className="px-4 py-5 @2xl:px-8 @2xl:py-7">
        <div className="mx-auto w-full max-w-7xl">{body}</div>
      </ModalPageBody>
      {primary === null && !mayMove ? null : (
        // The decision at the bottom, where a thumb is, and out of the bar's way at a desk too.
        <ModalPageFooter>{headerActions}</ModalPageFooter>
      )}
      {dialogs}
    </>
  );
}

/** R11, R12: a candidate's application as a page of its own, from a link, an email or a list. */
export function Candidate(props: ScreenProps<CandidateData>): JSX.Element {
  return (
    <Loaded load={props.load} what={tr('candidate.the_candidate', 'the candidate')}>
      {(data) => (
        <Spotlight
          data={data}
          actions={props}
          applicationId={props.search?.['application']}
          onApplication={(id) => props.onFilter?.({ application: id })}
        />
      )}
    </Loaded>
  );
}

/** R26, every candidate: searchable by CV text without any AI key. */
export function Candidates(props: ScreenProps<CandidatesData>): JSX.Element {
  const [adding, setAdding] = useState(false);
  return (
    <Loaded load={props.load} what="candidates">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('candidate.candidates', 'Candidates')}
            description={tr(
              'candidate.everyone_who_applied_was_referred_submitted',
              'Everyone who applied, was referred, submitted or sourced. Search reads CV text.',
            )}
            actions={
              <Button
                startIcon={<icons.hire aria-hidden />}
                onClick={() => {
                  setAdding(!adding);
                }}
              >
                {tr('candidate.add_sourced_profile', 'Add sourced profile')}
              </Button>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox
              initial={data.q}
              onSearch={(q) => props.onFilter?.({ q: q === '' ? null : q })}
            />
            <span className="flex-1" />
            <span className="text-sm text-fg-muted">
              {tr('candidate.shown', '{{length}} shown', { length: String(data.rows.length) })}
            </span>
          </div>
          <Card>
            <CardContent>
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.people aria-hidden />}
                  title={tr('candidate.nobody_matches', 'Nobody matches')}
                />
              ) : (
                <ul className="flex flex-col divide-y divide-[var(--reach-line)]">
                  {data.rows.map((r) => (
                    <li key={r.candidateId} className="flex flex-wrap items-center gap-3 py-3">
                      <Avatar name={r.name} size="sm" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <To
                          href={`/recruiting/candidates/${r.candidateId}`}
                          onNavigate={props.onNavigate}
                        >
                          {r.name}
                        </To>
                        <span className="text-sm text-fg-muted">{r.email}</span>
                      </span>
                      <span className="text-sm">{r.latest?.job ?? '—'}</span>
                      {r.latest === null ? null : <StateBadge state={r.latest.outcome} />}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}

function SearchBox({
  initial,
  onSearch,
}: {
  readonly initial: string;
  readonly onSearch: (q: string) => void;
}): JSX.Element {
  const [q, setQ] = useState(initial);
  return (
    <form
      className="flex gap-2"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(q.trim());
      }}
    >
      <Input
        aria-label={tr('candidate.search_candidates', 'Search candidates')}
        placeholder={tr('candidate.name_email_or_words_in_a', 'Name, email or words in a CV')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
        }}
        className="w-80"
      />
      <Button type="submit" variant="secondary">
        {tr('candidate.search', 'Search')}
      </Button>
    </form>
  );
}

/** R13, talent pools: who is in each, why, and until when their consent runs. */
export function Pools(props: ScreenProps<PoolsData>): JSX.Element {
  const act = useAct(props);
  const [name, setName] = useState('');
  const [forward, setForward] = useState<{ candidateId: string; name: string } | null>(null);
  const [jobId, setJobId] = useState('');
  return (
    <Loaded load={props.load} what={tr('candidate.talent_pools', 'talent pools')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('candidate.talent_pools_2', 'Talent pools')}
            description={tr(
              'candidate.nobody_stays_without_a_lawful_basis',
              'Nobody stays without a lawful basis: consent asked by email, renewed thirty days before it ends.',
            )}
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <Card>
              <CardHeader>
                <CardTitle level={2}>{tr('candidate.pools', 'Pools')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ul className="flex flex-col divide-y divide-[var(--reach-line)]">
                  {data.pools.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 py-2">
                      <To
                        href={`/recruiting/pools/${p.id}`}
                        onNavigate={props.onNavigate}
                        aria-current={data.pool?.id === p.id ? 'page' : undefined}
                      >
                        {p.name}
                      </To>
                      <span className="flex-1" />
                      <Badge size="sm">{p.count}</Badge>
                    </li>
                  ))}
                </ul>
                <Refusal error={act.error} />
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act.run(
                      'SavePool',
                      { poolId: crypto.randomUUID(), input: { name, description: null } },
                      () => {
                        setName('');
                      },
                    );
                  }}
                >
                  <Input
                    aria-label={tr('candidate.new_pools_name', 'New pool’s name')}
                    placeholder={tr(
                      'candidate.backend_berlin_silver_medallists',
                      'Backend, Berlin · silver medallists',
                    )}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={name.trim() === ''}
                    loading={act.pending}
                  >
                    {tr('candidate.new_pool', 'New pool')}
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle level={2}>
                  {data.pool?.name ?? tr('candidate.choose_a_pool', 'Choose a pool')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.pool === null ? (
                  <EmptyState
                    icon={<icons.people aria-hidden />}
                    title={tr(
                      'candidate.pick_a_pool_to_see_who',
                      'Pick a pool to see who is in it',
                    )}
                  />
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--reach-line)]">
                    {data.pool.members.map((m) => (
                      <li key={m.candidateId} className="flex flex-wrap items-center gap-3 py-2">
                        <To
                          href={`/recruiting/candidates/${m.candidateId}`}
                          onNavigate={props.onNavigate}
                        >
                          {m.name}
                        </To>
                        <span className="text-sm text-fg-muted">{m.reason}</span>
                        <span className="flex-1" />
                        <Badge size="sm" tone={m.consentUntil === null ? 'warning' : 'neutral'}>
                          {m.consentUntil === null
                            ? tr('candidate.no_consent', 'No consent')
                            : tr('candidate.until', 'Until {{consentUntil}}', {
                                consentUntil: day(m.consentUntil),
                              })}
                        </Badge>
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={data.jobs.length === 0 || m.consentUntil === null}
                          onClick={() => {
                            setJobId(data.jobs[0]?.id ?? '');
                            setForward({ candidateId: m.candidateId, name: m.name });
                          }}
                        >
                          {tr('candidate.put_forward', 'Put forward…')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          {/* PRD §13.3: into an open job's first stage, told by email with the ad's address. */}
          <Dialog
            open={forward !== null}
            onOpenChange={(open) => {
              if (!open) setForward(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {tr('candidate.put_forward_2', 'Put {{value}} forward', {
                    value: forward?.name ?? '',
                  })}
                </DialogTitle>
                <DialogDescription>
                  {tr(
                    'candidate.they_enter_the_jobs_first_stage',
                    'They enter the job’s first stage and get an email with the ad and their own page.',
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-4">
                <Refusal error={act.error} />
                <Field required>
                  <FieldLabel>{tr('candidate.job', 'Job')}</FieldLabel>
                  <Select value={jobId} onValueChange={setJobId}>
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={tr('candidate.choose_an_open_job', 'Choose an open job')}
                        />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {data.jobs.map((j) => (
                        <SelectItem key={j.id} value={j.id}>
                          {j.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </DialogBody>
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setForward(null);
                  }}
                >
                  {tr('candidate.cancel', 'Cancel')}
                </Button>
                <Button
                  disabled={jobId === ''}
                  loading={act.pending}
                  onClick={() => {
                    if (forward === null) return;
                    act.run('PutForward', { jobId, candidateId: forward.candidateId }, () => {
                      setForward(null);
                    });
                  }}
                >
                  {tr('candidate.put_forward_3', 'Put forward')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </Loaded>
  );
}
