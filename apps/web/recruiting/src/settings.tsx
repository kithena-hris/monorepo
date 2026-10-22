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
  FormSaveBar,
  Input,
  List,
  ListItem,
  PageHeader,
  Reveal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TagsInput,
  Textarea,
  icons,
  staggerStyle,
  type ListItemProps,
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
  DE: 'Germany',
  ES: 'Spain',
  GB: 'United Kingdom',
  IN: 'India',
  US: 'United States',
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
    { id: 'edit', label: `Edit ${what}`, icon: <icons.edit aria-hidden />, onSelect: onEdit },
    ...(onRemove === null
      ? []
      : [
          {
            id: 'remove',
            label: `Remove ${what}`,
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
      Edited in People
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
          <AlertDialogTitle>{`Remove ${pending?.what ?? ''}?`}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.consequence ?? ''}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button>Keep it</Button>
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
                Remove
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
    <EmptyState icon={icon} title="Nothing here yet" description={empty} />
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
      label={busy ? 'Logo, uploading' : 'Logo'}
      hint={problem ?? 'PNG, JPEG or WebP, up to 1 MB. A square one fits best.'}
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
        setProblem(rejections[0]?.message ?? 'That image was not accepted.');
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
            setProblem('That file could not be read.');
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
      <FieldLabel>About the company</FieldLabel>
      <FieldControl>
        <Textarea
          autoResize
          rows={3}
          value={g.about ?? ''}
          disabled={writing}
          placeholder="What you do, for whom, and what it is like to work here."
          onChange={(e) => {
            onChange(e.target.value === '' ? null : e.target.value);
          }}
        />
      </FieldControl>
      {drafted === null ? null : (
        <div className="flex animate-arrive flex-wrap items-center gap-2 text-sm text-fg-muted">
          <Badge size="sm" tone="assistant">
            {fromAi ? 'Written by AI' : 'Started by AI, edited by you'}
          </Badge>
          <span>
            {`From ${hosts.length === 0 ? `what the AI knows of ${g.companyName}` : [...new Set(hosts)].join(', ')}${drafted.searched ? ' and a web search' : ''}. Check every line before saving.`}
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
            ? 'Searching the web'
            : (g.about ?? '') === ''
              ? 'Write it with AI'
              : 'Rewrite it with AI'}
        </Button>
      </div>
      {aiOn ? null : (
        <FieldDescription>
          To write it with AI, switch on “Write and translate job ads” under AI.
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
      <Header title="Careers page" description="Your company as candidates see it." />
      <Stack>
        <Refusal error={act.error} />
        {fromCompany ? (
          <Alert
            tone="accent"
            icon={<icons.company aria-hidden />}
            title="Filled in from your company’s profile"
            className="animate-arrive"
          >
            Check them, then save to use them on your careers page and in every email.
          </Alert>
        ) : null}
        <Group title="Your company">
          <Field required invalid={checks.invalid('name')}>
            <FieldLabel>Company name</FieldLabel>
            <FieldControl>
              <Input
                value={g.companyName}
                placeholder="Meridian Freight"
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
        <Group title="Where candidates find you">
          <Field required invalid={checks.invalid('slug')}>
            <FieldLabel>Address on Kithena Jobs</FieldLabel>
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
              label="Show your jobs in Kithena Jobs search"
              description="Off: only people with your link find them."
              checked={g.searchable}
              onChange={(on) => {
                set({ searchable: on });
              }}
            />
          </List>
        </Group>
        {data.domainsOn ? <OwnDomain domain={data.careersDomain} props={props} /> : null}
        <Group title="Replies">
          <Field invalid={checks.invalid('reply')}>
            <FieldLabel>Reply-to address</FieldLabel>
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
            <FieldDescription>Optional.</FieldDescription>
            <FieldError>{checks.error('reply')}</FieldError>
          </Field>
        </Group>
        <FormSaveBar
          open={changed}
          saving={act.pending}
          message="Your careers page and every email follow these at once."
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
  ['screening', 'Once they pass screening'],
  ['interview', 'Once they reach interviews'],
  ['assessment', 'Once they reach the assessment'],
  ['offer', 'Only at the offer'],
];

const AFTER: readonly (readonly [
  NonNullable<GeneralSettings['referralBonus']>['after'],
  string,
])[] = [
  ['probation', 'After probation'],
  ['three_months', 'After three months'],
  ['six_months', 'After six months'],
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
      <Header title="Hiring rules" description="How hiring runs at your company." />
      <Stack>
        <Refusal error={act.error} />
        <Group title="Opening a job">
          <List>
            <SwitchRow
              label="Approve jobs before they open"
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
        <Group title="Internal applicants">
          <Field>
            <FieldLabel>Their manager learns of it</FieldLabel>
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
        <Group title="Referrals">
          <List>
            <SwitchRow
              label="Pay a referral bonus"
              description="To the employee who referred the hire."
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
                  <FieldLabel>Amount</FieldLabel>
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
                    <FieldLabel>Currency</FieldLabel>
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
                  <FieldLabel>Paid</FieldLabel>
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
        <Group title="Rejection reasons" description="Internal only; candidates never see them.">
          <TagsInput
            label="Reasons"
            value={g.rejectionReasons.map(words)}
            placeholder="Add a reason, then Enter"
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
        <Group title="Equal opportunity">
          <List>
            <SwitchRow
              label="US federal contractor"
              description="Adds the equal-opportunity statement to US jobs."
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
          message="Jobs and candidates follow these from now on."
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
    <Group title="Your own domain">
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
              <FieldLabel>Domain</FieldLabel>
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
              Add domain
            </Button>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{domain.host}</span>
              <Badge size="sm" tone={domain.status === 'verified' ? 'success' : 'warning'}>
                {domain.status === 'verified' ? 'Live' : 'Waiting for DNS'}
              </Badge>
            </div>
            {domain.status === 'verified' ? null : (
              <>
                <p className="text-sm text-fg-muted">
                  Add these records at your DNS provider, then check. DNS can take up to a day to
                  reach everyone.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Value</TableHead>
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
                  Check DNS
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={act.pending}
                onClick={() => {
                  act.run('RemoveCareersDomain', {});
                }}
              >
                Remove
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
      <Header title="Entities and locations" description="Who employs, and where people work." />
      <Stack>
        <Refusal error={act.error} />
        <Group title="Legal entities">
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
            label="Add legal entity"
            onClick={() => {
              setEntity('new');
            }}
          />
        </Group>
        <Group title="Locations">
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
            label="Add location"
            onClick={() => {
              setLocation('new');
            }}
          />
        </Group>
        <Group title="Departments">
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
            label="Add department"
            onClick={() => {
              setUnit('new');
            }}
          />
        </Group>
        <Group title="Describe a change">
          <InWords
            data={data}
            props={props}
            placeholder="Add a Berlin office under Acme GmbH, or a Platform team under Engineering"
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
        title="Pipelines and approvals"
        description="How candidates move, and who approves."
      />
      <Stack>
        <Refusal error={act.error} />
        <Group title="Pipelines" description="Changes apply to new jobs only.">
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
                          Default
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
            label="Add pipeline"
            onClick={() => {
              setPipeline('new');
            }}
          />
        </Group>
        <Group title="Approvals">
          <Alert tone="info" icon={<icons.approve aria-hidden />} title="How approvals work">
            <div className="flex flex-col gap-2">
              <p>
                Two things can need a yes before they happen: opening a new job, and sending an
                offer. A rule below says when, and who says yes, one after another. Each of them
                gets a task in their Inbox; once the last says yes, it goes ahead.
              </p>
              <p>
                For example: when a new job’s budget is over €100,000, ask the hiring manager’s
                manager, then Finance. A €60,000 job fits no rule, so it opens at once.
              </p>
              <p>No rule fits: no approval needed. More than one fits: the narrowest is used.</p>
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
            label="Add approval rule"
            onClick={() => {
              setChain('new');
            }}
          />
        </Group>
        <Group title="Describe a change">
          <InWords
            data={data}
            props={props}
            placeholder="A pipeline for interns with no assessment, or Finance approves jobs over 100k"
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
        title="Questionnaires"
        description="Questions candidates answer when they apply."
        actions={
          <Button
            variant="primary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setQuestionnaire('new');
            }}
          >
            Add questionnaire
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
              description={`${String(q.questions.length)} ${q.questions.length === 1 ? 'question' : 'questions'} · version ${String(q.version)}`}
              {...(q.worksCouncilConsentVersion === q.version
                ? {
                    meta: (
                      <Badge size="xs" tone="success" variant="soft">
                        Works council agreed
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
        title="Emails and letters"
        description="What candidates receive, and when. Open one to read or change it."
        actions={
          <Button
            variant="primary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setTemplate('new');
            }}
          >
            Add template
          </Button>
        }
      />
      <Stack>
        <Refusal error={act.error} />
        <Group title="Emails">
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
                    Built in
                  </Badge>
                }
                description={`${purposeLabel(b.purpose)} · EN`}
                supporting={firstWords(b)}
              />
            ))}
          </Things>
        </Group>
        <Group title="Letters">
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

const draftOf = (c: Template['competencies'][number] | SettingsData['scorecards'][number]['competencies'][number]): DraftCompetency => ({
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
    competencies: named.length === 0 ? 'Add at least one competency to rate.' : null,
    twice:
      new Set(named.map((c) => c.name.trim().toLowerCase())).size === named.length
        ? null
        : 'Two competencies have the same name.',
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
          <DialogTitle>{held === null ? 'New scorecard' : held.name}</DialogTitle>
          <DialogDescription>
            What interviewers rate after an interview, each competency on the four-point scale.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Refusal error={act.error} />
          {checks.tried && (checks.error('competencies') ?? checks.error('twice')) !== null ? (
            <Alert tone="danger" title="Before saving" className="animate-arrive">
              {checks.error('competencies') ?? checks.error('twice')}
            </Alert>
          ) : null}
          <Field required invalid={checks.invalid('name')}>
            <FieldLabel>Name</FieldLabel>
            <FieldControl>
              <Input
                value={name}
                placeholder="Backend engineering"
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </FieldControl>
            <FieldError>{checks.error('name')}</FieldError>
          </Field>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">Competencies</span>
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
                  Suggest questions with AI
                </Button>
              )}
            </div>
            {aiProblem === null ? null : <Refusal error={aiProblem} />}
            {held !== null && !aiOn ? (
              <p className="text-sm text-fg-muted">
                To suggest questions with AI, switch on “Write and translate job ads” under AI.
              </p>
            ) : null}
            {suggested ? (
              <div className="flex animate-arrive items-center gap-2 text-sm text-fg-muted">
                <Badge size="sm" tone="assistant">
                  Suggested by AI
                </Badge>
                <span>Questions added below. Read them, change any, then save.</span>
              </div>
            ) : null}
            {competencies.map((c, i) => (
              <div
                key={c.id}
                className="flex animate-arrive flex-col gap-3 rounded-lg bg-surface-sunken p-3"
              >
                <div className="flex items-start gap-2">
                  <Field required className="flex-1">
                    <FieldLabel>{`Competency ${String(i + 1)}`}</FieldLabel>
                    <FieldControl>
                      <Input
                        value={c.name}
                        placeholder="System design"
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
                    aria-label={`Remove ${c.name === '' ? `competency ${String(i + 1)}` : c.name}`}
                    startIcon={<icons.remove aria-hidden />}
                    onClick={() => {
                      setCompetencies(competencies.filter((x) => x.id !== c.id));
                    }}
                  />
                </div>
                <Field>
                  <FieldLabel>Notes for interviewers</FieldLabel>
                  <FieldControl>
                    <Textarea
                      autoResize
                      rows={2}
                      value={c.description}
                      placeholder="What good looks like, and what to listen for."
                      onChange={(e) => {
                        update(c.id, { description: e.target.value });
                      }}
                    />
                  </FieldControl>
                </Field>
                <Field>
                  <FieldLabel>Questions to ask</FieldLabel>
                  <FieldControl>
                    <Textarea
                      autoResize
                      rows={2}
                      value={c.questions}
                      placeholder="One question a line"
                      onChange={(e) => {
                        update(c.id, { questions: e.target.value });
                      }}
                    />
                  </FieldControl>
                  <FieldDescription>One a line. Interviewers see them in their kit.</FieldDescription>
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
                Add competency
              </Button>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
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
            {held === null ? 'Add scorecard' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SCALE = [
  ['1', 'Strong no', 'Clear evidence against.'],
  ['2', 'No', 'More against than for.'],
  ['3', 'Yes', 'More for than against.'],
  ['4', 'Strong yes', 'Clear, repeated evidence for.'],
] as const;

const Scorecards: Body = ({ data, props }) => {
  const act = useAct(props);
  const removal = useRemoval(act);
  const [editing, setEditing] = useState<SettingsData['scorecards'][number] | 'new' | null>(null);
  return (
    <>
      <Header
        title="Scorecards"
        description="What interviewers rate after each interview. Open one to change it."
        actions={
          <Button
            variant="primary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setEditing('new');
            }}
          >
            Add scorecard
          </Button>
        }
      />
      <Stack>
        <Refusal error={act.error} />
        <Group title="Scorecards">
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
        <Group title="The scale">
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
        ? 'Name the grade, such as Senior or E3.'
        : data.payBands.some(
              (b) =>
                b.id !== held?.id &&
                b.currency === currency &&
                b.grade.toLowerCase() === grade.trim().toLowerCase(),
            )
          ? 'That grade already has a band in this currency.'
          : null,
    entity: entity === '' ? 'Choose who pays it.' : null,
    min: min === '' || Number(min) <= 0 ? 'Enter the lowest yearly salary.' : null,
    max:
      max === ''
        ? 'Enter the highest yearly salary.'
        : min !== '' && Number(max) <= Number(min)
          ? 'The highest is above the lowest.'
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
          <DialogTitle>{held === null ? 'New pay band' : `Pay band: ${held.grade}`}</DialogTitle>
          <DialogDescription>
            The yearly salary a grade pays, from lowest to highest.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Refusal error={act.error} />
          <Field required invalid={checks.invalid('grade')}>
            <FieldLabel>Grade</FieldLabel>
            <FieldControl>
              <Input
                value={grade}
                placeholder="Senior"
                onChange={(e) => {
                  setGrade(e.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>The level a job is hired at, as your offers name it.</FieldDescription>
            <FieldError>{checks.error('grade')}</FieldError>
          </Field>
          {data.entities.length < 2 ? null : (
            <Field required invalid={checks.invalid('entity')}>
              <FieldLabel>Paid by</FieldLabel>
              <Select value={entity} onValueChange={setEntity}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an entity" />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {data.entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {`${e.name}, in ${e.currency}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{checks.error('entity')}</FieldError>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field required invalid={checks.invalid('min')}>
              <FieldLabel>Lowest, a year</FieldLabel>
              <FieldControl>
                <CurrencyField currency={currency} value={min} onValueChange={setMin} />
              </FieldControl>
              <FieldError>{checks.error('min')}</FieldError>
            </Field>
            <Field required invalid={checks.invalid('max')}>
              <FieldLabel>Highest, a year</FieldLabel>
              <FieldControl>
                <CurrencyField currency={currency} value={max} onValueChange={setMax} />
              </FieldControl>
              <FieldError>{checks.error('max')}</FieldError>
            </Field>
          </div>
          {complete ? (
            <Alert tone="accent" icon={<icons.payment aria-hidden />} className="animate-arrive">
              {`An offer for ${grade.trim()} pays between ${money(Number(min), currency)} and ${money(Number(max), currency)} a year. Outside that, whoever makes it gives a reason.`}
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
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
            {held === null ? 'Add pay band' : 'Save'}
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
        title="Pay bands"
        description="The yearly salary each grade pays. Open one to change it."
        actions={
          data.entities.length === 0 ? undefined : (
            <Button
              variant="primary"
              startIcon={<icons.add aria-hidden />}
              onClick={() => {
                setBand('new');
              }}
            >
              Add pay band
            </Button>
          )
        }
      />
      <Stack>
        <Refusal error={act.error} />
        <Alert tone="info" icon={<icons.payment aria-hidden />} title="How pay bands work">
          A job is hired at a grade, such as Junior, Senior or E3. Its band is the range an offer
          for that grade should fall in. An offer outside it asks for a reason, and goes to
          whoever an approval rule names.
        </Alert>
        {data.entities.length === 0 ? (
          <Alert tone="warning" title="Add a legal entity first">
            A band is paid in its entity’s currency.
          </Alert>
        ) : (
          <Group title="Bands">
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
                  description={`${money(b.minMinor, b.currency)} to ${money(b.maxMinor, b.currency)} a year${payers(b.currency) === '' ? '' : ` · ${payers(b.currency)}`}`}
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
      return `${money(b.value.yearlyMinor, b.value.currency)} a year`;
    case 'percent':
      return `${String(b.value.basisPoints / 100)}% of pay`;
    case 'days':
      return `${String(b.value.days)} days`;
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
        title="Benefits"
        description="What each entity offers."
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
                  Add category
                </Button>
              ),
            })}
      />
      <Stack>
        <Refusal error={act.error} />
        {data.entities.length === 0 ? (
          <Alert tone="info" title="Add a legal entity first">
            A benefit belongs to the entity that offers it.
          </Alert>
        ) : (
          <>
            <Group title="Catalogue">
              {data.entities.length === 1 ? null : (
                <Field>
                  <FieldLabel>Benefits of</FieldLabel>
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
                              Add benefit
                            </Button>
                            {c.custom ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Edit the category ${c.name}`}
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
                        <p className="ps-13 text-sm text-fg-muted">Nothing offered here yet.</p>
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
                                    By law
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
            <Group title="Standard benefits">
              <div>
                <Button
                  variant="secondary"
                  startIcon={<icons.undo aria-hidden />}
                  loading={act.pending}
                  onClick={() => {
                    act.run('RestoreBenefitLibrary', {});
                  }}
                >
                  Put back the standard benefits
                </Button>
              </div>
            </Group>
            <Group title="Describe a change">
              <InWords
                data={data}
                props={props}
                placeholder="A €50 a month meal allowance for Acme GmbH, after probation"
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
      <Header title="AI" description="What AI helps with, and what it never sees." />
      <Stack>
        <Refusal error={act.error} />
        <Group title="What it helps with">
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
          title="What it never sees"
          description="Name, photo, age, gender, nationality and other personal details are always hidden."
        >
          <List>
            <SwitchRow
              label="Mask schools too"
              description="Hides the names of universities and schools, against prestige bias."
              checked={ai.maskSchools ?? false}
              onChange={(on) => {
                setAi({ ...ai, maskSchools: on });
              }}
            />
          </List>
        </Group>
        <Group
          title="Voluntary self-identification"
          description="Optional, private, and only counted in groups."
        >
          <List>
            <SwitchRow
              label="Gender"
              description="Where it is lawful to ask in the countries you hire in."
              checked={selfId.gender}
              onChange={(on) => {
                setSelfId({ ...selfId, gender: on });
              }}
            />
            <SwitchRow
              label="Race or ethnicity (US EEO-1)"
              description="For an employer in the United States."
              checked={selfId.ethnicity}
              onChange={(on) => {
                setSelfId({ ...selfId, ethnicity: on });
              }}
            />
          </List>
        </Group>
        <Group title="New York City" description="Needed before AI evidence is used on NYC jobs.">
          <Field>
            <FieldLabel>Last independent bias audit</FieldLabel>
            <FieldControl>
              <DatePicker
                label="Last independent bias audit"
                value={ai.nycAuditOn}
                onChange={(d) => {
                  setAi({ ...ai, nycAuditOn: d });
                }}
              />
            </FieldControl>
            <FieldDescription>Empty: no audit yet.</FieldDescription>
          </Field>
        </Group>
        <FormSaveBar
          open={JSON.stringify({ ai, selfId }) !== JSON.stringify(saved)}
          saving={act.pending}
          message="Applications read from now on follow these."
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
      <Header title="Integrations" description="Where your jobs go, and what connects." />
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
          <Alert tone="warning" title="Administrators only">
            Ask an administrator to change Recruiting’s settings.
          </Alert>
        ) : Section === undefined ? (
          <EmptyState
            icon={<icons.settings aria-hidden />}
            title="No such setting"
            description="It may have moved; Settings lists every one."
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
