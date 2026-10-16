import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  NumberField,
  PageHeader,
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
  Textarea,
  icons,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { Loaded } from './load';
import { Refusal, money, newId, useAct, words } from './shared';
import type { CareersDomain, GeneralSettings, ScreenProps, SettingsData } from './types';

/**
 * S1–S9 under Settings, one place per address (`/settings/recruiting/*`).
 * Administrators only; Recruiting checks every write again.
 */

const COUNTRIES = ['DE', 'ES', 'GB', 'IN', 'US'] as const;
const CURRENCY: Readonly<Record<string, string>> = {
  DE: 'EUR',
  ES: 'EUR',
  GB: 'GBP',
  IN: 'INR',
  US: 'USD',
};
const ZONE: Readonly<Record<string, string>> = {
  DE: 'Europe/Berlin',
  ES: 'Europe/Madrid',
  GB: 'Europe/London',
  IN: 'Asia/Kolkata',
  US: 'America/New_York',
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

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly onChange: (on: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--reach-line)] py-3 last:border-b-0">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <span className="flex flex-col">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {hint === undefined ? null : <span className="text-sm text-fg-muted">{hint}</span>}
      </span>
    </div>
  );
}

function Section({
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
      <CardHeader className="flex-col">
        <CardTitle level={2}>{title}</CardTitle>
        {description === undefined ? null : <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function General({
  data,
  props,
}: {
  readonly data: SettingsData;
  readonly props: ScreenProps<SettingsData>;
}): JSX.Element {
  const act = useAct(props);
  const [g, setG] = useState<GeneralSettings>(data.general);
  const [reason, setReason] = useState('');
  const save = () => {
    act.run('SaveRecruitingSettings', { input: g });
  };
  return (
    <div className="flex flex-col gap-4">
      <Refusal error={act.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Process">
          <Toggle
            id="requisitions"
            label="Use requisitions"
            hint="Off: jobs open directly, without approval."
            checked={g.requisitionsOn}
            onChange={(on) => {
              setG({ ...g, requisitionsOn: on });
            }}
          />
          <Toggle
            id="federal"
            label="US federal contractor"
            hint="Adds the equal-opportunity statement to US jobs."
            checked={g.federalContractor}
            onChange={(on) => {
              setG({ ...g, federalContractor: on });
            }}
          />
          <Field className="py-3">
            <FieldLabel>Show internal applicants to their manager from</FieldLabel>
            <Select
              value={g.revealInternalAt}
              onValueChange={(v) => {
                setG({ ...g, revealInternalAt: v as GeneralSettings['revealInternalAt'] });
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {(['screening', 'interview', 'assessment', 'offer'] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {words(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Toggle
            id="bonus"
            label="Referral bonus"
            hint={
              g.referralBonus === null
                ? 'Off'
                : `${money(g.referralBonus.amountMinor, g.referralBonus.currency)}, after ${words(g.referralBonus.after).toLowerCase()}`
            }
            checked={g.referralBonus !== null}
            onChange={(on) => {
              setG({
                ...g,
                referralBonus: on
                  ? { amountMinor: 200_000, currency: 'EUR', after: 'probation' }
                  : null,
              });
            }}
          />
          {g.referralBonus === null ? null : (
            <NumberField
              label="Bonus amount"
              value={g.referralBonus.amountMinor / 100}
              min={0}
              onChange={(n) => {
                setG({
                  ...g,
                  referralBonus:
                    g.referralBonus === null
                      ? null
                      : { ...g.referralBonus, amountMinor: Math.round((n ?? 0) * 100) },
                });
              }}
            />
          )}
        </Section>
        <Section title="Careers page" description="The company’s page on Kithena Jobs">
          <div className="flex flex-col gap-3">
            <Field required>
              <FieldLabel>Company name</FieldLabel>
              <FieldControl>
                <Input
                  value={g.companyName}
                  onChange={(e) => {
                    setG({ ...g, companyName: e.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <Field required>
              <FieldLabel>Address on Kithena Jobs</FieldLabel>
              <FieldControl>
                <Input
                  value={g.companySlug}
                  onChange={(e) => {
                    setG({ ...g, companySlug: e.target.value.toLowerCase() });
                  }}
                />
              </FieldControl>
              <FieldDescription>{`jobs.kithena.com/${g.companySlug}`}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>About the company</FieldLabel>
              <FieldControl>
                <Textarea
                  autoResize
                  value={g.about ?? ''}
                  onChange={(e) => {
                    setG({ ...g, about: e.target.value === '' ? null : e.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>Reply-to address</FieldLabel>
              <FieldControl>
                <Input
                  type="email"
                  value={g.replyAddress ?? ''}
                  onChange={(e) => {
                    setG({ ...g, replyAddress: e.target.value === '' ? null : e.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <Toggle
              id="searchable"
              label="On Kithena Jobs’ search"
              hint="Beside your careers page, in the cross-company search."
              checked={g.searchable}
              onChange={(on) => {
                setG({ ...g, searchable: on });
              }}
            />
          </div>
        </Section>
      </div>
      {data.domainsOn ? <OwnDomain domain={data.careersDomain} props={props} /> : null}
      <Section title="Rejection reasons" description="Internal; never sent to candidates">
        <ChipRow aria-label="Rejection reasons">
          {g.rejectionReasons.map((r) => (
            <Chip
              key={r}
              onRemove={() => {
                setG({ ...g, rejectionReasons: g.rejectionReasons.filter((x) => x !== r) });
              }}
            >
              {words(r)}
            </Chip>
          ))}
        </ChipRow>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const key = reason
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/gu, '_')
              .replace(/^_+|_+$/gu, '');
            if (/^[a-z]/u.test(key) && !g.rejectionReasons.includes(key))
              setG({ ...g, rejectionReasons: [...g.rejectionReasons, key] });
            setReason('');
          }}
        >
          <Input
            aria-label="A reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            placeholder="Overqualified"
          />
          <Button type="submit" variant="secondary" disabled={reason.trim() === ''}>
            Add
          </Button>
        </form>
      </Section>
      <div className="flex justify-end">
        <Button loading={act.pending} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

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
  return (
    <Section
      title="Your own domain"
      description="Your careers page at an address of yours, such as careers.yourcompany.com"
    >
      <div className="flex flex-col gap-3">
        <Refusal error={act.error} />
        {domain === null ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act.run('SetCareersDomain', { input: { host } });
            }}
          >
            <Field className="flex-1">
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
            </Field>
            <Button type="submit" loading={act.pending} disabled={host.trim() === ''}>
              Add
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
    </Section>
  );
}

function Entities({
  data,
  props,
}: {
  readonly data: SettingsData;
  readonly props: ScreenProps<SettingsData>;
}): JSX.Element {
  const act = useAct(props);
  const [name, setName] = useState('');
  const [country, setCountry] = useState<string>('DE');
  const [city, setCity] = useState('');
  return (
    <div className="flex flex-col gap-4">
      <Refusal error={act.error} />
      <Section
        title="Legal entities"
        description="Each hires in one country; its country pack decides the terms"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entity</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Works council</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entities.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.name}</TableCell>
                <TableCell>{e.country}</TableCell>
                <TableCell>{e.currency}</TableCell>
                <TableCell>{e.worksCouncil ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act.run('SaveEntity', {
              id: newId(),
              input: {
                name,
                country,
                currency: CURRENCY[country],
                fullTimeWeeklyMinutes: 2400,
                headcount: 0,
                foundedOn: null,
                worksCouncil: false,
                worksCouncilIds: [],
              },
            });
            setName('');
          }}
        >
          <Field className="min-w-64 flex-1">
            <FieldLabel>New entity</FieldLabel>
            <FieldControl>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder="Acme GmbH"
              />
            </FieldControl>
          </Field>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger aria-label="Country" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="submit"
            variant="secondary"
            disabled={name.trim() === ''}
            loading={act.pending}
          >
            Add
          </Button>
        </form>
      </Section>
      <Section title="Locations">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Time zone</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.locations.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.name}</TableCell>
                <TableCell>{l.country}</TableCell>
                <TableCell>{l.timeZone}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const entity = data.entities.find((x) => x.country === country);
            act.run('SaveLocation', {
              id: newId(),
              input: {
                name: city,
                entityId: entity?.id ?? null,
                country,
                region: null,
                city,
                timeZone: ZONE[country],
              },
            });
            setCity('');
          }}
        >
          <Field className="min-w-64 flex-1">
            <FieldLabel>New location</FieldLabel>
            <FieldControl>
              <Input
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                }}
                placeholder="Berlin"
              />
            </FieldControl>
          </Field>
          <Button
            type="submit"
            variant="secondary"
            disabled={city.trim() === ''}
            loading={act.pending}
          >
            Add
          </Button>
        </form>
      </Section>
    </div>
  );
}

function Scorecards({
  data,
  props,
}: {
  readonly data: SettingsData;
  readonly props: ScreenProps<SettingsData>;
}): JSX.Element {
  const act = useAct(props);
  const [name, setName] = useState('');
  const [competencies, setCompetencies] = useState('');
  const [suggested, setSuggested] = useState<Template | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <Refusal error={act.error} />
      <Section
        title="Scorecards"
        description="Competencies with descriptions and probing questions; rated on the fixed four-point scale"
      >
        {data.scorecards.length === 0 ? (
          <EmptyState icon={<icons.review aria-hidden />} title="No scorecards yet" />
        ) : null}
        {data.scorecards.map((s) => {
          const held = suggested?.id === s.id ? suggested : null;
          return (
            <div key={s.id} className="border-b border-[var(--reach-line)] py-2 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={act.pending}
                  onClick={() => {
                    act.run('SuggestKitQuestions', { id: s.id }, (t) => {
                      setSuggested(t as Template);
                    });
                  }}
                >
                  Suggest questions
                </Button>
              </div>
              <span className="block text-sm text-fg-muted">
                {s.competencies.map((c) => c.name).join(' · ')}
              </span>
              {held === null ? null : (
                <div className="mt-2 flex flex-col gap-2">
                  {held.competencies.map((c) => (
                    <div key={c.key}>
                      <span className="text-sm font-medium">{c.name}</span>
                      <ul className="list-disc ps-5 text-sm">
                        {c.questions.map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      loading={act.pending}
                      onClick={() => {
                        act.run(
                          'SaveScorecardTemplate',
                          {
                            id: held.id,
                            input: { name: held.name, competencies: held.competencies },
                          },
                          () => {
                            setSuggested(null);
                          },
                        );
                      }}
                    >
                      Keep these
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSuggested(null);
                      }}
                    >
                      Discard
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Section>
      <Section title="New scorecard">
        <div className="flex flex-col gap-3">
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <FieldControl>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder="Backend engineering"
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>Competencies, one per line</FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                value={competencies}
                onChange={(e) => {
                  setCompetencies(e.target.value);
                }}
                placeholder={'System design\nGo\nOn call'}
              />
            </FieldControl>
          </Field>
          <div className="flex justify-end">
            <Button
              disabled={name.trim() === '' || competencies.trim() === ''}
              loading={act.pending}
              onClick={() => {
                const list = competencies
                  .split('\n')
                  .map((c) => c.trim())
                  .filter(Boolean)
                  .map((c, i) => ({
                    key: (
                      c
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/gu, '_')
                        .replace(/^_+|_+$/gu, '') || `c${String(i)}`
                    ).replace(/^(?![a-z])/u, 'c_'),
                    name: c,
                    description: '',
                    questions: [],
                  }));
                act.run(
                  'SaveScorecardTemplate',
                  { id: newId(), input: { name, competencies: list } },
                  () => {
                    setName('');
                    setCompetencies('');
                  },
                );
              }}
            >
              Add scorecard
            </Button>
          </div>
        </div>
      </Section>
      <Section title="The scale" description="Fixed: four points, no midpoint">
        <ol className="flex flex-col gap-1 text-sm">
          <li>1 · Strong no: clear evidence against</li>
          <li>2 · No: more against than for</li>
          <li>3 · Yes: more for than against</li>
          <li>4 · Strong yes: clear, repeated evidence for</li>
        </ol>
      </Section>
    </div>
  );
}

function PayBands({
  data,
  props,
}: {
  readonly data: SettingsData;
  readonly props: ScreenProps<SettingsData>;
}): JSX.Element {
  const act = useAct(props);
  const [grade, setGrade] = useState('');
  const [min, setMin] = useState<number | null>(null);
  const [max, setMax] = useState<number | null>(null);
  const [entity, setEntity] = useState(data.entities[0]?.id ?? '');
  const currency = data.entities.find((e) => e.id === entity)?.currency ?? 'EUR';
  return (
    <div className="flex flex-col gap-4">
      <Refusal error={act.error} />
      <Section
        title="Pay bands"
        description="Every offer is checked against its grade’s band; outside it needs a reason and an approval"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grade</TableHead>
              <TableHead>Range</TableHead>
              <TableHead>From</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.payBands.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{b.grade}</TableCell>
                <TableCell>{`${money(b.minMinor, b.currency)} – ${money(b.maxMinor, b.currency)}`}</TableCell>
                <TableCell>{b.source === 'people' ? 'People' : 'Recruiting'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <Field>
            <FieldLabel>Grade</FieldLabel>
            <FieldControl>
              <Input
                value={grade}
                onChange={(e) => {
                  setGrade(e.target.value);
                }}
                placeholder="E12"
              />
            </FieldControl>
          </Field>
          <NumberField label={`From (${currency})`} value={min} min={0} onChange={setMin} />
          <NumberField label={`To (${currency})`} value={max} min={0} onChange={setMax} />
          <Field>
            <FieldLabel>Entity</FieldLabel>
            <Select value={entity} onValueChange={setEntity}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue placeholder="Every entity" />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {data.entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="secondary"
            disabled={grade.trim() === '' || min === null || max === null}
            loading={act.pending}
            onClick={() => {
              act.run(
                'SavePayBand',
                {
                  id: newId(),
                  input: {
                    entityId: entity === '' ? null : entity,
                    grade,
                    minMinor: Math.round((min ?? 0) * 100),
                    maxMinor: Math.round((max ?? 0) * 100),
                    currency,
                  },
                },
                () => {
                  setGrade('');
                  setMin(null);
                  setMax(null);
                },
              );
            }}
          >
            Add band
          </Button>
        </div>
      </Section>
    </div>
  );
}

function Ai({
  data,
  props,
}: {
  readonly data: SettingsData;
  readonly props: ScreenProps<SettingsData>;
}): JSX.Element {
  const act = useAct(props);
  const [ai, setAi] = useState(data.general.ai);
  const [selfId, setSelfId] = useState(data.general.selfId ?? { gender: false, ethnicity: false });
  return (
    <div className="flex flex-col gap-4">
      <Refusal error={act.error} />
      <Alert tone="info" title="Every screen works without these">
        A model plans and drafts; it never decides. Applications are never used to train a model.
      </Alert>
      <Section title="Features" description="Each switched on or off on its own">
        <Toggle
          id="ai-writer"
          label="Write and translate job ads"
          checked={ai.writer}
          onChange={(on) => {
            setAi({ ...ai, writer: on });
          }}
        />
        <Toggle
          id="ai-parser"
          label="Parse CVs"
          checked={ai.parser}
          onChange={(on) => {
            setAi({ ...ai, parser: on });
          }}
        />
        <Toggle
          id="ai-matrix"
          label="Evidence matrix"
          hint="Met, partly met, not met or not evidenced per criterion, with the passages; a label, never a stage."
          checked={ai.matrix}
          onChange={(on) => {
            setAi({ ...ai, matrix: on });
          }}
        />
        <Toggle
          id="ai-assistant"
          label="Job assistant on Kithena Jobs"
          checked={ai.assistant}
          onChange={(on) => {
            setAi({ ...ai, assistant: on });
          }}
        />
        <Toggle
          id="ai-charts"
          label="Ask for a chart"
          checked={ai.charts}
          onChange={(on) => {
            setAi({ ...ai, charts: on });
          }}
        />
      </Section>
      <Section title="What the model never sees">
        <p className="text-sm">
          Name, photo, age, gender markers, nationality, address beyond the city, marital status,
          religion, health and union membership are always masked.
        </p>
        <Toggle
          id="ai-schools"
          label="Mask schools too"
          hint="Removes the names of universities and schools, against prestige bias."
          checked={ai.maskSchools ?? false}
          onChange={(on) => {
            setAi({ ...ai, maskSchools: on });
          }}
        />
      </Section>
      <Section
        title="Voluntary self-ID"
        description="Asked after applying, sealed, counted only in groups of five; never seen by a hiring team or a model"
      >
        <Toggle
          id="self-id-gender"
          label="Gender"
          hint="Where it is lawful to ask in the countries you hire in."
          checked={selfId.gender}
          onChange={(on) => {
            setSelfId({ ...selfId, gender: on });
          }}
        />
        <Toggle
          id="self-id-ethnicity"
          label="Race or ethnicity (US EEO-1)"
          hint="For a US employer."
          checked={selfId.ethnicity}
          onChange={(on) => {
            setSelfId({ ...selfId, ethnicity: on });
          }}
        />
      </Section>
      <Section
        title="New York City"
        description="Until a bias audit is recorded, NYC jobs keep the matrix off"
      >
        <Field>
          <FieldLabel>Last independent bias audit</FieldLabel>
          <FieldControl>
            <Input
              type="date"
              value={ai.nycAuditOn ?? ''}
              onChange={(e) => {
                setAi({ ...ai, nycAuditOn: e.target.value === '' ? null : e.target.value });
              }}
            />
          </FieldControl>
        </Field>
      </Section>
      <div className="flex justify-end">
        <Button
          loading={act.pending}
          onClick={() => {
            act.run('SaveRecruitingSettings', { input: { ...data.general, ai, selfId } });
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function Lists({ data }: { readonly data: SettingsData }): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Pipelines"
        description="A job copies its template; changes here don’t touch open jobs"
      >
        {data.pipelines.map((p) => (
          <div key={p.id} className="border-b border-[var(--reach-line)] py-2 last:border-b-0">
            <span className="flex items-center gap-2 font-medium">
              {p.name}
              {p.isDefault ? (
                <Badge size="sm" tone="accent">
                  Default
                </Badge>
              ) : null}
            </span>
            <span className="block text-sm text-fg-muted">
              {p.stages.map((s) => s.name).join(' → ')}
            </span>
          </div>
        ))}
      </Section>
      <Section title="Approval chains" description="The first chain whose conditions match is used">
        {data.chains.length === 0 ? (
          <p className="text-sm text-fg-muted">
            None: requisitions and offers go through without approval.
          </p>
        ) : null}
        {data.chains.map((c) => (
          <div key={c.id} className="border-b border-[var(--reach-line)] py-2 last:border-b-0">
            <span className="font-medium">{c.name}</span>
            <span className="block text-sm text-fg-muted">{`${words(c.appliesTo)} · ${String(c.steps.length)} step${c.steps.length === 1 ? '' : 's'}`}</span>
          </div>
        ))}
      </Section>
      <Section title="Questionnaires">
        {data.questionnaires.length === 0 ? <p className="text-sm text-fg-muted">None.</p> : null}
        {data.questionnaires.map((q) => (
          <div key={q.id} className="border-b border-[var(--reach-line)] py-2 last:border-b-0">
            <span className="font-medium">{`${q.name} · v${String(q.version)}`}</span>
          </div>
        ))}
      </Section>
      <Section title="Email and letter templates">
        {data.templates.map((t) => (
          <div key={t.id} className="border-b border-[var(--reach-line)] py-2 last:border-b-0">
            <span className="font-medium">{t.name}</span>
            <span className="block text-sm text-fg-muted">{`${words(t.kind)} · ${words(t.purpose)} · ${t.language.toUpperCase()}`}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Benefits({ data }: { readonly data: SettingsData }): JSX.Element {
  return (
    <Section
      title="Benefits catalogue"
      description="Per legal entity: shown on ads, the careers page, the composer and offers. Tax notes describe, never calculate."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Benefit</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Kind</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.benefits.map((b) => (
            <TableRow key={b.id}>
              <TableCell>{b.names['en'] ?? Object.values(b.names)[0] ?? words(b.key)}</TableCell>
              <TableCell>{words(b.category)}</TableCell>
              <TableCell>
                {data.entities.find((e) => e.id === b.legalEntityId)?.name ?? '—'}
              </TableCell>
              <TableCell>
                <Badge size="sm" tone={b.statutory ? 'neutral' : 'accent'}>
                  {b.statutory ? 'Statutory' : 'Company'}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function Integrations({ data }: { readonly data: SettingsData }): JSX.Element {
  const rows: readonly [string, string, string, string][] = [
    ['Job boards', 'Google for Jobs', 'Structured data on every job page', 'On'],
    ['Job boards', 'Open XML feed', `/feeds/${data.general.companySlug}.xml`, 'On'],
    ['Job boards', 'Indeed', 'Needs the partner agreement', 'Not available'],
    ['Job boards', 'LinkedIn', 'Partner-only; tracked share links meanwhile', 'Not available'],
    ['Careers page', 'Embed script', 'Your jobs on your own site', 'On'],
    ['HRIS', 'Hired webhook and REST', 'For an HRIS when People isn’t used', 'On'],
    ['Assessments', 'Provider', 'None chosen yet', 'Port only'],
    ['Background checks', 'Provider', 'None chosen yet', 'Port only'],
  ];
  return (
    <Section
      title="Integrations"
      description="Named by what they do; a vendor’s name only on its own row"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kind</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>What it does</TableHead>
            <TableHead>State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([k, n, w, s]) => (
            <TableRow key={n}>
              <TableCell className="text-sm text-fg-muted">{k}</TableCell>
              <TableCell>{n}</TableCell>
              <TableCell className="text-sm">{w}</TableCell>
              <TableCell>
                <Badge size="sm" tone={s === 'On' ? 'success' : 'neutral'}>
                  {s}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

const SECTIONS: Readonly<
  Record<
    string,
    {
      title: string;
      Body: (p: { data: SettingsData; props: ScreenProps<SettingsData> }) => JSX.Element;
    }
  >
> = {
  general: { title: 'General', Body: General },
  entities: { title: 'Entities and locations', Body: Entities },
  process: { title: 'Pipelines, approvals and templates', Body: Lists },
  scorecards: { title: 'Scorecards', Body: Scorecards },
  pay: { title: 'Pay bands', Body: PayBands },
  benefits: { title: 'Benefits', Body: Benefits },
  ai: { title: 'Kithena reading', Body: Ai },
  integrations: { title: 'Integrations', Body: Integrations },
};

export function Settings(props: ScreenProps<SettingsData>): JSX.Element {
  const key = props.path?.split('/')[3] ?? 'general';
  const section = SECTIONS[key] ?? SECTIONS['general'];
  return (
    <Loaded load={props.load} what="Recruiting’s settings">
      {(data) =>
        !data.admin ? (
          <Alert tone="warning" title="Administrators only">
            Ask an administrator to change Recruiting’s settings.
          </Alert>
        ) : section === undefined ? (
          <EmptyState icon={<icons.settings aria-hidden />} title="Nothing here" />
        ) : (
          <div className="flex flex-col gap-4">
            <PageHeader title={section.title} description="Recruiting" />
            <section.Body data={data} props={props} />
          </div>
        )
      }
    </Loaded>
  );
}
