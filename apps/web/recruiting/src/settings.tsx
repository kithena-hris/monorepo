import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Avatar,
  AvatarUploader,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CurrencyField,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  formatList,
  FormSaveBar,
  icons,
  Input,
  List,
  ListItem,
  type ListItemProps,
  PageHeader,
  Reveal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  staggerStyle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TagsInput,
  Textarea,
  type UploadedImage,
} from '@reach/ui';
import { useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { CategoryHeading } from './benefits';
import { Loaded } from './load';
import {
  BenefitEditor,
  CategoryEditor,
  ChainEditor,
  DepartmentEditor,
  EntityEditor,
  InWords,
  LocationEditor,
  PipelineEditor,
  QuestionnaireEditor,
  TEMPLATE_PURPOSES,
  TemplateEditor,
  chainSentence,
  useChecks,
} from './settings-editors';
import { Refusal, money, newId, useAct, words } from './shared';
import type {
  ApprovalChain,
  Benefit,
  BenefitCategory,
  CareersDomain,
  GeneralSettings,
  MessageTemplate,
  OrgUnit,
  Questionnaire,
  ScreenProps,
  SettingsData,
  SettingsEntity,
  SettingsLocation,
} from './types';
import { t as tr } from './i18n';

/**
 * Recruiting's settings under Settings, one place per address
 * (`/settings/recruiting/*`), each doing one job: the careers page, the
 * hiring rules, the organisation, the pipelines and approvals, the
 * questionnaires, the emails, the scorecards, the pay bands, the benefits,
 * AI and the integrations. Administrators only; Recruiting checks every
 * write again.
 *
 * Two ways to change things, never mixed on one page. A page of choices
 * (careers page, rules, AI) is edited in place and kept with the save bar
 * that appears once something changes. A page of things (entities,
 * pipelines, bands) lists them, each row opening its editor, with one
 * button to add another. Either way Save is always pressable: pressed with
 * something wrong, it says what under each field and focuses the first.
 */

type Body = (p: {
  readonly data: SettingsData;
  readonly props: ScreenProps<SettingsData>;
}) => JSX.Element;

type Act = ReturnType<typeof useAct>;

const COUNTRY: Readonly<Record<string, string>> = {
  DE: tr('settings.germany', 'Germany'),
  ES: tr('settings.spain', 'Spain'),
  GB: tr('settings.united_kingdom', 'United Kingdom'),
  IN: tr('settings.india', 'India'),
  US: tr('settings.united_states', 'United States'),
};

/** A page's title, what it is for, and its one main action. */
function Header({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description: string;
  readonly actions?: ReactNode;
}): JSX.Element {
  return (
    <PageHeader
      title={title}
      description={description}
      {...(actions === undefined ? {} : { actions })}
    />
  );
}

/** The row's menu: change it, and remove it where Recruiting owns it. */
function rowActions(
  what: string,
  onEdit: () => void,
  onRemove: (() => void) | null,
): readonly {
  id: string;
  label: string;
  icon?: JSX.Element;
  destructive?: boolean;
  onSelect: () => void;
}[] {
  return [
    {
      id: 'edit',
      label: tr('settings.edit', 'Edit {{what}}', { what }),
      icon: <icons.edit aria-hidden />,
      onSelect: onEdit,
    },
    ...(onRemove === null
      ? []
      : [
          {
            id: 'remove',
            label: tr('settings.remove', 'Remove {{what}}', { what }),
            icon: <icons.remove aria-hidden />,
            destructive: true,
            onSelect: onRemove,
          },
        ]),
  ];
}

/** Where a row came from, when not from here: opening it goes there. */
function FromPeople(): JSX.Element {
  return (
    <Badge size="xs" variant="outline">
      {tr('settings.edited_in_people', 'Edited in People')}
    </Badge>
  );
}

const PEOPLE_LOCATIONS = '/settings/people/organisation/locations';
const PEOPLE_UNITS = '/settings/people/organisation/org-units';

/**
 * Removing for good asks first, once, naming what goes and what it touches;
 * the destructive press is never the one Enter lands on.
 */
function useRemoval(act: Act): {
  readonly ask: (what: string, consequence: string, run: () => void) => void;
  readonly dialog: JSX.Element;
} {
  const [pending, setPending] = useState<{
    what: string;
    consequence: string;
    run: () => void;
  } | null>(null);
  return {
    ask: (what, consequence, run) => {
      setPending({ what, consequence, run });
    },
    dialog: (
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {tr('settings.remove_2', 'Remove {{value}}?', { value: pending?.what ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{pending?.consequence ?? ''}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button>{tr('settings.keep_it', 'Keep it')}</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="danger"
                loading={act.pending}
                onClick={() => {
                  pending?.run();
                  setPending(null);
                }}
              >
                {tr('settings.remove_3', 'Remove')}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
  };
}

/** A page's parts, one under another. */
function Stack({ children }: { readonly children: ReactNode }): JSX.Element {
  return <div className="flex flex-col gap-6">{children}</div>;
}

/** One part of a page: a card with its name, a line only where one is needed, and its settings. */
function Group({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{title}</CardTitle>
        {description === undefined ? null : <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

/** One switch on its own row: what it does on the left, the switch at the trailing edge. */
function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (on: boolean) => void;
}): JSX.Element {
  return (
    <ListItem
      description={description}
      trailing={<Switch aria-label={label} checked={checked} onCheckedChange={onChange} />}
    >
      {label}
    </ListItem>
  );
}

/** A list's rows arrive in turn, a beat apart, the first time the page draws them. */
const arrive = (i: number): { className: string; style: CSSProperties } => ({
  className: 'animate-arrive',
  style: staggerStyle(Math.min(i, 8), 'animation'),
});

/** A row that opens its editor: the whole row is the button, the menu at its end the rest. */
function Row({
  title,
  index,
  onOpen,
  ...rest
}: Omit<ListItemProps, 'asChild' | 'children' | 'chevron' | 'title'> & {
  readonly title: string;
  readonly index: number;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <ListItem {...arrive(index)} {...rest} asChild chevron={rest.actions === undefined}>
      <button type="button" onClick={onOpen}>
        {title}
      </button>
    </ListItem>
  );
}

/** A list of things, or a line saying there are none yet and what to do. */
function Things({
  empty,
  icon,
  children,
}: {
  readonly empty: string | null;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return empty === null ? (
    <List>{children}</List>
  ) : (
    <EmptyState
      icon={icon}
      title={tr('settings.nothing_here_yet', 'Nothing here yet')}
      description={empty}
    />
  );
}

/** The button under a list that adds one more. */
function AddButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <div>
      <Button variant="secondary" startIcon={<icons.add aria-hidden />} onClick={onClick}>
        {label}
      </Button>
    </div>
  );
}

/* ------------------------------------------------- the choices pages -- */

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * The general settings, edited on a page and kept together: each page edits
 * its own part and saves the whole, as Recruiting keeps it.
 */
/** Never saved here: still Recruiting's placeholders, not the company's own. */
const unset = (g: GeneralSettings): boolean =>
  g.companyName === 'Your company' && g.companySlug === 'company';

/** `meridian-freight` read as a name: "Meridian Freight". */
const nameOf = (slug: string): string =>
  slug
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** A company's address in Kithena, made fit for a careers page's: small letters, digits, hyphens. */
const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
    .join('-')
    .slice(0, 40);

/**
 * The careers page starts from the company as the rest of Kithena knows it:
 * its name, its address, its logo and its colours, until it is saved here.
 */
const prefilled = (data: SettingsData): GeneralSettings => {
  const g = data.general;
  const company = data.company;
  if (company === undefined || !unset(g)) return g;
  return {
    ...g,
    // The company's address in Kithena, `meridian-freight.app.kithena.com`, read as its name.
    companyName: nameOf(company.slug) || g.companyName,
    companySlug: slugOf(company.slug) || g.companySlug,
    logoUrl: g.logoUrl ?? company.logoUrl,
    themeId: company.themeId ?? g.themeId,
  };
};

function useGeneral(data: SettingsData, props: ScreenProps<SettingsData>) {
  const act = useAct(props);
  const [saved, setSaved] = useState<GeneralSettings>(data.general);
  const [g, setG] = useState<GeneralSettings>(() => prefilled(data));
  return {
    act,
    g,
    /** Filled in from the company's profile and not yet saved. */
    fromCompany: unset(saved) && !unset(g),
    set: (patch: Partial<GeneralSettings>) => {
      setG({ ...g, ...patch });
    },
    changed: JSON.stringify(g) !== JSON.stringify(saved),
    discard: () => {
      setG(saved);
    },
    save: () => {
      act.run('SaveRecruitingSettings', { input: g }, () => {
        setSaved(g);
      });
    },
  };
}

/** A file as base64, for the upload's JSON. */
const base64Of = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? (reader.result.split(',')[1] ?? '') : '');
    };
    reader.onerror = () => {
      reject(new Error('That file could not be read'));
    };
    reader.readAsDataURL(file);
  });

/**
 * The company's logo, uploaded here: it shows on the careers page, on every
 * job, in search and in every email once the settings are saved.
 */
function LogoField({
  name,
  logoUrl,
  act,
  onChange,
}: {
  readonly name: string;
  readonly logoUrl: string | null;
  readonly act: Act;
  readonly onChange: (logoUrl: string | null) => void;
}): JSX.Element {
  const [picked, setPicked] = useState<readonly UploadedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <AvatarUploader
      label={busy ? tr('settings.logo_uploading', 'Logo, uploading') : tr('settings.logo', 'Logo')}
      hint={
        problem ??
        tr(
          'settings.png_jpeg_or_webp_up_to',
          'PNG, JPEG or WebP, up to 1 MB. A square one fits best.',
        )
      }
      shape="rounded"
      fit="contain"
      size="lg"
      value={picked}
      src={logoUrl}
      fallback={<Avatar name={name} shape="rounded" size="xl" className="ring-0" />}
      accept={['image/png', 'image/jpeg', 'image/webp']}
      maxSize={1_000_000}
      disabled={busy}
      invalid={problem !== null}
      onReject={(rejections) => {
        setProblem(
          rejections[0]?.message ??
            tr('settings.that_image_was_not_accepted', 'That image was not accepted.'),
        );
      }}
      onChange={(next) => {
        const file = next[0]?.file;
        setPicked(next);
        setProblem(null);
        if (file === undefined) {
          onChange(null);
          return;
        }
        setBusy(true);
        void base64Of(file)
          .then((data) => act.call('UploadCompanyLogo', { input: { mediaType: file.type, data } }))
          .then((done) => {
            setBusy(false);
            if (!done.ok) {
              setProblem(done.message);
              return;
            }
            onChange((done.data as { logoUrl: string }).logoUrl);
          })
          .catch(() => {
            setBusy(false);
            setProblem(tr('settings.that_file_could_not_be_read', 'That file could not be read.'));
          });
      }}
    />
  );
}

