import {
  Alert,
  Badge,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  FormSaveBar,
  FormSection,
  FormSections,
  List,
  ListItem,
  Input,
  CurrencyField,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  RowMenu,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  icons,
  DatePicker,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import {
  BenefitEditor,
  ChainEditor,
  DepartmentEditor,
  EntityEditor,
  InWords,
  LocationEditor,
  PipelineEditor,
  QuestionnaireEditor,
  TemplateEditor,
} from './settings-editors';
import { Refusal, money, newId, useAct, words } from './shared';
import type {
  ApprovalChain,
  Benefit,
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
 * S1–S9 under Settings, one place per address (`/settings/recruiting/*`).
 * Administrators only; Recruiting checks every write again.
 */

/** The row's menu: change it, and remove it where Recruiting owns it. */
function rowActions(
  name: string,
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
    { id: 'edit', label: `Edit ${name}`, icon: <icons.edit aria-hidden />, onSelect: onEdit },
    ...(onRemove === null
      ? []
      : [
          {
            id: 'remove',
            label: `Remove ${name}`,
            icon: <icons.remove aria-hidden />,
            destructive: true,
            onSelect: onRemove,
          },
        ]),
  ];
}

/** Where a row came from, when not from here. */
function FromPeople(): JSX.Element {
  return (
    <Badge size="sm" variant="outline">
      From People
    </Badge>
  );
}

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

/** Switches, each with what it does: a list, the switch at the trailing edge (Reach's settings list). */
function Toggles({
  items,
}: {
  readonly items: readonly {
    readonly label: string;
    readonly hint?: string;
    readonly checked: boolean;
    readonly onChange: (on: boolean) => void;
  }[];
}): JSX.Element {
  return (
    <List>
      {items.map((i) => (
        <ListItem
          key={i.label}
          description={i.hint}
          trailing={
            <Switch aria-label={i.label} checked={i.checked} onCheckedChange={i.onChange} />
          }
        >
          {i.label}
        </ListItem>
      ))}
    </List>
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
  const [saved, setSaved] = useState<GeneralSettings>(data.general);
  const [g, setG] = useState<GeneralSettings>(data.general);
  const [reason, setReason] = useState('');
  return (
    <FormSections>
      <Refusal error={act.error} />
      <FormSection title="Process">
        <Toggles
          items={[
            {
              label: 'Use requisitions',
              hint: 'Off: jobs open directly, without approval.',
              checked: g.requisitionsOn,
              onChange: (on) => {
                setG({ ...g, requisitionsOn: on });
              },
            },
          ]}
        />
        <Field>
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
        <Toggles
          items={[
            {
              label: 'Referral bonus',
              hint:
                g.referralBonus === null
                  ? 'Off'
                  : `${money(g.referralBonus.amountMinor, g.referralBonus.currency)}, after ${words(g.referralBonus.after).toLowerCase()}`,
              checked: g.referralBonus !== null,
              onChange: (on) => {
                setG({
                  ...g,
                  referralBonus: on
                    ? { amountMinor: 200_000, currency: 'EUR', after: 'probation' }
                    : null,
                });
              },
            },
          ]}
        />
        {g.referralBonus === null ? null : (
          <Field>
            <FieldLabel>Bonus amount</FieldLabel>
            <FieldControl>
              <CurrencyField
                currency={g.referralBonus.currency}
                value={String(g.referralBonus.amountMinor)}
                onValueChange={(minor) => {
                  setG({
                    ...g,
                    referralBonus:
                      g.referralBonus === null
                        ? null
                        : { ...g.referralBonus, amountMinor: Number(minor) || 0 },
                  });
                }}
              />
            </FieldControl>
            <FieldDescription>
              {`Paid to the referrer after the hire’s ${words(g.referralBonus.after).toLowerCase()}.`}
            </FieldDescription>
          </Field>
        )}
      </FormSection>
      <FormSection title="Rejection reasons" description="Internal; never sent to candidates">
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
      </FormSection>
      <FormSection title="Careers page" description="The company’s page on Kithena Jobs">
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
        <Toggles
          items={[
            {
              label: 'On Kithena Jobs’ search',
              hint: 'Beside your careers page, in the cross-company search.',
              checked: g.searchable,
              onChange: (on) => {
                setG({ ...g, searchable: on });
              },
            },
            {
              label: 'US federal contractor',
              hint: 'Adds the equal-opportunity statement to US jobs.',
              checked: g.federalContractor,
              onChange: (on) => {
                setG({ ...g, federalContractor: on });
              },
            },
          ]}
        />
      </FormSection>
      {data.domainsOn ? <OwnDomain domain={data.careersDomain} props={props} /> : null}
      <FormSaveBar
        open={JSON.stringify(g) !== JSON.stringify(saved)}
        saving={act.pending}
        message="Jobs opened from now on follow these."
        onDiscard={() => {
          setG(saved);
        }}
        onSave={() => {
          act.run('SaveRecruitingSettings', { input: g }, () => {
            setSaved(g);
          });
        }}
      />
    </FormSections>
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
    <FormSection
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
    </FormSection>
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
  const [entity, setEntity] = useState<SettingsEntity | null | 'new'>(null);
  const [location, setLocation] = useState<SettingsLocation | null | 'new'>(null);
  const [unit, setUnit] = useState<OrgUnit | null | 'new'>(null);
  const fromPeople = data.entities.some((e) => e.source === 'people');
  const entityName = (id: string | null): string =>
    data.entities.find((e) => e.id === id)?.name ?? '—';
  return (
    <FormSections>
      <Refusal error={act.error} />
      <InWords
        data={data}
        props={props}
        placeholder="Ask in words: add a Berlin office under Acme GmbH, or a Platform team under Engineering"
      />
      <FormSection
        title="Legal entities"
        description={
          fromPeople
            ? 'People’s entities, as they are there; Recruiting adds the currency, the week and the works council.'
            : 'Each hires in one country; its country pack decides the terms.'
        }
      >
        {data.entities.length === 0 ? (
          <EmptyState icon={<icons.company aria-hidden />} title="No legal entity yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entity</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Works council</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entities.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {e.name}
                      {e.source === 'people' ? <FromPeople /> : null}
                    </span>
                  </TableCell>
                  <TableCell>{e.country}</TableCell>
                  <TableCell>{e.currency}</TableCell>
                  <TableCell>{e.worksCouncil ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    <RowMenu
                      name={e.name}
                      actions={rowActions(
                        'entity',
                        () => {
                          setEntity(e);
                        },
                        e.source === 'people'
                          ? null
                          : () => {
                              act.run('RemoveEntity', { id: e.id });
                            },
                      )}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div>
          <Button
            variant="secondary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setEntity('new');
            }}
          >
            Add legal entity
          </Button>
        </div>
      </FormSection>
      <FormSection
        title="Locations"
        description="Where people work; each under the entity that hires there."
      >
        {data.locations.length === 0 ? (
          <EmptyState icon={<icons.location aria-hidden />} title="No location yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Time zone</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.locations.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {l.name}
                      {l.source === 'people' ? <FromPeople /> : null}
                    </span>
                  </TableCell>
                  <TableCell>{entityName(l.entityId)}</TableCell>
                  <TableCell>{l.country}</TableCell>
                  <TableCell>{l.timeZone}</TableCell>
                  <TableCell>
                    {l.source === 'people' ? null : (
                      <RowMenu
                        name={l.name}
                        actions={rowActions(
                          'location',
                          () => {
                            setLocation(l);
                          },
                          () => {
                            act.run('RemoveLocation', { id: l.id });
                          },
                        )}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div>
          <Button
            variant="secondary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setLocation('new');
            }}
          >
            Add location
          </Button>
        </div>
      </FormSection>
      <FormSection
        title="Departments"
        description="What a job is in. People’s where People is here; your own otherwise, or beside them."
      >
        {data.orgUnits.length === 0 ? (
          <EmptyState icon={<icons.people aria-hidden />} title="No department yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Under</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.orgUnits.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {u.name}
                      {u.source === 'people' ? <FromPeople /> : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    {u.parentId === null
                      ? '—'
                      : (data.orgUnits.find((x) => x.id === u.parentId)?.name ?? '—')}
                  </TableCell>
                  <TableCell>
                    {u.source === 'people' ? null : (
                      <RowMenu
                        name={u.name}
                        actions={rowActions(
                          'department',
                          () => {
                            setUnit(u);
                          },
                          () => {
                            act.run('RemoveOrgUnit', { id: u.id });
                          },
                        )}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div>
          <Button
            variant="secondary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setUnit('new');
            }}
          >
            Add department
          </Button>
        </div>
      </FormSection>
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
    </FormSections>
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
    <FormSections>
      <Refusal error={act.error} />
      <FormSection
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
                <span className="ms-auto">
                  <RowMenu
                    name={s.name}
                    actions={[
                      {
                        id: 'remove',
                        label: 'Remove scorecard',
                        icon: <icons.remove aria-hidden />,
                        destructive: true,
                        onSelect: () => {
                          act.run('RemoveScorecardTemplate', { id: s.id });
                        },
                      },
                    ]}
                  />
                </span>
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
      </FormSection>
      <FormSection title="New scorecard">
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
      </FormSection>
      <FormSection title="The scale" description="Fixed: four points, no midpoint">
        <ol className="flex flex-col gap-1 text-sm">
          <li>1 · Strong no: clear evidence against</li>
          <li>2 · No: more against than for</li>
          <li>3 · Yes: more for than against</li>
          <li>4 · Strong yes: clear, repeated evidence for</li>
        </ol>
      </FormSection>
    </FormSections>
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
  // Minor units as strings, as `CurrencyField` keeps them; empty is blank.
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [entity, setEntity] = useState(data.entities[0]?.id ?? '');
  const currency = data.entities.find((e) => e.id === entity)?.currency ?? 'EUR';
  return (
    <FormSections>
      <Refusal error={act.error} />
      <FormSection
        title="Pay bands"
        description="Every offer is checked against its grade’s band; outside it needs a reason and an approval"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grade</TableHead>
              <TableHead>Range</TableHead>
              <TableHead>From</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.payBands.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{b.grade}</TableCell>
                <TableCell>{`${money(b.minMinor, b.currency)} – ${money(b.maxMinor, b.currency)}`}</TableCell>
                <TableCell>{b.source === 'people' ? 'People' : 'Recruiting'}</TableCell>
                <TableCell>
                  {b.source === 'people' ? null : (
                    <RowMenu
                      name={b.grade}
                      actions={[
                        {
                          id: 'remove',
                          label: 'Remove pay band',
                          icon: <icons.remove aria-hidden />,
                          destructive: true,
                          onSelect: () => {
                            act.run('RemovePayBand', { id: b.id });
                          },
                        },
                      ]}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-3 flex flex-col gap-3">
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
          <Field>
            <FieldLabel>From</FieldLabel>
            <FieldControl>
              <CurrencyField currency={currency} value={min} onValueChange={setMin} />
            </FieldControl>
            <FieldDescription>The band’s floor, in the entity’s currency.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>To</FieldLabel>
            <FieldControl>
              <CurrencyField currency={currency} value={max} onValueChange={setMax} />
            </FieldControl>
            <FieldDescription>
              Its ceiling; an offer above it needs a reason and an approval.
            </FieldDescription>
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="secondary"
            disabled={grade.trim() === '' || min === '' || max === ''}
            loading={act.pending}
            onClick={() => {
              act.run(
                'SavePayBand',
                {
                  id: newId(),
                  input: {
                    entityId: entity === '' ? null : entity,
                    grade,
                    minMinor: Number(min),
                    maxMinor: Number(max),
                    currency,
                  },
                },
                () => {
                  setGrade('');
                  setMin('');
                  setMax('');
                },
              );
            }}
          >
            Add band
          </Button>
        </div>
      </FormSection>
    </FormSections>
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
  const [saved, setSaved] = useState({
    ai: data.general.ai,
    selfId: data.general.selfId ?? { gender: false, ethnicity: false },
  });
  const [ai, setAi] = useState(saved.ai);
  const [selfId, setSelfId] = useState(saved.selfId);
  return (
    <FormSections>
      <Refusal error={act.error} />
      <Alert tone="info" title="Every screen works without these">
        A model plans and drafts; it never decides. Applications are never used to train a model.
      </Alert>
      <FormSection title="Features" description="Each switched on or off on its own">
        <Toggles
          items={[
            {
              label: 'Write and translate job ads',
              checked: ai.writer,
              onChange: (on) => {
                setAi({ ...ai, writer: on });
              },
            },
            {
              label: 'Parse CVs',
              checked: ai.parser,
              onChange: (on) => {
                setAi({ ...ai, parser: on });
              },
            },
            {
              label: 'Evidence matrix',
              hint: 'Met, partly met, not met or not evidenced per criterion, with the passages; a label, never a stage.',
              checked: ai.matrix,
              onChange: (on) => {
                setAi({ ...ai, matrix: on });
              },
            },
            {
              label: 'Job assistant on Kithena Jobs, and settings asked for in words',
              hint: 'Proposes changes to these settings from a request; an administrator applies them.',
              checked: ai.assistant,
              onChange: (on) => {
                setAi({ ...ai, assistant: on });
              },
            },
            {
              label: 'Ask for a chart',
              checked: ai.charts,
              onChange: (on) => {
                setAi({ ...ai, charts: on });
              },
            },
          ]}
        />
      </FormSection>
      <FormSection title="What the model never sees">
        <p className="text-sm">
          Name, photo, age, gender markers, nationality, address beyond the city, marital status,
          religion, health and union membership are always masked.
        </p>
        <Toggles
          items={[
            {
              label: 'Mask schools too',
              hint: 'Removes the names of universities and schools, against prestige bias.',
              checked: ai.maskSchools ?? false,
              onChange: (on) => {
                setAi({ ...ai, maskSchools: on });
              },
            },
          ]}
        />
      </FormSection>
      <FormSection
        title="Voluntary self-ID"
        description="Asked after applying, sealed, counted only in groups of five; never seen by a hiring team or a model"
      >
        <Toggles
          items={[
            {
              label: 'Gender',
              hint: 'Where it is lawful to ask in the countries you hire in.',
              checked: selfId.gender,
              onChange: (on) => {
                setSelfId({ ...selfId, gender: on });
              },
            },
            {
              label: 'Race or ethnicity (US EEO-1)',
              hint: 'For a US employer.',
              checked: selfId.ethnicity,
              onChange: (on) => {
                setSelfId({ ...selfId, ethnicity: on });
              },
            },
          ]}
        />
      </FormSection>
      <FormSection
        title="New York City"
        description="Until a bias audit is recorded, NYC jobs keep the matrix off"
      >
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
        </Field>
      </FormSection>
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
    </FormSections>
  );
}

/** A row of one of the process lists: the name, a line under it, and its menu. */
function ProcessRow({
  name,
  detail,
  badge,
  onEdit,
  onRemove,
}: {
  readonly name: string;
  readonly detail: string;
  readonly badge?: JSX.Element;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}): JSX.Element {
  return (
    <ListItem
      description={detail}
      trailing={<RowMenu name={name} actions={rowActions(name, onEdit, onRemove)} />}
    >
      <span className="flex items-center gap-2">
        {name}
        {badge}
      </span>
    </ListItem>
  );
}

function AddRow({
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

function Lists({
  data,
  props,
}: {
  readonly data: SettingsData;
  readonly props: ScreenProps<SettingsData>;
}): JSX.Element {
  const act = useAct(props);
  const [pipeline, setPipeline] = useState<SettingsData['pipelines'][number] | null | 'new'>(null);
  const [chain, setChain] = useState<ApprovalChain | null | 'new'>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null | 'new'>(null);
  const [template, setTemplate] = useState<MessageTemplate | null | 'new'>(null);
  return (
    <FormSections>
      <Refusal error={act.error} />
      <InWords
        data={data}
        props={props}
        placeholder="Ask in words: a pipeline for interns with no assessment, or an approval chain for budgets over 100k"
      />
      <FormSection
        title="Pipelines"
        description="A job copies its template; changes here don’t touch open jobs."
      >
        <List>
          {data.pipelines.map((p) => (
            <ProcessRow
              key={p.id}
              name={p.name}
              detail={p.stages.map((s) => s.name).join(' → ')}
              {...(p.isDefault
                ? {
                    badge: (
                      <Badge size="sm" tone="accent">
                        Default
                      </Badge>
                    ),
                  }
                : {})}
              onEdit={() => {
                setPipeline(p);
              }}
              onRemove={() => {
                act.run('RemovePipeline', { id: p.id });
              }}
            />
          ))}
        </List>
        <AddRow
          label="Add pipeline"
          onClick={() => {
            setPipeline('new');
          }}
        />
      </FormSection>
      <FormSection
        title="Approval chains"
        description="The first chain whose conditions match is used; none, and requisitions and offers go through without approval."
      >
        {data.chains.length === 0 ? null : (
          <List>
            {data.chains.map((c) => (
              <ProcessRow
                key={c.id}
                name={c.name}
                detail={`${words(c.appliesTo)}s · ${String(c.steps.length)} step${c.steps.length === 1 ? '' : 's'} · priority ${String(c.priority)}`}
                onEdit={() => {
                  setChain(c);
                }}
                onRemove={() => {
                  act.run('RemoveChain', { id: c.id });
                }}
              />
            ))}
          </List>
        )}
        <AddRow
          label="Add approval chain"
          onClick={() => {
            setChain('new');
          }}
        />
      </FormSection>
      <FormSection
        title="Questionnaires"
        description="Asked on the apply form or sent at a stage. A change makes a new version; a DE job needs the works council’s consent to the version it uses."
      >
        {data.questionnaires.length === 0 ? null : (
          <List>
            {data.questionnaires.map((q) => (
              <ProcessRow
                key={q.id}
                name={q.name}
                detail={`Version ${String(q.version)} · ${String(q.questions.length)} question${q.questions.length === 1 ? '' : 's'}${q.worksCouncilConsentVersion === q.version ? ' · works council consented' : ''}`}
                onEdit={() => {
                  setQuestionnaire(q);
                }}
                onRemove={() => {
                  act.run('RemoveQuestionnaire', { id: q.id });
                }}
              />
            ))}
          </List>
        )}
        <AddRow
          label="Add questionnaire"
          onClick={() => {
            setQuestionnaire('new');
          }}
        />
      </FormSection>
      <FormSection
        title="Email and letter templates"
        description="What a stage sends, and what an offer or a contract starts from."
      >
        {data.templates.length === 0 ? null : (
          <List>
            {data.templates.map((t) => (
              <ProcessRow
                key={t.id}
                name={t.name}
                detail={`${words(t.kind)} · ${words(t.purpose)} · ${t.language.toUpperCase()}`}
                onEdit={() => {
                  setTemplate(t);
                }}
                onRemove={() => {
                  act.run('RemoveTemplate', { id: t.id });
                }}
              />
            ))}
          </List>
        )}
        <AddRow
          label="Add template"
          onClick={() => {
            setTemplate('new');
          }}
        />
      </FormSection>
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
      {questionnaire === null ? null : (
        <QuestionnaireEditor
          held={questionnaire === 'new' ? null : questionnaire}
          act={act}
          onClose={() => {
            setQuestionnaire(null);
          }}
        />
      )}
      {template === null ? null : (
        <TemplateEditor
          held={template === 'new' ? null : template}
          act={act}
          onClose={() => {
            setTemplate(null);
          }}
        />
      )}
    </FormSections>
  );
}

const worth = (b: Benefit): string => {
  switch (b.value.kind) {
    case 'money':
      return `${money(b.value.yearlyMinor, b.value.currency)} a year`;
    case 'percent':
      return `${String(b.value.basisPoints / 100)}% of pay`;
    case 'days':
      return `${String(b.value.days)} days`;
    default:
      return 'Described';
  }
};

function Benefits({
  data,
  props,
}: {
  readonly data: SettingsData;
  readonly props: ScreenProps<SettingsData>;
}): JSX.Element {
  const act = useAct(props);
  const [benefit, setBenefit] = useState<Benefit | null | 'new'>(null);
  return (
    <FormSections>
      <Refusal error={act.error} />
      <InWords
        data={data}
        props={props}
        placeholder="Ask in words: a €50 a month meal allowance for Acme GmbH, after probation"
      />
      <FormSection
        title="Benefits catalogue"
        description="Per legal entity: shown on ads, the careers page, the composer and offers. Statutory ones come with the country pack and stay; tax notes describe, never calculate."
      >
        {data.entities.length === 0 ? (
          <Alert tone="info" title="Add a legal entity first">
            A benefit belongs to the entity that offers it.
          </Alert>
        ) : null}
        {data.benefits.length === 0 ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Benefit</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Worth</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.benefits.map((b) => {
                const name = b.names['en'] ?? Object.values(b.names)[0] ?? words(b.key);
                return (
                  <TableRow key={b.id}>
                    <TableCell>{name}</TableCell>
                    <TableCell>{words(b.category)}</TableCell>
                    <TableCell>
                      {data.entities.find((e) => e.id === b.legalEntityId)?.name ?? '—'}
                    </TableCell>
                    <TableCell>{worth(b)}</TableCell>
                    <TableCell>
                      <Badge size="sm" tone={b.statutory ? 'neutral' : 'accent'}>
                        {b.statutory ? 'Statutory' : 'Company'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {b.statutory ? null : (
                        <RowMenu
                          name={name}
                          actions={rowActions(
                            'benefit',
                            () => {
                              setBenefit(b);
                            },
                            () => {
                              act.run('RemoveBenefit', { id: b.id });
                            },
                          )}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <div>
          <Button
            variant="secondary"
            startIcon={<icons.add aria-hidden />}
            disabled={data.entities.length === 0}
            onClick={() => {
              setBenefit('new');
            }}
          >
            Add benefit
          </Button>
        </div>
      </FormSection>
      {benefit === null ? null : (
        <BenefitEditor
          held={benefit === 'new' ? null : benefit}
          data={data}
          act={act}
          onClose={() => {
            setBenefit(null);
          }}
        />
      )}
    </FormSections>
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
    <FormSection
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
    </FormSection>
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