/** Where a company's own website may be: its reply address's domain, and its careers domain's. */
const domainsOf = (data: SettingsData, g: GeneralSettings): string[] =>
  [
    g.replyAddress?.split('@')[1] ?? null,
    data.careersDomain?.host.split('.').slice(1).join('.') ?? null,
  ].filter((d): d is string => d !== null && d.includes('.'));

/**
 * The company's "about", typed, or written by AI from its own website and a
 * web search, and then always said to be the AI's until someone changes it.
 */
function AboutField({
  data,
  g,
  act,
  onChange,
}: {
  readonly data: SettingsData;
  readonly g: GeneralSettings;
  readonly act: Act;
  readonly onChange: (about: string | null) => void;
}): JSX.Element {
  const [drafted, setDrafted] = useState<{
    text: string;
    sources: readonly string[];
    searched: boolean;
  } | null>(null);
  const [writing, setWriting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const aiOn = data.general.ai.writer;
  const fromAi = drafted !== null && (g.about ?? '') === drafted.text;
  const hosts = drafted?.sources.map((u) => new URL(u).hostname) ?? [];
  return (
    <Field invalid={problem !== null}>
      <FieldLabel>{tr('settings.about_the_company', 'About the company')}</FieldLabel>
      <FieldControl>
        <Textarea
          autoResize
          rows={3}
          value={g.about ?? ''}
          disabled={writing}
          placeholder={tr(
            'settings.what_you_do_for_whom_and',
            'What you do, for whom, and what it is like to work here.',
          )}
          onChange={(e) => {
            onChange(e.target.value === '' ? null : e.target.value);
          }}
        />
      </FieldControl>
      {drafted === null ? null : (
        <div className="flex animate-arrive flex-wrap items-center gap-2 text-sm text-fg-muted">
          <Badge size="sm" tone="assistant">
            {fromAi
              ? tr('settings.written_by_ai', 'Written by AI')
              : tr('settings.started_by_ai_edited_by_you', 'Started by AI, edited by you')}
          </Badge>
          <span>
            {hosts.length === 0
              ? drafted.searched
                ? tr(
                    'settings.from_what_the_ai_knows_and_search',
                    'From what the AI knows of {{company}} and a web search. Check every line before saving.',
                    { company: g.companyName },
                  )
                : tr(
                    'settings.from_what_the_ai_knows',
                    'From what the AI knows of {{company}}. Check every line before saving.',
                    { company: g.companyName },
                  )
              : drafted.searched
                ? tr(
                    'settings.from_hosts_and_search',
                    'From {{hosts}} and a web search. Check every line before saving.',
                    { hosts: formatList([...new Set(hosts)], 'unit', 'short') },
                  )
                : tr(
                    'settings.from_check_every_line_before_saving',
                    'From {{hosts}}. Check every line before saving.',
                    {
                      hosts: formatList([...new Set(hosts)], 'unit', 'short'),
                    },
                  )}
          </span>
        </div>
      )}
      <FieldError>{problem}</FieldError>
      <div>
        <Button
          variant="secondary"
          size="sm"
          startIcon={<icons.assistant aria-hidden />}
          loading={writing}
          disabled={!aiOn || g.companyName.trim() === ''}
          onClick={() => {
            setWriting(true);
            setProblem(null);
            void act
              .call('DescribeCompany', {
                input: { name: g.companyName, domains: domainsOf(data, g) },
              })
              .then((done) => {
                setWriting(false);
                if (!done.ok) {
                  setProblem(done.message);
                  return;
                }
                const d = done.data as { about: string; sources: string[]; searched: boolean };
                setDrafted({ text: d.about, sources: d.sources, searched: d.searched });
                onChange(d.about);
              });
          }}
        >
          {writing
            ? tr('settings.searching_the_web', 'Searching the web')
            : (g.about ?? '') === ''
              ? tr('settings.write_it_with_ai', 'Write it with AI')
              : tr('settings.rewrite_it_with_ai', 'Rewrite it with AI')}
        </Button>
      </div>
      {aiOn ? null : (
        <FieldDescription>
          {tr(
            'settings.to_write_it_with_ai_switch',
            'To write it with AI, switch on “Write and translate job ads” under AI.',
          )}
        </FieldDescription>
      )}
    </Field>
  );
}

const CareersPage: Body = ({ data, props }) => {
  const { act, g, set, changed, discard, save, fromCompany } = useGeneral(data, props);
  const checks = useChecks({
    name: g.companyName.trim() === '' ? 'Your company’s name, as candidates know it.' : null,
    slug: SLUG.test(g.companySlug)
      ? null
      : 'Use 1 to 40 lowercase letters, numbers and hyphens, starting and ending with a letter or number.',
    reply:
      g.replyAddress === null || EMAIL.test(g.replyAddress)
        ? null
        : 'That is not an email address.',
  });
  return (
    <>
      <Header
        title={tr('settings.careers_page', 'Careers page')}
        description={tr(
          'settings.your_company_as_candidates_see_it',
          'Your company as candidates see it.',
        )}
      />
      <Stack>
        <Refusal error={act.error} />
        {fromCompany ? (
          <Alert
            tone="accent"
            icon={<icons.company aria-hidden />}
            title={tr(
              'settings.filled_in_from_your_companys_profile',
              'Filled in from your company’s profile',
            )}
            className="animate-arrive"
          >
            {tr(
              'settings.check_them_then_save_to_use',
              'Check them, then save to use them on your careers page and in every email.',
            )}
          </Alert>
        ) : null}
        <Group title={tr('settings.your_company', 'Your company')}>
          <Field required invalid={checks.invalid('name')}>
            <FieldLabel>{tr('settings.company_name', 'Company name')}</FieldLabel>
            <FieldControl>
              <Input
                value={g.companyName}
                placeholder={tr('settings.meridian_freight', 'Meridian Freight')}
                onChange={(e) => {
                  set({ companyName: e.target.value });
                }}
              />
            </FieldControl>
            <FieldError>{checks.error('name')}</FieldError>
          </Field>
          <LogoField
            name={g.companyName}
            logoUrl={g.logoUrl}
            act={act}
            onChange={(logoUrl) => {
              set({ logoUrl });
            }}
          />
          <AboutField
            data={data}
            g={g}
            act={act}
            onChange={(about) => {
              set({ about });
            }}
          />
        </Group>
        <Group title={tr('settings.where_candidates_find_you', 'Where candidates find you')}>
          <Field required invalid={checks.invalid('slug')}>
            <FieldLabel>
              {tr('settings.address_on_kithena_jobs', 'Address on Kithena Jobs')}
            </FieldLabel>
            <FieldControl>
              <Input
                value={g.companySlug}
                placeholder="meridian-freight"
                onChange={(e) => {
                  // Typed as people type: spaces become hyphens, capitals become small.
                  set({ companySlug: e.target.value.toLowerCase().replaceAll(/\s+/gu, '-') });
                }}
              />
            </FieldControl>
            <FieldDescription>{`jobs.kithena.com/${g.companySlug === '' ? '…' : g.companySlug}`}</FieldDescription>
            <FieldError>{checks.error('slug')}</FieldError>
          </Field>
          <List>
            <SwitchRow
              label={tr(
                'settings.show_your_jobs_in_kithena_jobs',
                'Show your jobs in Kithena Jobs search',
              )}
              description={tr(
                'settings.off_only_people_with_your_link',
                'Off: only people with your link find them.',
              )}
              checked={g.searchable}
              onChange={(on) => {
                set({ searchable: on });
              }}
            />
          </List>
        </Group>
        {data.domainsOn ? <OwnDomain domain={data.careersDomain} props={props} /> : null}
        <Group title={tr('settings.replies', 'Replies')}>
          <Field invalid={checks.invalid('reply')}>
            <FieldLabel>{tr('settings.reply_to_address', 'Reply-to address')}</FieldLabel>
            <FieldControl>
              <Input
                type="email"
                value={g.replyAddress ?? ''}
                placeholder="careers@meridianfreight.com"
                onChange={(e) => {
                  set({
                    replyAddress: e.target.value.trim() === '' ? null : e.target.value.trim(),
                  });
                }}
              />
            </FieldControl>
            <FieldDescription>{tr('settings.optional', 'Optional.')}</FieldDescription>
            <FieldError>{checks.error('reply')}</FieldError>
          </Field>
        </Group>
        <FormSaveBar
          open={changed}
          saving={act.pending}
          message={tr(
            'settings.your_careers_page_and_every_email',
            'Your careers page and every email follow these at once.',
          )}
          onDiscard={discard}
          onSave={() => {
            if (checks.pass()) save();
          }}
        />
      </Stack>
    </>
  );
};

const REVEAL: readonly (readonly [GeneralSettings['revealInternalAt'], string])[] = [
  ['screening', tr('settings.once_they_pass_screening', 'Once they pass screening')],
  ['interview', tr('settings.once_they_reach_interviews', 'Once they reach interviews')],
  ['assessment', tr('settings.once_they_reach_the_assessment', 'Once they reach the assessment')],
  ['offer', tr('settings.only_at_the_offer', 'Only at the offer')],
];

const AFTER: readonly (readonly [
  NonNullable<GeneralSettings['referralBonus']>['after'],
  string,
])[] = [
  ['probation', tr('settings.after_probation', 'After probation')],
  ['three_months', tr('settings.after_three_months', 'After three months')],
  ['six_months', tr('settings.after_six_months', 'After six months')],
];

// Words joined by underscores; a split rather than a trim of `_+$`, which backtracks on long runs.
const reasonKey = (text: string): string =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
    .join('_');

const HiringRules: Body = ({ data, props }) => {
  const { act, g, set, changed, discard, save } = useGeneral(data, props);
  const bonus = g.referralBonus;
  const currencies = [...new Set(['EUR', ...data.entities.map((e) => e.currency)])];
  const checks = useChecks({
    bonus: bonus === null || bonus.amountMinor > 0 ? null : 'Enter the bonus, more than nothing.',
    reasons:
      g.rejectionReasons.length === 0
        ? 'Keep at least one reason: every rejection records one.'
        : null,
  });
  return (
    <>
      <Header
        title={tr('settings.hiring_rules', 'Hiring rules')}
        description={tr(
          'settings.how_hiring_runs_at_your_company',
          'How hiring runs at your company.',
        )}
      />
      <Stack>
        <Refusal error={act.error} />
        <Group title={tr('settings.opening_a_job', 'Opening a job')}>
          <List>
            <SwitchRow
              label={tr('settings.approve_jobs_before_they_open', 'Approve jobs before they open')}
              description={
                g.requisitionsOn
                  ? 'A job opens once its request is approved.'
                  : 'Recruiters open jobs directly.'
              }
              checked={g.requisitionsOn}
              onChange={(on) => {
                set({ requisitionsOn: on });
              }}
            />
          </List>
        </Group>
        <Group title={tr('settings.internal_applicants', 'Internal applicants')}>
          <Field>
            <FieldLabel>
              {tr('settings.their_manager_learns_of_it', 'Their manager learns of it')}
            </FieldLabel>
            <Select
              value={g.revealInternalAt}
              onValueChange={(v) => {
                set({ revealInternalAt: v as GeneralSettings['revealInternalAt'] });
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {REVEAL.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Group>
        <Group title={tr('settings.referrals', 'Referrals')}>
          <List>
            <SwitchRow
              label={tr('settings.pay_a_referral_bonus', 'Pay a referral bonus')}
              description={tr(
                'settings.to_the_employee_who_referred_the',
                'To the employee who referred the hire.',
              )}
              checked={bonus !== null}
              onChange={(on) => {
                set({
                  referralBonus: on
                    ? {
                        amountMinor: 200_000,
                        currency: data.entities[0]?.currency ?? 'EUR',
                        after: 'probation',
                      }
                    : null,
                });
              }}
            />
          </List>
          <Reveal open={bonus !== null} from="top">
            {bonus === null ? null : (
              <div className="flex flex-col gap-4 pt-2">
                <Field required invalid={checks.invalid('bonus')}>
                  <FieldLabel>{tr('settings.amount', 'Amount')}</FieldLabel>
                  <FieldControl>
                    <CurrencyField
                      currency={bonus.currency}
                      value={String(bonus.amountMinor)}
                      onValueChange={(minor) => {
                        set({ referralBonus: { ...bonus, amountMinor: Number(minor) || 0 } });
                      }}
                    />
                  </FieldControl>
                  <FieldError>{checks.error('bonus')}</FieldError>
                </Field>
                {currencies.length > 1 ? (
                  <Field>
                    <FieldLabel>{tr('settings.currency', 'Currency')}</FieldLabel>
                    <Select
                      value={bonus.currency}
                      onValueChange={(currency) => {
                        set({ referralBonus: { ...bonus, currency } });
                      }}
                    >
                      <FieldControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        {currencies.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel>{tr('settings.paid', 'Paid')}</FieldLabel>
                  <Select
                    value={bonus.after}
                    onValueChange={(v) => {
                      set({
                        referralBonus: { ...bonus, after: v as NonNullable<typeof bonus>['after'] },
                      });
                    }}
                  >
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {AFTER.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
          </Reveal>
        </Group>
        <Group
          title={tr('settings.rejection_reasons', 'Rejection reasons')}
          description={tr(
            'settings.internal_only_candidates_never_see_them',
            'Internal only; candidates never see them.',
          )}
        >
          <TagsInput
            label={tr('settings.reasons', 'Reasons')}
            value={g.rejectionReasons.map(words)}
            placeholder={tr('settings.add_a_reason_then_enter', 'Add a reason, then Enter')}
            invalid={checks.invalid('reasons')}
            hint={checks.error('reasons') ?? 'Press Enter after each one.'}
            validate={(text) => {
              const key = reasonKey(text);
              if (!/^[a-z]/u.test(key)) return 'Start the reason with a letter.';
              return g.rejectionReasons.includes(key) ? 'That reason is already here.' : null;
            }}
            onChange={(next) => {
              set({ rejectionReasons: next.map(reasonKey).filter((k) => /^[a-z]/u.test(k)) });
            }}
          />
        </Group>
        <Group title={tr('settings.equal_opportunity', 'Equal opportunity')}>
          <List>
            <SwitchRow
              label={tr('settings.us_federal_contractor', 'US federal contractor')}
              description={tr(
                'settings.adds_the_equal_opportunity_statement_to',
                'Adds the equal-opportunity statement to US jobs.',
              )}
              checked={g.federalContractor}
              onChange={(on) => {
                set({ federalContractor: on });
              }}
            />
          </List>
        </Group>
        <FormSaveBar
          open={changed}
          saving={act.pending}
          message={tr(
            'settings.jobs_and_candidates_follow_these_from',
            'Jobs and candidates follow these from now on.',
          )}
          onDiscard={discard}
          onSave={() => {
            if (checks.pass()) save();
          }}
        />
      </Stack>
    </>
  );
};

/** The careers page on the company's own domain (REC-136): add it, point DNS, check. */
function OwnDomain({
  domain,
  props,
}: {
  readonly domain: CareersDomain | null;
  readonly props: ScreenProps<SettingsData>;
}): JSX.Element {
  const act = useAct(props);
  const [host, setHost] = useState('');
  const checks = useChecks({
    host: /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/u.test(host.trim())
      ? null
      : 'Enter a domain such as careers.yourcompany.com, without https://.',
  });
  return (
    <Group title={tr('settings.your_own_domain', 'Your own domain')}>
      <div className="flex flex-col gap-3">
        <Refusal error={act.error} />
        {domain === null ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (checks.pass()) act.run('SetCareersDomain', { input: { host: host.trim() } });
            }}
          >
            <Field className="flex-1" invalid={checks.invalid('host')}>
              <FieldLabel>{tr('settings.domain', 'Domain')}</FieldLabel>
              <FieldControl>
                <Input
                  value={host}
                  placeholder="careers.yourcompany.com"
                  onChange={(e) => {
                    setHost(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldError>{checks.error('host')}</FieldError>
            </Field>
            <Button type="submit" variant="primary" loading={act.pending}>
              {tr('settings.add_domain', 'Add domain')}
            </Button>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{domain.host}</span>
              <Badge size="sm" tone={domain.status === 'verified' ? 'success' : 'warning'}>
                {domain.status === 'verified'
                  ? tr('settings.live', 'Live')
                  : tr('settings.waiting_for_dns', 'Waiting for DNS')}
              </Badge>
            </div>
            {domain.status === 'verified' ? null : (
              <>
                <p className="text-sm text-fg-muted">
                  {tr(
                    'settings.add_these_records_at_your_dns',
                    'Add these records at your DNS provider, then check. DNS can take up to a day to reach everyone.',
                  )}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr('settings.type', 'Type')}</TableHead>
                      <TableHead>{tr('settings.name', 'Name')}</TableHead>
                      <TableHead>{tr('settings.value', 'Value')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {domain.records.map((r) => (
                      <TableRow key={`${r.type}:${r.name}:${r.value}`}>
                        <TableCell>{r.type}</TableCell>
                        <TableCell className="font-mono">{r.name}</TableCell>
                        <TableCell className="font-mono break-all">{r.value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
            <div className="flex gap-2">
              {domain.status === 'verified' ? null : (
                <Button
                  loading={act.pending}
                  onClick={() => {
                    act.run('CheckCareersDomain', {});
                  }}
                >
                  {tr('settings.check_dns', 'Check DNS')}
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={act.pending}
                onClick={() => {
                  act.run('RemoveCareersDomain', {});
                }}
              >
                {tr('settings.remove_3', 'Remove')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Group>
  );
}

/* -------------------------------------------------- the things pages -- */

const Organisation: Body = ({ data, props }) => {
  const act = useAct(props);
  const removal = useRemoval(act);
  const [entity, setEntity] = useState<SettingsEntity | null | 'new'>(null);
  const [location, setLocation] = useState<SettingsLocation | null | 'new'>(null);
  const [unit, setUnit] = useState<OrgUnit | null | 'new'>(null);
  const entityName = (id: string | null): string | null =>
    data.entities.find((e) => e.id === id)?.name ?? null;
  return (
    <>
      <Header
        title={tr('settings.entities_and_locations', 'Entities and locations')}
        description={tr(
          'settings.who_employs_and_where_people_work',
          'Who employs, and where people work.',
        )}
      />
      <Stack>
        <Refusal error={act.error} />
        <Group title={tr('settings.legal_entities', 'Legal entities')}>
          <Things
            empty={
              data.entities.length === 0 ? 'Add the company that employs, such as Acme GmbH.' : null
            }
            icon={<icons.company aria-hidden />}
          >
            {data.entities.map((e, i) => (
              <Row
                key={e.id}
                index={i}
                title={e.name}
                onOpen={() => {
                  setEntity(e);
                }}
                icon={<icons.company aria-hidden />}
                description={[
                  COUNTRY[e.country] ?? e.country,
                  `pays in ${e.currency}`,
                  e.worksCouncil ? 'works council' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {...(e.source === 'people' ? { meta: <FromPeople /> } : {})}
                actions={rowActions(
                  'entity',
                  () => {
                    setEntity(e);
                  },
                  e.source === 'people'
                    ? null
                    : () => {
                        removal.ask(
                          e.name,
                          'Jobs it employs for keep their terms; no new job can choose it.',
                          () => {
                            act.run('RemoveEntity', { id: e.id });
                          },
                        );
                      },
                )}
              />
            ))}
          </Things>
          <AddButton
            label={tr('settings.add_legal_entity', 'Add legal entity')}
            onClick={() => {
              setEntity('new');
            }}
          />
        </Group>
        <Group title={tr('settings.locations', 'Locations')}>
          <Things
            empty={data.locations.length === 0 ? 'Add an office, a site or a city.' : null}
            icon={<icons.location aria-hidden />}
          >
            {data.locations.map((l, i) => (
              <Row
                key={l.id}
                index={i}
                title={l.name}
                onOpen={() => {
                  // People keeps its locations; they are changed there.
                  if (l.source === 'people') props.onNavigate?.(PEOPLE_LOCATIONS);
                  else setLocation(l);
                }}
                icon={<icons.location aria-hidden />}
                description={[entityName(l.entityId), l.city, l.timeZone]
                  .filter(Boolean)
                  .join(' · ')}
                {...(l.source === 'people' ? { meta: <FromPeople /> } : {})}
                {...(l.source === 'people'
                  ? {}
                  : {
                      actions: rowActions(
                        'location',
                        () => {
                          setLocation(l);
                        },
                        () => {
                          removal.ask(
                            l.name,
                            'Jobs there keep it; no new job can choose it.',
                            () => {
                              act.run('RemoveLocation', { id: l.id });
                            },
                          );
                        },
                      ),
                    })}
              />
            ))}
          </Things>
          <AddButton
            label={tr('settings.add_location', 'Add location')}
            onClick={() => {
              setLocation('new');
            }}
          />
        </Group>
        <Group title={tr('settings.departments', 'Departments')}>
          <Things
            empty={data.orgUnits.length === 0 ? 'Add a department, such as Engineering.' : null}
            icon={<icons.organisation aria-hidden />}
          >
            {data.orgUnits.map((u, i) => (
              <Row
                key={u.id}
                index={i}
                title={u.name}
                onOpen={() => {
                  if (u.source === 'people') props.onNavigate?.(PEOPLE_UNITS);
                  else setUnit(u);
                }}
                icon={<icons.organisation aria-hidden />}
                description={
                  u.parentId === null
                    ? 'At the top'
                    : `Under ${data.orgUnits.find((x) => x.id === u.parentId)?.name ?? '—'}`
                }
                {...(u.source === 'people' ? { meta: <FromPeople /> } : {})}
                {...(u.source === 'people'
                  ? {}
                  : {
                      actions: rowActions(
                        'department',
                        () => {
                          setUnit(u);
                        },
                        () => {
                          removal.ask(
                            u.name,
                            'Jobs in it keep it; no new job can choose it.',
                            () => {
                              act.run('RemoveOrgUnit', { id: u.id });
                            },
                          );
                        },
                      ),
                    })}
              />
            ))}
          </Things>
          <AddButton
            label={tr('settings.add_department', 'Add department')}
            onClick={() => {
              setUnit('new');
            }}
          />
        </Group>
        <Group title={tr('settings.describe_a_change', 'Describe a change')}>
          <InWords
            data={data}
            props={props}
            placeholder={tr(
              'settings.add_a_berlin_office_under_acme',
              'Add a Berlin office under Acme GmbH, or a Platform team under Engineering',
            )}
          />
        </Group>
      </Stack>
      {removal.dialog}
      {entity === null ? null : (
        <EntityEditor
          held={entity === 'new' ? null : entity}
          act={act}
          onClose={() => {
            setEntity(null);
          }}
        />
      )}
      {location === null ? null : (
        <LocationEditor
          held={location === 'new' ? null : location}
          entities={data.entities}
          act={act}
          onClose={() => {
            setLocation(null);
          }}
        />
      )}
      {unit === null ? null : (
        <DepartmentEditor
          held={unit === 'new' ? null : unit}
          units={data.orgUnits}
          act={act}
          onClose={() => {
            setUnit(null);
          }}
        />
      )}
    </>
  );
};

const PipelinesAndApprovals: Body = ({ data, props }) => {
  const act = useAct(props);
  const removal = useRemoval(act);
  const [pipeline, setPipeline] = useState<SettingsData['pipelines'][number] | null | 'new'>(null);
  const [chain, setChain] = useState<ApprovalChain | null | 'new'>(null);
  return (
    <>
      <Header
        title={tr('settings.pipelines_and_approvals', 'Pipelines and approvals')}
        description={tr(
          'settings.how_candidates_move_and_who_approves',
          'How candidates move, and who approves.',
        )}
      />
      <Stack>
        <Refusal error={act.error} />
        <Group
          title={tr('settings.pipelines', 'Pipelines')}
          description={tr(
            'settings.changes_apply_to_new_jobs_only',
            'Changes apply to new jobs only.',
          )}
        >
          <Things
            empty={data.pipelines.length === 0 ? 'Add the steps candidates move through.' : null}
            icon={<icons.hierarchy aria-hidden />}
          >
            {data.pipelines.map((p, i) => (
              <Row
                key={p.id}
                index={i}
                title={p.name}
                onOpen={() => {
                  setPipeline(p);
                }}
                icon={<icons.hierarchy aria-hidden />}
                description={p.stages.map((s) => s.name).join(' → ')}
                {...(p.isDefault
                  ? {
                      meta: (
                        <Badge size="xs" tone="accent" variant="soft">
                          {tr('settings.default', 'Default')}
                        </Badge>
                      ),
                    }
                  : {})}
                actions={rowActions(
                  'pipeline',
                  () => {
                    setPipeline(p);
                  },
                  p.isDefault
                    ? null
                    : () => {
                        removal.ask(
                          p.name,
                          'Jobs that use it keep their steps; new jobs can no longer choose it.',
                          () => {
                            act.run('RemovePipeline', { id: p.id });
                          },
                        );
                      },
                )}
              />
            ))}
          </Things>
          <AddButton
            label={tr('settings.add_pipeline', 'Add pipeline')}
            onClick={() => {
              setPipeline('new');
            }}
          />
        </Group>
        <Group title={tr('settings.approvals', 'Approvals')}>
          <Alert
            tone="info"
            icon={<icons.approve aria-hidden />}
            title={tr('settings.how_approvals_work', 'How approvals work')}
          >
            <div className="flex flex-col gap-2">
              <p>
                {tr(
                  'settings.two_things_can_need_a_yes',
                  'Two things can need a yes before they happen: opening a new job, and sending an offer. A rule below says when, and who says yes, one after another. Each of them gets a task in their Inbox; once the last says yes, it goes ahead.',
                )}
              </p>
              <p>
                {tr(
                  'settings.for_example_when_a_new_jobs',
                  'For example: when a new job’s budget is over €100,000, ask the hiring manager’s manager, then Finance. A €60,000 job fits no rule, so it opens at once.',
                )}
              </p>
              <p>
                {tr(
                  'settings.no_rule_fits_no_approval_needed',
                  'No rule fits: no approval needed. More than one fits: the narrowest is used.',
                )}
              </p>
            </div>
          </Alert>
          <Things
            empty={
              data.chains.length === 0
                ? 'No rules yet: new jobs and offers go ahead without an approval.'
                : null
            }
            icon={<icons.approve aria-hidden />}
          >
            {data.chains
              .toSorted((a, b) => a.priority - b.priority)
              .map((c, i) => (
                <Row
                  key={c.id}
                  index={i}
                  title={c.name}
                  onOpen={() => {
                    setChain(c);
                  }}
                  icon={<icons.approve aria-hidden />}
                  description={chainSentence(c, data)}
                  actions={rowActions(
                    'approval rule',
                    () => {
                      setChain(c);
                    },
                    () => {
                      removal.ask(
                        c.name,
                        'What it would approve falls to the next chain that fits, or goes through.',
                        () => {
                          act.run('RemoveChain', { id: c.id });
                        },
                      );
                    },
                  )}
                />
              ))}
          </Things>
          <AddButton
            label={tr('settings.add_approval_rule', 'Add approval rule')}
            onClick={() => {
              setChain('new');
            }}
          />
        </Group>
        <Group title={tr('settings.describe_a_change', 'Describe a change')}>
          <InWords
            data={data}
            props={props}
            placeholder={tr(
              'settings.a_pipeline_for_interns_with_no',
              'A pipeline for interns with no assessment, or Finance approves jobs over 100k',
            )}
          />
        </Group>
      </Stack>
      {removal.dialog}
      {pipeline === null ? null : (
        <PipelineEditor
          held={pipeline === 'new' ? null : pipeline}
          act={act}
          onClose={() => {
            setPipeline(null);
          }}
        />
      )}
      {chain === null ? null : (
        <ChainEditor
          held={chain === 'new' ? null : chain}
          data={data}
          act={act}
          onClose={() => {
            setChain(null);
          }}
        />
      )}
    </>
  );
};

const Questionnaires: Body = ({ data, props }) => {
  const act = useAct(props);
  const removal = useRemoval(act);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null | 'new'>(null);
  return (
    <>
      <Header
        title={tr('settings.questionnaires', 'Questionnaires')}
        description={tr(
          'settings.questions_candidates_answer_when_they_apply',
          'Questions candidates answer when they apply.',
        )}
        actions={
          <Button
            variant="primary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setQuestionnaire('new');
            }}
          >
            {tr('settings.add_questionnaire', 'Add questionnaire')}
          </Button>
        }
      />
      <Stack>
        <Refusal error={act.error} />
        <Things
          empty={
            data.questionnaires.length === 0
              ? 'Add the questions you ask every candidate, such as the right to work.'
              : null
          }
          icon={<icons.document aria-hidden />}
        >
          {data.questionnaires.map((q, i) => (
            <Row
              key={q.id}
              index={i}
              title={q.name}
              onOpen={() => {
                setQuestionnaire(q);
              }}
              icon={<icons.document aria-hidden />}
              description={tr(
                'settings.version',
                {
                  one: '{{count}} question · version {{version}}',
                  other: '{{count}} questions · version {{version}}',
                },
                { count: q.questions.length, version: String(q.version) },
              )}
              {...(q.worksCouncilConsentVersion === q.version
                ? {
                    meta: (
                      <Badge size="xs" tone="success" variant="soft">
                        {tr('settings.works_council_agreed', 'Works council agreed')}
                      </Badge>
                    ),
                  }
                : {})}
              actions={rowActions(
                'questionnaire',
                () => {
                  setQuestionnaire(q);
                },
                () => {
                  removal.ask(q.name, 'Jobs that ask it stop asking it.', () => {
                    act.run('RemoveQuestionnaire', { id: q.id });
                  });
                },
              )}
            />
          ))}
        </Things>
      </Stack>
      {removal.dialog}
      {questionnaire === null ? null : (
        <QuestionnaireEditor
          held={questionnaire === 'new' ? null : questionnaire}
          act={act}
          onClose={() => {
            setQuestionnaire(null);
          }}
        />
      )}
    </>
  );
};

const purposeLabel = (purpose: string): string =>
  (TEMPLATE_PURPOSES as Readonly<Record<string, string | undefined>>)[purpose] ?? words(purpose);

/** An email's words, flattened to read in a row: its subject, then how it opens. */
const firstWords = (t: { readonly subject: string | null; readonly body: string }): string =>
  [t.subject, t.body.replaceAll(/\s+/gu, ' ').trim()].filter(Boolean).join(' — ');

const EmailsAndLetters: Body = ({ data, props }) => {
  const act = useAct(props);
  const removal = useRemoval(act);
  const [template, setTemplate] = useState<MessageTemplate | null | 'new'>(null);
  const emails = data.templates.filter((t) => t.kind === 'email');
  const letters = data.templates.filter((t) => t.kind !== 'email');
  // A standard email not yet the company's own sends Kithena's words: listed to read, and
  // opened to change, which keeps a copy.
  const builtIn = (data.builtInEmails ?? []).filter(
    (b) => !emails.some((t) => t.purpose === b.purpose),
  );
  const row = (t: MessageTemplate, i: number): JSX.Element => (
    <Row
      key={t.id}
      index={i}
      title={t.name}
      onOpen={() => {
        setTemplate(t);
      }}
      icon={t.kind === 'email' ? <icons.email aria-hidden /> : <icons.document aria-hidden />}
      description={`${purposeLabel(t.purpose)} · ${t.language.toUpperCase()}`}
      supporting={firstWords(t)}
      actions={rowActions(
        'template',
        () => {
          setTemplate(t);
        },
        () => {
          removal.ask(t.name, 'What it sent goes back to the built-in words.', () => {
            act.run('RemoveTemplate', { id: t.id });
          });
        },
      )}
    />
  );
  return (
    <>
      <Header
        title={tr('settings.emails_and_letters', 'Emails and letters')}
        description={tr(
          'settings.what_candidates_receive_and_when_open',
          'What candidates receive, and when. Open one to read or change it.',
        )}
        actions={
          <Button
            variant="primary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setTemplate('new');
            }}
          >
            {tr('settings.add_template', 'Add template')}
          </Button>
        }
      />
      <Stack>
        <Refusal error={act.error} />
        <Group title={tr('settings.emails', 'Emails')}>
          <Things
            empty={emails.length + builtIn.length === 0 ? 'No email yet.' : null}
            icon={<icons.email aria-hidden />}
          >
            {emails.map(row)}
            {builtIn.map((b, i) => (
              <Row
                key={b.purpose}
                index={emails.length + i}
                title={b.name}
                onOpen={() => {
                  setTemplate({
                    id: newId(),
                    kind: 'email',
                    purpose: b.purpose,
                    language: 'en',
                    name: b.name,
                    subject: b.subject,
                    body: b.body,
                  });
                }}
                icon={<icons.email aria-hidden />}
                meta={
                  <Badge size="xs" variant="outline">
                    {tr('settings.built_in', 'Built in')}
                  </Badge>
                }
                description={tr('settings.en', '{{purposeLabel}} · EN', {
                  purposeLabel: purposeLabel(b.purpose),
                })}
                supporting={firstWords(b)}
              />
            ))}
          </Things>
        </Group>
        <Group title={tr('settings.letters', 'Letters')}>
          <Things
            empty={letters.length === 0 ? 'No letter yet.' : null}
            icon={<icons.document aria-hidden />}
          >
            {letters.map(row)}
          </Things>
        </Group>
      </Stack>
      {removal.dialog}
      {template === null ? null : (
        <TemplateEditor
          held={template === 'new' ? null : template}
          act={act}
          onClose={() => {
            setTemplate(null);
          }}
        />
      )}
    </>
  );
};

interface Template {
  readonly id: string;
  readonly name: string;
  readonly competencies: readonly {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly questions: readonly string[];
  }[];
}

const keyOf = (name: string, i: number): string =>
  (reasonKey(name) || `c${String(i)}`).replace(/^(?![a-z])/u, 'c_');

interface DraftCompetency {
  readonly id: string;
  readonly key: string | null;
  readonly name: string;
  readonly description: string;
  /** One question a line, as typed; split when saved. */
  readonly questions: string;
}

const draftOf = (
  c: Template['competencies'][number] | SettingsData['scorecards'][number]['competencies'][number],
): DraftCompetency => ({
  id: newId(),
  key: c.key,
  name: c.name,
  description: c.description ?? '',
  questions: (c.questions ?? []).join('\n'),
});

const blank = (): DraftCompetency => ({
  id: newId(),
  key: null,
  name: '',
  description: '',
  questions: '',
});

/**
 * A scorecard: its name, and each competency interviewers rate, with notes on
 * what good looks like and the questions that bring it out. AI can suggest the
 * questions once the scorecard is saved; they land here to read and change.
 */
function ScorecardEditor({
  held,
  act,
  taken,
  aiOn,
  onClose,
}: {
  /** The scorecard to change, or null for a new one. */
  readonly held: SettingsData['scorecards'][number] | null;
  readonly act: Act;
  readonly taken: readonly string[];
  readonly aiOn: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(held?.name ?? '');
  const [competencies, setCompetencies] = useState<readonly DraftCompetency[]>(
    held === null || held.competencies.length === 0 ? [blank()] : held.competencies.map(draftOf),
  );
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [aiProblem, setAiProblem] = useState<string | null>(null);
  const update = (id: string, patch: Partial<DraftCompetency>): void => {
    setCompetencies(competencies.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const named = competencies.filter((c) => c.name.trim() !== '');
  const checks = useChecks({
    name:
      name.trim() === ''
        ? 'Name the scorecard, as interviewers will pick it.'
        : taken.some((t) => t.toLowerCase() === name.trim().toLowerCase() && t !== held?.name)
          ? 'A scorecard by that name is already here.'
          : null,
    competencies:
      named.length === 0
        ? tr('settings.add_at_least_one_competency_to', 'Add at least one competency to rate.')
        : null,
    twice:
      new Set(named.map((c) => c.name.trim().toLowerCase())).size === named.length
        ? null
        : tr(
            'settings.two_competencies_have_the_same_name',
            'Two competencies have the same name.',
          ),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {held === null ? tr('settings.new_scorecard', 'New scorecard') : held.name}
          </DialogTitle>
          <DialogDescription>
            {tr(
              'settings.what_interviewers_rate_after_an_interview',
              'What interviewers rate after an interview, each competency on the four-point scale.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Refusal error={act.error} />
          {checks.tried && (checks.error('competencies') ?? checks.error('twice')) !== null ? (
            <Alert
              tone="danger"
              title={tr('settings.before_saving', 'Before saving')}
              className="animate-arrive"
            >
              {checks.error('competencies') ?? checks.error('twice')}
            </Alert>
          ) : null}
          <Field required invalid={checks.invalid('name')}>
            <FieldLabel>{tr('settings.name', 'Name')}</FieldLabel>
            <FieldControl>
              <Input
                value={name}
                placeholder={tr('settings.backend_engineering', 'Backend engineering')}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </FieldControl>
            <FieldError>{checks.error('name')}</FieldError>
          </Field>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {tr('settings.competencies', 'Competencies')}
              </span>
              {held === null ? null : (
                <Button
                  size="sm"
                  variant="secondary"
                  startIcon={<icons.assistant aria-hidden />}
                  loading={suggesting}
                  disabled={!aiOn}
                  onClick={() => {
                    setSuggesting(true);
                    setAiProblem(null);
                    void act.call('SuggestKitQuestions', { id: held.id }).then((done) => {
                      setSuggesting(false);
                      if (!done.ok) {
                        setAiProblem(done.message);
                        return;
                      }
                      const t = done.data as Template;
                      // Suggestions fill each competency's questions; what is typed stays.
                      setCompetencies(
                        competencies.map((c) => {
                          const from = t.competencies.find(
                            (x) => x.key === c.key || x.name === c.name,
                          );
                          return from === undefined || from.questions.length === 0
                            ? c
                            : {
                                ...c,
                                questions: [
                                  ...new Set([
                                    ...c.questions.split('\n').filter((q) => q.trim() !== ''),
                                    ...from.questions,
                                  ]),
                                ].join('\n'),
                              };
                        }),
                      );
                      setSuggested(true);
                    });
                  }}
                >
                  {tr('settings.suggest_questions_with_ai', 'Suggest questions with AI')}
                </Button>
              )}
            </div>
            {aiProblem === null ? null : <Refusal error={aiProblem} />}
            {held !== null && !aiOn ? (
              <p className="text-sm text-fg-muted">
                {tr(
                  'settings.to_suggest_questions_with_ai_switch',
                  'To suggest questions with AI, switch on “Write and translate job ads” under AI.',
                )}
              </p>
            ) : null}
            {suggested ? (
              <div className="flex animate-arrive items-center gap-2 text-sm text-fg-muted">
                <Badge size="sm" tone="assistant">
                  {tr('settings.suggested_by_ai', 'Suggested by AI')}
                </Badge>
                <span>
                  {tr(
                    'settings.questions_added_below_read_them_change',
                    'Questions added below. Read them, change any, then save.',
                  )}
                </span>
              </div>
            ) : null}
            {competencies.map((c, i) => (
              <div
                key={c.id}
                className="flex animate-arrive flex-col gap-3 rounded-lg bg-surface-sunken p-3"
              >
                <div className="flex items-start gap-2">
                  <Field required className="flex-1">
                    <FieldLabel>
                      {tr('settings.competency', 'Competency {{value}}', { value: String(i + 1) })}
                    </FieldLabel>
                    <FieldControl>
                      <Input
                        value={c.name}
                        placeholder={tr('settings.system_design', 'System design')}
                        onChange={(e) => {
                          update(c.id, { name: e.target.value });
                        }}
                      />
                    </FieldControl>
                  </Field>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="mt-6"
                    aria-label={
                      c.name === ''
                        ? tr('settings.remove_competency_n', 'Remove competency {{n}}', {
                            n: i + 1,
                          })
                        : tr('settings.remove_4', 'Remove {{value}}', { value: c.name })
                    }
                    startIcon={<icons.remove aria-hidden />}
                    onClick={() => {
                      setCompetencies(competencies.filter((x) => x.id !== c.id));
                    }}
                  />
                </div>
                <Field>
                  <FieldLabel>
                    {tr('settings.notes_for_interviewers', 'Notes for interviewers')}
                  </FieldLabel>
                  <FieldControl>
                    <Textarea
                      autoResize
                      rows={2}
                      value={c.description}
                      placeholder={tr(
                        'settings.what_good_looks_like_and_what',
                        'What good looks like, and what to listen for.',
                      )}
                      onChange={(e) => {
                        update(c.id, { description: e.target.value });
                      }}
                    />
                  </FieldControl>
                </Field>
                <Field>
                  <FieldLabel>{tr('settings.questions_to_ask', 'Questions to ask')}</FieldLabel>
                  <FieldControl>
                    <Textarea
                      autoResize
                      rows={2}
                      value={c.questions}
                      placeholder={tr('settings.one_question_a_line', 'One question a line')}
                      onChange={(e) => {
                        update(c.id, { questions: e.target.value });
                      }}
                    />
                  </FieldControl>
                  <FieldDescription>
                    {tr(
                      'settings.one_a_line_interviewers_see_them',
                      'One a line. Interviewers see them in their kit.',
                    )}
                  </FieldDescription>
                </Field>
              </div>
            ))}
            <div>
              <Button
                size="sm"
                variant="secondary"
                startIcon={<icons.add aria-hidden />}
                onClick={() => {
                  setCompetencies([...competencies, blank()]);
                }}
              >
                {tr('settings.add_competency', 'Add competency')}
              </Button>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tr('settings.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            loading={act.pending}
            onClick={() => {
              if (!checks.pass()) return;
              act.run(
                'SaveScorecardTemplate',
                {
                  id: held?.id ?? newId(),
                  input: {
                    name: name.trim(),
                    competencies: named.map((c, i) => ({
                      key: c.key ?? keyOf(c.name, i),
                      name: c.name.trim(),
                      description: c.description.trim(),
                      questions: c.questions
                        .split('\n')
                        .map((q) => q.trim())
                        .filter(Boolean),
                    })),
                  },
                },
                onClose,
              );
            }}
          >
            {held === null
              ? tr('settings.add_scorecard', 'Add scorecard')
              : tr('settings.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SCALE = [
  [
    '1',
    tr('settings.strong_no', 'Strong no'),
    tr('settings.clear_evidence_against', 'Clear evidence against.'),
  ],
  ['2', tr('settings.no', 'No'), tr('settings.more_against_than_for', 'More against than for.')],
  ['3', tr('settings.yes', 'Yes'), tr('settings.more_for_than_against', 'More for than against.')],
  [
    '4',
    tr('settings.strong_yes', 'Strong yes'),
    tr('settings.clear_repeated_evidence_for', 'Clear, repeated evidence for.'),
  ],
] as const;

const Scorecards: Body = ({ data, props }) => {
  const act = useAct(props);
  const removal = useRemoval(act);
  const [editing, setEditing] = useState<SettingsData['scorecards'][number] | 'new' | null>(null);
  return (
    <>
      <Header
        title={tr('settings.scorecards', 'Scorecards')}
        description={tr(
          'settings.what_interviewers_rate_after_each_interview',
          'What interviewers rate after each interview. Open one to change it.',
        )}
        actions={
          <Button
            variant="primary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setEditing('new');
            }}
          >
            {tr('settings.add_scorecard', 'Add scorecard')}
          </Button>
        }
      />
      <Stack>
        <Refusal error={act.error} />
        <Group title={tr('settings.scorecards', 'Scorecards')}>
          <Things
            empty={
              data.scorecards.length === 0
                ? 'Add one with the competencies a role is judged on.'
                : null
            }
            icon={<icons.review aria-hidden />}
          >
            {data.scorecards.map((s, i) => {
              const asked = s.competencies.reduce((n, c) => n + (c.questions?.length ?? 0), 0);
              return (
                <Row
                  key={s.id}
                  index={i}
                  title={s.name}
                  onOpen={() => {
                    setEditing(s);
                  }}
                  icon={<icons.review aria-hidden />}
                  description={`${String(s.competencies.length)} ${s.competencies.length === 1 ? 'competency' : 'competencies'} · ${asked === 0 ? 'no questions yet' : `${String(asked)} ${asked === 1 ? 'question' : 'questions'}`}`}
                  supporting={s.competencies.map((c) => c.name).join(' · ')}
                  actions={rowActions(
                    'scorecard',
                    () => {
                      setEditing(s);
                    },
                    () => {
                      removal.ask(
                        s.name,
                        'Jobs that use it fall back to their own scorecard.',
                        () => {
                          act.run('RemoveScorecardTemplate', { id: s.id });
                        },
                      );
                    },
                  )}
                />
              );
            })}
          </Things>
        </Group>
        <Group title={tr('settings.the_scale', 'The scale')}>
          <List>
            {SCALE.map(([n, label, line]) => (
              <ListItem
                key={n}
                leading={
                  <Badge size="sm" variant="soft" tone={Number(n) > 2 ? 'success' : 'danger'}>
                    {n}
                  </Badge>
                }
                description={line}
              >
                {label}
              </ListItem>
            ))}
          </List>
        </Group>
      </Stack>
      {removal.dialog}
      {editing === null ? null : (
        <ScorecardEditor
          held={editing === 'new' ? null : editing}
          act={act}
          taken={data.scorecards.map((s) => s.name)}
          aiOn={data.general.ai.writer}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </>
  );
};

type Band = SettingsData['payBands'][number];

/** A pay band: a grade, the currency it pays in, and the yearly range an offer for it should fall in. */
function PayBandEditor({
  held,
  data,
  act,
  onClose,
}: {
  readonly held: Band | null;
  readonly data: SettingsData;
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [grade, setGrade] = useState(held?.grade ?? '');
  const [entity, setEntity] = useState(
    data.entities.find((e) => e.currency === held?.currency)?.id ?? data.entities[0]?.id ?? '',
  );
  const currency = data.entities.find((e) => e.id === entity)?.currency ?? held?.currency ?? 'EUR';
  // Minor units as strings, as `CurrencyField` keeps them; empty is blank.
  const [min, setMin] = useState(held === null ? '' : String(held.minMinor));
  const [max, setMax] = useState(held === null ? '' : String(held.maxMinor));
  const checks = useChecks({
    grade:
      grade.trim() === ''
        ? tr('settings.name_the_grade_such_as_senior', 'Name the grade, such as Senior or E3.')
        : data.payBands.some(
              (b) =>
                b.id !== held?.id &&
                b.currency === currency &&
                b.grade.toLowerCase() === grade.trim().toLowerCase(),
            )
          ? tr(
              'settings.that_grade_already_has_a_band',
              'That grade already has a band in this currency.',
            )
          : null,
    entity: entity === '' ? tr('settings.choose_who_pays_it', 'Choose who pays it.') : null,
    min:
      min === '' || Number(min) <= 0
        ? tr('settings.enter_the_lowest_yearly_salary', 'Enter the lowest yearly salary.')
        : null,
    max:
      max === ''
        ? tr('settings.enter_the_highest_yearly_salary', 'Enter the highest yearly salary.')
        : min !== '' && Number(max) <= Number(min)
          ? tr('settings.the_highest_is_above_the_lowest', 'The highest is above the lowest.')
          : null,
  });
  const complete = grade.trim() !== '' && min !== '' && max !== '' && Number(max) > Number(min);
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
            {held === null
              ? tr('settings.new_pay_band', 'New pay band')
              : tr('settings.pay_band', 'Pay band: {{grade}}', { grade: held.grade })}
          </DialogTitle>
          <DialogDescription>
            {tr(
              'settings.the_yearly_salary_a_grade_pays',
              'The yearly salary a grade pays, from lowest to highest.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Refusal error={act.error} />
          <Field required invalid={checks.invalid('grade')}>
            <FieldLabel>{tr('settings.grade', 'Grade')}</FieldLabel>
            <FieldControl>
              <Input
                value={grade}
                placeholder={tr('settings.senior', 'Senior')}
                onChange={(e) => {
                  setGrade(e.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>
              {tr(
                'settings.the_level_a_job_is_hired',
                'The level a job is hired at, as your offers name it.',
              )}
            </FieldDescription>
            <FieldError>{checks.error('grade')}</FieldError>
          </Field>
          {data.entities.length < 2 ? null : (
            <Field required invalid={checks.invalid('entity')}>
              <FieldLabel>{tr('settings.paid_by', 'Paid by')}</FieldLabel>
              <Select value={entity} onValueChange={setEntity}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={tr('settings.choose_an_entity', 'Choose an entity')}
                    />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {data.entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {tr('settings.in', '{{name}}, in {{currency}}', {
                        name: e.name,
                        currency: e.currency,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{checks.error('entity')}</FieldError>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field required invalid={checks.invalid('min')}>
              <FieldLabel>{tr('settings.lowest_a_year', 'Lowest, a year')}</FieldLabel>
              <FieldControl>
                <CurrencyField currency={currency} value={min} onValueChange={setMin} />
              </FieldControl>
              <FieldError>{checks.error('min')}</FieldError>
            </Field>
            <Field required invalid={checks.invalid('max')}>
              <FieldLabel>{tr('settings.highest_a_year', 'Highest, a year')}</FieldLabel>
              <FieldControl>
                <CurrencyField currency={currency} value={max} onValueChange={setMax} />
              </FieldControl>
              <FieldError>{checks.error('max')}</FieldError>
            </Field>
          </div>
          {complete ? (
            <Alert tone="accent" icon={<icons.payment aria-hidden />} className="animate-arrive">
              {tr(
                'settings.an_offer_for_pays_between_and',
                'An offer for {{grade}} pays between {{min}} and {{max}} a year. Outside that, whoever makes it gives a reason.',
                {
                  grade: grade.trim(),
                  min: money(Number(min), currency),
                  max: money(Number(max), currency),
                },
              )}
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tr('settings.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            loading={act.pending}
            onClick={() => {
              if (!checks.pass()) return;
              act.run(
                'SavePayBand',
                {
                  id: held?.id ?? newId(),
                  input: {
                    entityId: entity,
                    grade: grade.trim(),
                    minMinor: Number(min),
                    maxMinor: Number(max),
                    currency,
                  },
                },
                onClose,
              );
            }}
          >
            {held === null
              ? tr('settings.add_pay_band', 'Add pay band')
              : tr('settings.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PayBands: Body = ({ data, props }) => {
  const act = useAct(props);
  const removal = useRemoval(act);
  const [band, setBand] = useState<Band | null | 'new'>(null);
  const bands = data.payBands.toSorted(
    (a, b) => a.currency.localeCompare(b.currency) || a.minMinor - b.minMinor,
  );
  const payers = (currency: string): string =>
    data.entities
      .filter((e) => e.currency === currency)
      .map((e) => e.name)
      .join(', ');
  return (
    <>
      <Header
        title={tr('settings.pay_bands', 'Pay bands')}
        description={tr(
          'settings.the_yearly_salary_each_grade_pays',
          'The yearly salary each grade pays. Open one to change it.',
        )}
        actions={
          data.entities.length === 0 ? undefined : (
            <Button
              variant="primary"
              startIcon={<icons.add aria-hidden />}
              onClick={() => {
                setBand('new');
              }}
            >
              {tr('settings.add_pay_band', 'Add pay band')}
            </Button>
          )
        }
      />
      <Stack>
        <Refusal error={act.error} />
        <Alert
          tone="info"
          icon={<icons.payment aria-hidden />}
          title={tr('settings.how_pay_bands_work', 'How pay bands work')}
        >
          {tr(
            'settings.a_job_is_hired_at_a',
            'A job is hired at a grade, such as Junior, Senior or E3. Its band is the range an offer for that grade should fall in. An offer outside it asks for a reason, and goes to whoever an approval rule names.',
          )}
        </Alert>
        {data.entities.length === 0 ? (
          <Alert
            tone="warning"
            title={tr('settings.add_a_legal_entity_first', 'Add a legal entity first')}
          >
            {tr('settings.a_band_is_paid_in_its', 'A band is paid in its entity’s currency.')}
          </Alert>
        ) : (
          <Group title={tr('settings.bands', 'Bands')}>
            <Things
              empty={bands.length === 0 ? 'Add the range for each grade you hire at.' : null}
              icon={<icons.payment aria-hidden />}
            >
              {bands.map((b, i) => (
                <Row
                  key={b.id}
                  index={i}
                  title={b.grade}
                  onOpen={() => {
                    if (b.source === 'people')
                      props.onNavigate?.('/settings/people/organisation/pay-bands');
                    else setBand(b);
                  }}
                  icon={<icons.payment aria-hidden />}
                  description={tr(
                    'settings.to_a_year',
                    '{{minMinor}} to {{maxMinor}} a year{{value}}',
                    {
                      minMinor: money(b.minMinor, b.currency),
                      maxMinor: money(b.maxMinor, b.currency),
                      value: payers(b.currency) === '' ? '' : ` · ${payers(b.currency)}`,
                    },
                  )}
                  {...(b.source === 'people'
                    ? { meta: <FromPeople /> }
                    : {
                        actions: rowActions(
                          'pay band',
                          () => {
                            setBand(b);
                          },
                          () => {
                            removal.ask(
                              `pay band ${b.grade}`,
                              'Offers for this grade are no longer checked against a band.',
                              () => {
                                act.run('RemovePayBand', { id: b.id });
                              },
                            );
                          },
                        ),
                      })}
                />
              ))}
            </Things>
          </Group>
        )}
      </Stack>
      {removal.dialog}
      {band === null ? null : (
        <PayBandEditor
          held={band === 'new' ? null : band}
          data={data}
          act={act}
          onClose={() => {
            setBand(null);
          }}
        />
      )}
    </>
  );
};

const worth = (b: Benefit): string | null => {
  switch (b.value.kind) {
    case 'money':
      return tr('settings.a_year', '{{yearlyMinor}} a year', {
        yearlyMinor: money(b.value.yearlyMinor, b.value.currency),
      });
    case 'percent':
      return tr('settings.of_pay', '{{value}}% of pay', {
        value: String(b.value.basisPoints / 100),
      });
    case 'days':
      return tr('settings.days', '{{days}} days', { days: String(b.value.days) });
    default:
      return null;
  }
};

/**
 * The benefits each entity offers, by category: the tiles a job picks from
 * and the list its ad shows. The standard ones are here to start from;
 * remove what you never offer and add your own. Statutory ones come with
 * the country and stay. Only a category carries an icon, as on the ad.
 */
const Benefits: Body = ({ data, props }) => {
  const act = useAct(props);
  const removal = useRemoval(act);
  const [entityId, setEntityId] = useState(data.entities[0]?.id ?? '');
  const [benefit, setBenefit] = useState<{ held: Benefit | null; category: string } | null>(null);
  const [category, setCategory] = useState<BenefitCategory | 'new' | null>(null);
  const mine = data.benefits.filter((b) => b.legalEntityId === entityId);
  const nameOf = (b: Benefit): string => b.names['en'] ?? Object.values(b.names)[0] ?? words(b.key);
  return (
    <>
      <Header
        title={tr('settings.benefits', 'Benefits')}
        description={tr('settings.what_each_entity_offers', 'What each entity offers.')}
        {...(data.entities.length === 0
          ? {}
          : {
              actions: (
                <Button
                  variant="secondary"
                  startIcon={<icons.add aria-hidden />}
                  onClick={() => {
                    setCategory('new');
                  }}
                >
                  {tr('settings.add_category', 'Add category')}
                </Button>
              ),
            })}
      />
      <Stack>
        <Refusal error={act.error} />
        {data.entities.length === 0 ? (
          <Alert
            tone="info"
            title={tr('settings.add_a_legal_entity_first', 'Add a legal entity first')}
          >
            {tr(
              'settings.a_benefit_belongs_to_the_entity',
              'A benefit belongs to the entity that offers it.',
            )}
          </Alert>
        ) : (
          <>
            <Group title={tr('settings.catalogue', 'Catalogue')}>
              {data.entities.length === 1 ? null : (
                <Field>
                  <FieldLabel>{tr('settings.benefits_of', 'Benefits of')}</FieldLabel>
                  <Select value={entityId} onValueChange={setEntityId}>
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {data.entities.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {`${e.name} · ${COUNTRY[e.country] ?? e.country}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <div className="flex flex-col gap-8 pt-2">
                {data.benefitCategories.map((c) => {
                  const list = mine.filter((b) => b.category === c.key);
                  return (
                    <section key={c.key} aria-label={c.name} className="flex flex-col gap-3">
                      <CategoryHeading
                        category={c}
                        meta={
                          <Badge size="sm" variant="soft" className="tabular-nums">
                            {String(list.length)}
                          </Badge>
                        }
                        action={
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              startIcon={<icons.add aria-hidden />}
                              onClick={() => {
                                setBenefit({ held: null, category: c.key });
                              }}
                            >
                              {tr('settings.add_benefit', 'Add benefit')}
                            </Button>
                            {c.custom ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={tr(
                                  'settings.edit_the_category',
                                  'Edit the category {{name}}',
                                  { name: c.name },
                                )}
                                startIcon={<icons.edit aria-hidden />}
                                onClick={() => {
                                  setCategory(c);
                                }}
                              />
                            ) : null}
                          </div>
                        }
                      />
                      {list.length === 0 ? (
                        <p className="ps-13 text-sm text-fg-muted">
                          {tr('settings.nothing_offered_here_yet', 'Nothing offered here yet.')}
                        </p>
                      ) : (
                        <List className="ms-13">
                          {list.map((b, i) =>
                            b.statutory ? (
                              // The law's, from the country: kept as it is.
                              <ListItem
                                key={b.id}
                                {...arrive(i)}
                                description={[b.description, worth(b)].filter(Boolean).join(' · ')}
                                meta={
                                  <Badge size="xs" variant="soft" tone="info">
                                    {tr('settings.by_law', 'By law')}
                                  </Badge>
                                }
                              >
                                {nameOf(b)}
                              </ListItem>
                            ) : (
                              <Row
                                key={b.id}
                                index={i}
                                title={nameOf(b)}
                                onOpen={() => {
                                  setBenefit({ held: b, category: b.category });
                                }}
                                description={[b.description, worth(b)].filter(Boolean).join(' · ')}
                                actions={rowActions(
                                  'benefit',
                                  () => {
                                    setBenefit({ held: b, category: b.category });
                                  },
                                  () => {
                                    removal.ask(
                                      nameOf(b),
                                      'Jobs stop offering it; a standard one can be put back.',
                                      () => {
                                        act.run('RemoveBenefit', { id: b.id });
                                      },
                                    );
                                  },
                                )}
                              />
                            ),
                          )}
                        </List>
                      )}
                    </section>
                  );
                })}
              </div>
            </Group>
            <Group title={tr('settings.standard_benefits', 'Standard benefits')}>
              <div>
                <Button
                  variant="secondary"
                  startIcon={<icons.undo aria-hidden />}
                  loading={act.pending}
                  onClick={() => {
                    act.run('RestoreBenefitLibrary', {});
                  }}
                >
                  {tr('settings.put_back_the_standard_benefits', 'Put back the standard benefits')}
                </Button>
              </div>
            </Group>
            <Group title={tr('settings.describe_a_change', 'Describe a change')}>
              <InWords
                data={data}
                props={props}
                placeholder={tr(
                  'settings.a_50_a_month_meal_allowance',
                  'A €50 a month meal allowance for Acme GmbH, after probation',
                )}
              />
            </Group>
          </>
        )}
      </Stack>
      {removal.dialog}
      {benefit === null ? null : (
        <BenefitEditor
          held={benefit.held}
          data={data}
          act={act}
          startEntity={entityId}
          startCategory={benefit.category}
          onClose={() => {
            setBenefit(null);
          }}
        />
      )}
      {category === null ? null : (
        <CategoryEditor
          held={category === 'new' ? null : category}
          data={data}
          act={act}
          onClose={() => {
            setCategory(null);
          }}
        />
      )}
    </>
  );
};

const Ai: Body = ({ data, props }) => {
  const act = useAct(props);
  const [saved, setSaved] = useState({
    ai: data.general.ai,
    selfId: data.general.selfId ?? { gender: false, ethnicity: false },
  });
  const [ai, setAi] = useState(saved.ai);
  const [selfId, setSelfId] = useState(saved.selfId);
  const feature = (
    key: 'writer' | 'parser' | 'matrix' | 'assistant' | 'charts',
    label: string,
    description: string,
  ): JSX.Element => (
    <SwitchRow
      label={label}
      description={description}
      checked={ai[key]}
      onChange={(on) => {
        setAi({ ...ai, [key]: on });
      }}
    />
  );
  return (
    <>
      <Header
        title={tr('settings.ai', 'AI')}
        description={tr(
          'settings.what_ai_helps_with_and_what',
          'What AI helps with, and what it never sees.',
        )}
      />
      <Stack>
        <Refusal error={act.error} />
        <Group title={tr('settings.what_it_helps_with', 'What it helps with')}>
          <List>
            {feature(
              'writer',
              'Write and translate job ads',
              'Drafts and translates the description.',
            )}
            {feature('parser', 'Read CVs', 'Fills the candidate’s profile from their CV.')}
            {feature(
              'matrix',
              'Evidence against the criteria',
              'Shows how a CV meets each criterion. Never moves a candidate.',
            )}
            {feature(
              'assistant',
              'Answer candidates and take settings in words',
              'The job assistant, and settings changed in words.',
            )}
            {feature('charts', 'Charts on request', 'Draws a hiring chart asked for in words.')}
          </List>
        </Group>
        <Group
          title={tr('settings.what_it_never_sees', 'What it never sees')}
          description={tr(
            'settings.name_photo_age_gender_nationality_and',
            'Name, photo, age, gender, nationality and other personal details are always hidden.',
          )}
        >
          <List>
            <SwitchRow
              label={tr('settings.mask_schools_too', 'Mask schools too')}
              description={tr(
                'settings.hides_the_names_of_universities_and',
                'Hides the names of universities and schools, against prestige bias.',
              )}
              checked={ai.maskSchools ?? false}
              onChange={(on) => {
                setAi({ ...ai, maskSchools: on });
              }}
            />
          </List>
        </Group>
        <Group
          title={tr('settings.voluntary_self_identification', 'Voluntary self-identification')}
          description={tr(
            'settings.optional_private_and_only_counted_in',
            'Optional, private, and only counted in groups.',
          )}
        >
          <List>
            <SwitchRow
              label={tr('settings.gender', 'Gender')}
              description={tr(
                'settings.where_it_is_lawful_to_ask',
                'Where it is lawful to ask in the countries you hire in.',
              )}
              checked={selfId.gender}
              onChange={(on) => {
                setSelfId({ ...selfId, gender: on });
              }}
            />
            <SwitchRow
              label={tr('settings.race_or_ethnicity_us_eeo_1', 'Race or ethnicity (US EEO-1)')}
              description={tr(
                'settings.for_an_employer_in_the_united',
                'For an employer in the United States.',
              )}
              checked={selfId.ethnicity}
              onChange={(on) => {
                setSelfId({ ...selfId, ethnicity: on });
              }}
            />
          </List>
        </Group>
        <Group
          title={tr('settings.new_york_city', 'New York City')}
          description={tr(
            'settings.needed_before_ai_evidence_is_used',
            'Needed before AI evidence is used on NYC jobs.',
          )}
        >
          <Field>
            <FieldLabel>
              {tr('settings.last_independent_bias_audit', 'Last independent bias audit')}
            </FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('settings.last_independent_bias_audit', 'Last independent bias audit')}
                value={ai.nycAuditOn}
                onChange={(d) => {
                  setAi({ ...ai, nycAuditOn: d });
                }}
              />
            </FieldControl>
            <FieldDescription>
              {tr('settings.empty_no_audit_yet', 'Empty: no audit yet.')}
            </FieldDescription>
          </Field>
        </Group>
        <FormSaveBar
          open={JSON.stringify({ ai, selfId }) !== JSON.stringify(saved)}
          saving={act.pending}
          message={tr(
            'settings.applications_read_from_now_on_follow',
            'Applications read from now on follow these.',
          )}
          onDiscard={() => {
            setAi(saved.ai);
            setSelfId(saved.selfId);
          }}
          onSave={() => {
            act.run('SaveRecruitingSettings', { input: { ...data.general, ai, selfId } }, () => {
              setSaved({ ai, selfId });
            });
          }}
        />
      </Stack>
    </>
  );
};

const Integrations: Body = ({ data }) => {
  const groups: readonly (readonly [
    string,
    string,
    readonly (readonly [string, string, 'on' | 'unavailable' | 'port'])[],
  ])[] = [
    [
      'Job boards',
      'Where your jobs are posted beyond your careers page.',
      [
        ['Google for Jobs', 'Structured data on every job page.', 'on'],
        ['Open XML feed', `jobs.kithena.com/feeds/${data.general.companySlug}.xml`, 'on'],
        ['Indeed', 'Needs the partner agreement.', 'unavailable'],
        ['LinkedIn', 'Partner-only; tracked share links meanwhile.', 'unavailable'],
      ],
    ],
    [
      'Your website',
      'Your jobs on a site of your own.',
      [['Embed script', 'A line of code lists your open jobs on any page.', 'on']],
    ],
    [
      'HR system',
      'For an HR system other than People.',
      [['Hired webhook and REST', 'Tells it of each hire, with their details.', 'on']],
    ],
    [
      'Checks',
      'Assessments and background checks, through a provider of yours.',
      [
        ['Assessments', 'Ready for a provider; none chosen yet.', 'port'],
        ['Background checks', 'Ready for a provider; none chosen yet.', 'port'],
      ],
    ],
  ];
  const STATE = {
    on: ['On', 'success'],
    unavailable: ['Not available yet', 'neutral'],
    port: ['Ready to connect', 'info'],
  } as const;
  return (
    <>
      <Header
        title={tr('settings.integrations', 'Integrations')}
        description={tr(
          'settings.where_your_jobs_go_and_what',
          'Where your jobs go, and what connects.',
        )}
      />
      <Stack>
        {groups.map(([title, description, rows]) => (
          <Group key={title} title={title} description={description}>
            <List>
              {rows.map(([name, line, state], i) => (
                <ListItem
                  key={name}
                  {...arrive(i)}
                  description={line}
                  trailing={
                    <Badge size="sm" variant="soft" tone={STATE[state][1]}>
                      {STATE[state][0]}
                    </Badge>
                  }
                >
                  {name}
                </ListItem>
              ))}
            </List>
          </Group>
        ))}
      </Stack>
    </>
  );
};

const SECTIONS: Readonly<Record<string, Body>> = {
  careers: CareersPage,
  rules: HiringRules,
  entities: Organisation,
  pipelines: PipelinesAndApprovals,
  questionnaires: Questionnaires,
  emails: EmailsAndLetters,
  scorecards: Scorecards,
  pay: PayBands,
  benefits: Benefits,
  ai: Ai,
  integrations: Integrations,
};

export function Settings(props: ScreenProps<SettingsData>): JSX.Element {
  const key = props.path?.split('/')[3] ?? 'careers';
  const Section = SECTIONS[key];
  return (
    <Loaded load={props.load} what="Recruiting’s settings">
      {(data) =>
        !data.admin ? (
          <Alert tone="warning" title={tr('settings.administrators_only', 'Administrators only')}>
            {tr(
              'settings.ask_an_administrator_to_change_recruitings',
              'Ask an administrator to change Recruiting’s settings.',
            )}
          </Alert>
        ) : Section === undefined ? (
          <EmptyState
            icon={<icons.settings aria-hidden />}
            title={tr('settings.no_such_setting', 'No such setting')}
            description={tr(
              'settings.it_may_have_moved_settings_lists',
              'It may have moved; Settings lists every one.',
            )}
          />
        ) : (
          // The page's title and its cards in one column, centred in the space beside the menu.
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <Section data={data} props={props} />
          </div>
        )
      }
    </Loaded>
  );
}
