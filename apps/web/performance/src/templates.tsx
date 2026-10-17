import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ChipRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  NumberField,
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
  Timeline,
  TimelineItem,
  SortableList,
  FieldRow,
  ChangeDiff,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { FormView } from './form-view';
import { Loaded } from './load';
import {
  Choose,
  Modal,
  Refusal,
  Search,
  StepDialog,
  SwitchRow,
  To,
  day,
  kindLabel,
  plural,
  useAct,
  when,
  type Act,
} from './shared';
import type { Answers, FormDefinition, Question, ScaleOption, ScreenProps, Section } from './types';

/**
 * Form templates (PRD §11, design PF2–PF3 v2): the list with its filters, the
 * builder in two panes (sections and questions on the left, the form as it
 * reads on the right), publishing with what it moves, versions, and the AI
 * that writes, checks and translates a form for a person to accept.
 */

const ACTIVITIES = ['self', 'manager', 'peer', 'upward', 'goals', 'feedback'] as const;
const activityLabel = (a: string): string => (a === 'feedback' ? 'Feedback' : kindLabel(a));

/* ------------------------------------------------------------ the list -- */

export interface TemplatesData {
  readonly rows: readonly {
    readonly id: string;
    readonly name: string;
    readonly purpose: readonly string[];
    readonly version: string;
    readonly state: string;
    readonly inCycles: number;
    readonly updatedAt: string;
    readonly canDelete: boolean;
    readonly questions: number;
    readonly published: number | null;
    readonly hasScore: boolean;
  }[];
  readonly hr: boolean;
}

const SHOW = [
  ['', 'All'],
  ['scored', 'Has a performance score'],
  ['feedback', 'Usable for feedback'],
  ['archived', 'Archived'],
] as const;

export function Templates(props: ScreenProps<TemplatesData>): JSX.Element {
  const act = useAct(props);
  const show = props.search?.['show'] ?? '';
  const [creating, setCreating] = useState(props.search?.['new'] === '1');
  const [archiving, setArchiving] = useState<TemplatesData['rows'][number] | null>(null);
  return (
    <Loaded load={props.load} what="form templates">
      {(data) => {
        const rows = show === 'scored' ? data.rows.filter((r) => r.hasScore) : data.rows;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title="Form templates"
              description="The forms every review and feedback request is written on. A published version never changes."
              actions={
                data.hr ? (
                  <Button
                    startIcon={<icons.add aria-hidden />}
                    onClick={() => {
                      setCreating(true);
                    }}
                  >
                    New template
                  </Button>
                ) : null
              }
            />
            <Refusal error={act.error} />
            <div className="flex flex-wrap items-center gap-3">
              <ChipRow aria-label="Show">
                {SHOW.map(([v, l]) => (
                  <Chip
                    key={v}
                    selected={show === v}
                    onClick={() => {
                      props.onFilter?.({ show: v === '' ? null : v });
                    }}
                  >
                    {l}
                  </Chip>
                ))}
              </ChipRow>
              <Search
                label="Search templates"
                placeholder="Search by name"
                initial={props.search?.['q'] ?? ''}
                onSearch={(q) => {
                  props.onFilter?.({ q: q === '' ? null : q });
                }}
              />
            </div>
            <Card>
              <CardContent className="overflow-x-auto">
                {rows.length === 0 ? (
                  <EmptyState
                    icon={<icons.document aria-hidden />}
                    title="No templates here"
                    description="Start one from scratch, or describe it and let AI draft it."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Template</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Latest</TableHead>
                        <TableHead>Cycles</TableHead>
                        <TableHead>Edited</TableHead>
                        <TableHead>
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <To
                              href={`/performance/templates/${r.id}`}
                              onNavigate={props.onNavigate}
                            >
                              {r.name}
                            </To>
                            <span className="mt-1 flex flex-wrap gap-1">
                              {r.purpose.map((p) => (
                                <Badge key={p} size="sm">
                                  {activityLabel(p)}
                                </Badge>
                              ))}
                              {r.hasScore ? (
                                <Badge size="sm" tone="accent">
                                  Performance score
                                </Badge>
                              ) : null}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              size="sm"
                              tone={
                                r.state === 'published'
                                  ? 'success'
                                  : r.state === 'archived'
                                    ? 'neutral'
                                    : 'warning'
                              }
                            >
                              {r.state === 'published'
                                ? 'Published'
                                : r.state === 'archived'
                                  ? 'Archived'
                                  : r.state === 'draft'
                                    ? 'Draft'
                                    : 'Draft changes'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{`${r.version} · ${plural(r.questions, 'question')}`}</TableCell>
                          <TableCell className="text-sm text-fg-muted">
                            {r.inCycles === 0 ? 'None' : plural(r.inCycles, 'cycle')}
                          </TableCell>
                          <TableCell className="text-sm text-fg-muted">
                            {day(r.updatedAt)}
                          </TableCell>
                          <TableCell>
                            {data.hr ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label={`Actions for ${r.name}`}
                                    startIcon={<icons.more aria-hidden />}
                                  />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      props.onNavigate?.(`/performance/templates/${r.id}`);
                                    }}
                                  >
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      props.onNavigate?.(`/performance/templates/${r.id}/preview`);
                                    }}
                                  >
                                    Preview
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      act.run(
                                        'DuplicatePerformanceTemplate',
                                        { id: r.id, input: { version: null } },
                                        (d) => {
                                          props.onNavigate?.(
                                            `/performance/templates/${(d as { id: string }).id}`,
                                          );
                                        },
                                      );
                                    }}
                                  >
                                    Duplicate
                                  </DropdownMenuItem>
                                  {r.state === 'archived' ? (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        act.run('ArchivePerformanceTemplate', {
                                          id: r.id,
                                          input: { archived: false },
                                        });
                                      }}
                                    >
                                      Unarchive
                                    </DropdownMenuItem>
                                  ) : r.canDelete ? (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        act.run('DeletePerformanceTemplate', { id: r.id });
                                      }}
                                    >
                                      Delete template
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        setArchiving(r);
                                      }}
                                    >
                                      Archive
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            {creating ? (
              <NewTemplate
                act={act}
                onNavigate={props.onNavigate}
                onClose={() => {
                  setCreating(false);
                }}
              />
            ) : null}
            {archiving === null ? null : (
              <Modal
                open
                onClose={() => {
                  setArchiving(null);
                }}
                title={`Archive ${archiving.name}?`}
                description="It leaves every picker. Cycles already using it keep their version, and you can unarchive it."
                footer={
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setArchiving(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      loading={act.pending}
                      onClick={() => {
                        act.run(
                          'ArchivePerformanceTemplate',
                          { id: archiving.id, input: { archived: true } },
                          () => {
                            setArchiving(null);
                          },
                        );
                      }}
                    >
                      Archive
                    </Button>
                  </>
                }
              >
                {archiving.inCycles > 0 ? (
                  <Alert tone="warning" title={`Used by ${plural(archiving.inCycles, 'cycle')}`}>
                    An automation that names it will need another form before its next cycle.
                  </Alert>
                ) : null}
              </Modal>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

/** PF2f: a blank template, or one AI drafts from a description, opened in the builder. */
function NewTemplate({
  act,
  onNavigate,
  onClose,
}: {
  readonly act: Act;
  readonly onNavigate?: ((to: string) => void) | undefined;
  readonly onClose: () => void;
}): JSX.Element {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<readonly string[]>(['manager']);
  const [how, setHow] = useState<'blank' | 'ai'>('blank');
  const [describe, setDescribe] = useState('');
  const [draft, setDraft] = useState<FormDefinition | null>(null);
  const steps =
    how === 'ai' ? ['Describe', 'Draft', 'Open in builder'] : ['Describe', 'Open in builder'];
  const create = (): void => {
    act.run('CreatePerformanceTemplate', { input: { name, purpose, definition: draft } }, (d) => {
      onNavigate?.(`/performance/templates/${(d as { id: string }).id}`);
    });
  };
  return (
    <StepDialog
      open
      onClose={onClose}
      title="New template"
      steps={steps}
      step={step}
      onStep={(s) => {
        if (how === 'ai' && s === 1 && draft === null)
          void act
            .call('WritePerformanceTemplate', { input: { description: describe } })
            .then((d) => {
              if (d.ok) setDraft((d.data as { definition: FormDefinition }).definition);
            });
        setStep(s);
      }}
      finish={create}
      finishLabel="Open in builder"
      pending={act.pending}
      canNext={
        name.trim() !== '' &&
        purpose.length > 0 &&
        (how === 'blank' || step > 0 || describe.trim().length >= 5)
      }
    >
      <Refusal error={act.error} />
      {step === 0 ? (
        <div className="flex flex-col gap-4">
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="Manager review, H2"
            />
          </Field>
          <Field>
            <FieldLabel>Used for</FieldLabel>
            <ChipRow aria-label="Used for">
              {ACTIVITIES.map((a) => (
                <Chip
                  key={a}
                  selected={purpose.includes(a)}
                  onClick={() => {
                    setPurpose(
                      purpose.includes(a) ? purpose.filter((x) => x !== a) : [...purpose, a],
                    );
                  }}
                >
                  {activityLabel(a)}
                </Chip>
              ))}
            </ChipRow>
          </Field>
          <SegmentedControl
            aria-label="Start from"
            value={how}
            onValueChange={(v) => {
              setHow(v === 'ai' ? 'ai' : 'blank');
            }}
          >
            <SegmentedControlItem value="blank">Start blank</SegmentedControlItem>
            <SegmentedControlItem value="ai">Write with AI</SegmentedControlItem>
          </SegmentedControl>
          {how === 'ai' ? (
            <Field>
              <FieldLabel>Describe the form</FieldLabel>
              <Textarea
                autoResize
                value={describe}
                onChange={(e) => {
                  setDescribe(e.target.value);
                }}
                placeholder="A half-yearly manager review for engineers: impact, craft, collaboration, and a score."
              />
            </Field>
          ) : null}
        </div>
      ) : how === 'ai' && step === 1 ? (
        draft === null ? (
          <p className="text-sm text-fg-muted">
            {act.pending ? 'Drafting…' : 'Drafting the form from your description.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Alert tone="info" title="A draft for you to edit">
              Nothing is published until you publish it. Every question can be changed in the
              builder.
            </Alert>
            {draft.sections.map((s) => (
              <p key={s.id} className="text-sm">
                <span className="font-semibold">{s.title}</span>
                {` · ${plural(s.questions.length, 'question')}`}
              </p>
            ))}
          </div>
        )
      ) : (
        <p className="text-sm">{`“${name}” opens in the builder as a draft.`}</p>
      )}
    </StepDialog>
  );
}

/* ----------------------------------------------------------- the builder -- */

interface Version {
  readonly version: number;
  readonly state: string;
  readonly by: string;
  readonly at: string;
  readonly publishedAt: string | null;
  readonly pinnedBy: readonly string[];
}

export interface BuilderData {
  readonly id: string;
  readonly name: string;
  readonly purpose: readonly string[];
  readonly archived: boolean;
  readonly state: string;
  readonly current: {
    readonly version: number;
    readonly state: string;
    readonly definition: FormDefinition;
  } | null;
  readonly published: number | null;
  readonly draft: number | null;
  readonly versions: readonly Version[];
  readonly cycles: readonly {
    readonly id: string;
    readonly name: string;
    readonly state: string;
    readonly version: number | null;
  }[];
  readonly scale: readonly ScaleOption[];
  readonly canDelete: boolean;
  readonly hr: boolean;
}

const short = (): string => crypto.randomUUID().replaceAll('-', '').slice(0, 10);

const blank = (type: Question['type'], scale: readonly ScaleOption[]): Question => {
  const base = {
    id: `q${short()}`,
    prompt: 'New question',
    help: null,
    required: true,
    allowComment: false,
    private: false,
  };
  if (type === 'scale') return { ...base, type, options: scale };
  if (type === 'binary') return { ...base, type, yes: 'Yes', no: 'No' };
  if (type === 'choice')
    return {
      ...base,
      type,
      options: [
        { id: 'a', label: 'First' },
        { id: 'b', label: 'Second' },
      ],
      multiple: false,
      min: null,
      max: null,
    };
  if (type === 'performance_score') return { ...base, type, prompt: 'Performance score' };
  return { ...base, type: 'text', guidance: null };
};

/** Each kind of question's glyph, for its row in the builder. */
const QUESTION_ICON: Readonly<Record<string, JSX.Element>> = {
  text: <icons.message aria-hidden />,
  scale: <icons.assessment aria-hidden />,
  binary: <icons.approve aria-hidden />,
  choice: <icons.list aria-hidden />,
  performance_score: <icons.analytics aria-hidden />,
};

const TYPES = [
  ['text', 'Text'],
  ['scale', 'Scale'],
  ['binary', 'Yes or no'],
  ['choice', 'Choice'],
] as const;

export function Builder(props: ScreenProps<BuilderData>): JSX.Element {
  return (
    <Loaded load={props.load} what="the template">
      {(data) => (
        <Building key={`${data.id}-${String(data.current?.version ?? 0)}`} data={data} {...props} />
      )}
    </Loaded>
  );
}

function Building({
  data,
  ...props
}: ScreenProps<BuilderData> & { readonly data: BuilderData }): JSX.Element {
  const act = useAct(props);
  const [def, setDef] = useState<FormDefinition>(
    data.current?.definition ?? { title: data.name, description: null, sections: [] },
  );
  const [name, setName] = useState(data.name);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ readonly section: Section; readonly at: number } | null>(
    null,
  );
  const [warnPrivate, setWarnPrivate] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<{
    move: readonly { name: string }[];
    stay: readonly { name: string }[];
  } | null>(null);
  const [as, setAs] = useState<'reviewer' | 'subject'>('reviewer');
  const [device, setDevice] = useState<'web' | 'phone'>('web');
  const [answers, setAnswers] = useState<Answers>({});
  const [issues, setIssues] = useState<
    readonly { questionId: string; level: string; title: string }[] | null
  >(null);
  const scored = def.sections.some((s) => s.questions.some((q) => q.type === 'performance_score'));
  const set = (next: FormDefinition): void => {
    setDef(next);
    setDirty(true);
  };
  const setSection = (i: number, patch: Partial<Section>): void => {
    set({ ...def, sections: def.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  };
  const setQuestion = (id: string, next: Question): void => {
    set({
      ...def,
      sections: def.sections.map((s) => ({
        ...s,
        questions: s.questions.map((q) => (q.id === id ? next : q)),
      })),
    });
  };
  const removeQuestion = (si: number, id: string): void => {
    const section = def.sections[si];
    if (section === undefined) return;
    const left = section.questions.filter((q) => q.id !== id);
    if (left.length === 0) {
      // An empty section goes with its last question, and can come back (PF2g).
      setRemoved({ section, at: si });
      set({ ...def, sections: def.sections.filter((_, j) => j !== si) });
    } else setSection(si, { questions: left });
  };
  const save = (after?: () => void): void => {
    act.run('SavePerformanceTemplate', { id: data.id, input: { name, definition: def } }, () => {
      setDirty(false);
      after?.();
    });
  };
  const openPublish = (): void => {
    void act.call('PerformancePublishImpact', { id: data.id }).then((d) => {
      if (d.ok) setPublishing(d.data as { move: { name: string }[]; stay: { name: string }[] });
    });
  };
  // The section a performance score lives in stays last (§11.4).
  const ordered = [
    ...def.sections.filter((s) => !s.questions.some((q) => q.type === 'performance_score')),
    ...def.sections.filter((s) => s.questions.some((q) => q.type === 'performance_score')),
  ];
  const shown: FormDefinition =
    as === 'subject'
      ? {
          ...def,
          sections: ordered
            .map((s) => ({ ...s, questions: s.questions.filter((q) => !q.private) }))
            .filter((s) => s.questions.length > 0),
        }
      : { ...def, sections: ordered };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={name}
        description={`${data.published === null ? 'Not published yet' : `v${String(data.published)} published`}${data.draft === null ? '' : ` · draft v${String(data.draft)}`}${dirty ? ' · unsaved changes' : ''}`}
        actions={
          data.hr ? (
            <>
              <Button variant="secondary" asChild>
                <a href={`/performance/templates/${data.id}/history`}>History</a>
              </Button>
              <Button
                variant="secondary"
                loading={act.pending}
                onClick={() => {
                  void act.call('CheckPerformanceTemplate', { id: data.id }).then((d) => {
                    if (d.ok) setIssues((d.data as { issues: typeof issues }).issues);
                  });
                }}
              >
                Check with AI
              </Button>
              <Button
                variant="secondary"
                disabled={!dirty}
                loading={act.pending}
                onClick={() => {
                  save();
                }}
              >
                Save draft
              </Button>
              <Button
                loading={act.pending}
                onClick={() => {
                  if (dirty) save(openPublish);
                  else openPublish();
                }}
              >
                Publish
              </Button>
            </>
          ) : null
        }
      />
      <Refusal error={act.error} />
      {removed === null ? null : (
        <Alert tone="info" title={`“${removed.section.title}” was empty, so it was removed`}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              set({
                ...def,
                sections: [
                  ...def.sections.slice(0, removed.at),
                  removed.section,
                  ...def.sections.slice(removed.at),
                ],
              });
              setRemoved(null);
            }}
          >
            Undo
          </Button>
        </Alert>
      )}
      {issues === null ? null : (
        <Alert
          tone={issues.length === 0 ? 'success' : 'warning'}
          title={
            issues.length === 0
              ? 'Nothing to change'
              : `${plural(issues.length, 'suggestion')} from the check`
          }
        >
          <ul className="flex flex-col gap-1">
            {issues.map((i) => (
              <li key={`${i.questionId}-${i.title}`}>{i.title}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Template name</FieldLabel>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          {ordered.map((s) => {
            const si = def.sections.indexOf(s);
            const locked = s.questions.some((q) => q.type === 'performance_score');
            return (
              <Card key={s.id}>
                <CardHeader className="flex flex-col gap-2">
                  <Input
                    aria-label="Section title"
                    value={s.title}
                    disabled={locked}
                    onChange={(e) => {
                      setSection(si, { title: e.target.value });
                    }}
                  />
                  {locked ? (
                    <p className="text-sm text-fg-muted">
                      Computed from the rating answers on the company’s scale; always last and
                      always required.
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <SortableList
                    label={`Questions in ${s.title || 'this section'}`}
                    items={s.questions.map((q) => ({
                      id: q.id,
                      locked: q.type === 'performance_score',
                      q,
                    }))}
                    activator="handle"
                    moveButtons="on-focus"
                    itemLabel={(i) => i.q.prompt}
                    onReorder={(move) => {
                      const byId = new Map(s.questions.map((q) => [q.id, q]));
                      setSection(si, {
                        questions: move.order.flatMap((id) => {
                          const q = byId.get(id);
                          return q === undefined ? [] : [q];
                        }),
                      });
                    }}
                  >
                    {({ q }) =>
                      selected === q.id && q.type !== 'performance_score' ? (
                        <QuestionEditor
                          key={q.id}
                          question={q}
                          onChange={(next) => {
                            if (next.private && !q.private && data.purpose.includes('self'))
                              setWarnPrivate(q.id);
                            setQuestion(q.id, next);
                          }}
                          onRemove={() => {
                            removeQuestion(si, q.id);
                          }}
                          onDone={() => {
                            setSelected(null);
                          }}
                          scale={data.scale}
                        />
                      ) : (
                        <FieldRow
                          icon={QUESTION_ICON[q.type] ?? <icons.list aria-hidden />}
                          title={q.prompt}
                          badges={
                            <>
                              {q.required ? (
                                <Badge size="sm" variant="outline">
                                  Required
                                </Badge>
                              ) : null}
                              {q.private ? (
                                <Badge size="sm" tone="warning">
                                  Private
                                </Badge>
                              ) : null}
                            </>
                          }
                          description={
                            TYPES.find(([t]) => t === q.type)?.[1] ??
                            (q.type === 'performance_score'
                              ? 'Performance score, computed'
                              : q.type)
                          }
                          {...(q.type === 'performance_score'
                            ? {}
                            : {
                                onOpen: () => {
                                  setSelected(q.id);
                                },
                              })}
                        />
                      )
                    }
                  </SortableList>
                  {locked ? null : (
                    <Button
                      size="sm"
                      variant="secondary"
                      startIcon={<icons.add aria-hidden />}
                      onClick={() => {
                        const q = blank('text', data.scale);
                        setSection(si, { questions: [...s.questions, q] });
                        setSelected(q.id);
                      }}
                    >
                      Add question
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              startIcon={<icons.add aria-hidden />}
              onClick={() => {
                const q = blank('text', data.scale);
                set({
                  ...def,
                  sections: [
                    ...def.sections,
                    {
                      id: `s${short()}`,
                      title: `Section ${String(def.sections.length + 1)}`,
                      description: null,
                      questions: [q],
                    },
                  ],
                });
                setSelected(q.id);
              }}
            >
              Add section
            </Button>
            {scored ? null : (
              <Button
                variant="secondary"
                onClick={() => {
                  set({
                    ...def,
                    sections: [
                      ...def.sections,
                      {
                        id: 'score',
                        title: 'Performance score',
                        description: null,
                        questions: [blank('performance_score', data.scale)],
                      },
                    ],
                  });
                }}
              >
                Add a performance score
              </Button>
            )}
          </div>
        </div>
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle level={2}>Preview</CardTitle>
            <span className="flex gap-2">
              <SegmentedControl
                size="sm"
                aria-label="Device"
                value={device}
                onValueChange={(v) => {
                  setDevice(v === 'phone' ? 'phone' : 'web');
                }}
              >
                <SegmentedControlItem value="web">Web</SegmentedControlItem>
                <SegmentedControlItem value="phone">Phone</SegmentedControlItem>
              </SegmentedControl>
              <SegmentedControl
                size="sm"
                aria-label="Seen by"
                value={as}
                onValueChange={(v) => {
                  setAs(v === 'subject' ? 'subject' : 'reviewer');
                }}
              >
                <SegmentedControlItem value="reviewer">Reviewer</SegmentedControlItem>
                <SegmentedControlItem value="subject">Subject</SegmentedControlItem>
              </SegmentedControl>
            </span>
          </CardHeader>
          <CardContent className={device === 'phone' ? 'mx-auto w-full max-w-sm' : ''}>
            {shown.sections.length === 0 ? (
              <p className="text-sm text-fg-muted">Add a question to see the form.</p>
            ) : (
              <FormView
                definition={shown}
                answers={answers}
                scale={data.scale}
                editable={as === 'reviewer'}
                onChange={(id, a) => {
                  setAnswers({ ...answers, [id]: a });
                }}
                subject="the subject"
              />
            )}
          </CardContent>
        </Card>
      </div>
      {warnPrivate === null ? null : (
        <Modal
          open
          onClose={() => {
            setWarnPrivate(null);
          }}
          title="Private on a self review?"
          description="A private question is hidden from the subject. On a self review the subject is the writer, so they would answer a question they can never read back."
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  const q = def.sections
                    .flatMap((s) => s.questions)
                    .find((x) => x.id === warnPrivate);
                  if (q !== undefined) setQuestion(q.id, { ...q, private: false });
                  setWarnPrivate(null);
                }}
              >
                Keep it shared
              </Button>
              <Button
                onClick={() => {
                  setWarnPrivate(null);
                }}
              >
                Make it private
              </Button>
            </>
          }
        >
          <p className="text-sm">Managers, HR and calibrators still see the answer.</p>
        </Modal>
      )}
      {publishing === null ? null : (
        <Modal
          open
          onClose={() => {
            setPublishing(null);
          }}
          title={`Publish v${String(data.draft ?? (data.published ?? 0) + 1)}?`}
          description="A published version never changes. Reviews already started keep the version they started on."
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setPublishing(null);
                }}
              >
                Cancel
              </Button>
              <Button
                loading={act.pending}
                onClick={() => {
                  act.run('PublishPerformanceTemplate', { id: data.id }, () => {
                    setPublishing(null);
                  });
                }}
              >
                Publish
              </Button>
            </>
          }
        >
          <p className="text-sm font-semibold">
            {publishing.move.length === 0
              ? 'No draft or scheduled cycle uses it'
              : `Moves to the new version: ${publishing.move.map((c) => c.name).join(', ')}`}
          </p>
          <p className="text-sm text-fg-muted">
            {publishing.stay.length === 0
              ? 'No launched cycle uses it.'
              : `Keep their version: ${publishing.stay.map((c) => c.name).join(', ')}`}
          </p>
        </Modal>
      )}
    </div>
  );
}

function QuestionEditor({
  question: q,
  onChange,
  onRemove,
  onDone,
  scale,
}: {
  readonly question: Question;
  readonly onChange: (q: Question) => void;
  readonly onRemove: () => void;
  readonly onDone: () => void;
  readonly scale: readonly ScaleOption[];
}): JSX.Element {
  const base = {
    id: q.id,
    prompt: q.prompt,
    help: q.help,
    required: q.required,
    allowComment: q.allowComment,
    private: q.private,
  };
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-sunken p-3">
      <Field required>
        <FieldLabel>Question</FieldLabel>
        <Input
          value={q.prompt}
          onChange={(e) => {
            onChange({ ...q, prompt: e.target.value });
          }}
        />
      </Field>
      <Choose
        label="Type"
        value={q.type}
        options={TYPES}
        onChange={(t) => {
          const fresh = blank(t as Question['type'], scale);
          onChange({ ...fresh, ...base });
        }}
      />
      <Field>
        <FieldLabel>Help text</FieldLabel>
        <Input
          value={q.help ?? ''}
          onChange={(e) => {
            onChange({ ...q, help: e.target.value === '' ? null : e.target.value });
          }}
        />
      </Field>
      {q.type === 'scale' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">{`Options · ${String(q.options.length)} of 2–10`}</p>
          {q.options.map((o, i) => (
            <div
              key={`${String(i)}-${String(o.value)}`}
              className="grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
            >
              <NumberField
                label="Value"
                value={o.value}
                onChange={(v) => {
                  if (v !== null)
                    onChange({
                      ...q,
                      options: q.options.map((x, j) => (j === i ? { ...x, value: v } : x)),
                    });
                }}
              />
              <Field>
                <FieldLabel>Label</FieldLabel>
                <Input
                  value={o.label}
                  onChange={(e) => {
                    onChange({
                      ...q,
                      options: q.options.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    });
                  }}
                />
              </Field>
              <Field>
                <FieldLabel>Description</FieldLabel>
                <Input
                  value={o.description ?? ''}
                  onChange={(e) => {
                    onChange({
                      ...q,
                      options: q.options.map((x, j) =>
                        j === i
                          ? { ...x, description: e.target.value === '' ? null : e.target.value }
                          : x,
                      ),
                    });
                  }}
                />
              </Field>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${o.label}`}
                disabled={q.options.length <= 2}
                startIcon={<icons.close aria-hidden />}
                onClick={() => {
                  onChange({ ...q, options: q.options.filter((_, j) => j !== i) });
                }}
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            disabled={q.options.length >= 10}
            onClick={() => {
              onChange({
                ...q,
                options: [
                  ...q.options,
                  {
                    value: (q.options.at(-1)?.value ?? 0) + 1,
                    label: 'New option',
                    description: null,
                  },
                ],
              });
            }}
          >
            Add option
          </Button>
        </div>
      ) : null}
      {q.type === 'choice' ? (
        <div className="flex flex-col gap-2">
          {q.options.map((o, i) => (
            <div key={o.id} className="flex items-end gap-2">
              <Field className="flex-1">
                <FieldLabel>{`Option ${String(i + 1)}`}</FieldLabel>
                <Input
                  value={o.label}
                  onChange={(e) => {
                    onChange({
                      ...q,
                      options: q.options.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    });
                  }}
                />
              </Field>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${o.label}`}
                disabled={q.options.length <= 2}
                startIcon={<icons.close aria-hidden />}
                onClick={() => {
                  onChange({ ...q, options: q.options.filter((_, j) => j !== i) });
                }}
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onChange({
                ...q,
                options: [...q.options, { id: `o${short()}`, label: 'New option' }],
              });
            }}
          >
            Add option
          </Button>
          <SwitchRow
            label="Several answers"
            checked={q.multiple}
            onChange={(on) => {
              onChange({ ...q, multiple: on });
            }}
          />
        </div>
      ) : null}
      {q.type === 'binary' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel>Yes reads</FieldLabel>
            <Input
              value={q.yes}
              onChange={(e) => {
                onChange({ ...q, yes: e.target.value });
              }}
            />
          </Field>
          <Field>
            <FieldLabel>No reads</FieldLabel>
            <Input
              value={q.no}
              onChange={(e) => {
                onChange({ ...q, no: e.target.value });
              }}
            />
          </Field>
        </div>
      ) : null}
      <SwitchRow
        label="Required"
        checked={q.required}
        onChange={(on) => {
          onChange({ ...q, required: on });
        }}
      />
      <SwitchRow
        label="Allow a comment"
        checked={q.allowComment}
        onChange={(on) => {
          onChange({ ...q, allowComment: on });
        }}
      />
      <SwitchRow
        label="Private"
        hint="Hidden from the subject; managers, HR and calibrators see it"
        checked={q.private}
        onChange={(on) => {
          onChange({ ...q, private: on });
        }}
      />
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="danger" onClick={onRemove}>
          Remove question
        </Button>
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------- preview and history -- */

export interface PreviewData {
  readonly name: string;
  readonly version: number;
  readonly as: string;
  readonly activity: string;
  readonly definition: FormDefinition;
  readonly answers: Answers;
  readonly score: {
    readonly hundredths: number;
    readonly display: string;
    readonly label: string;
    readonly rated: number;
  } | null;
  readonly removed: readonly {
    readonly id: string;
    readonly prompt: string;
    readonly why: string;
  }[];
}

export function Preview(props: ScreenProps<PreviewData>): JSX.Element {
  return (
    <Loaded load={props.load} what="the preview">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={`${data.name} · v${String(data.version)}`}
            description={`As the ${data.as} sees it, on a ${activityLabel(data.activity).toLowerCase()}, with sample answers.`}
          />
          <ChipRow aria-label="Seen by">
            {(['reviewer', 'subject', 'calibrator'] as const).map((a) => (
              <Chip
                key={a}
                selected={data.as === a}
                onClick={() => {
                  props.onFilter?.({ as: a });
                }}
              >
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </Chip>
            ))}
          </ChipRow>
          {data.removed.length === 0 ? null : (
            <Alert
              tone="info"
              title={`${plural(data.removed.length, 'private question')} hidden from the subject`}
            >
              {data.removed.map((r) => r.prompt).join(' · ')}
            </Alert>
          )}
          <FormView definition={data.definition} answers={data.answers} score={data.score} />
        </div>
      )}
    </Loaded>
  );
}

export interface HistoryData {
  readonly name: string;
  readonly changes: readonly {
    readonly version: number;
    readonly state: string;
    readonly by: string;
    readonly at: string;
    readonly changes: readonly {
      readonly kind: string;
      readonly questionId: string;
      readonly prompt: string;
      readonly was: string | null;
    }[];
  }[];
}

export function History(props: ScreenProps<HistoryData>): JSX.Element {
  const act = useAct(props);
  const id = props.params?.['id'] ?? '';
  return (
    <Loaded load={props.load} what="the versions">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={`${data.name} · history`}
            description="Every version, who made it and what changed. A published version is never edited."
          />
          <Refusal error={act.error} />
          <Card>
            <CardContent>
              <Timeline>
                {data.changes.map((v, i) => {
                  const edited = v.changes.filter((c) => c.was !== null);
                  const other = v.changes.filter((c) => c.was === null);
                  return (
                    <TimelineItem
                      key={v.version}
                      title={`v${String(v.version)} · ${v.state === 'draft' ? 'Draft' : v.state === 'published' ? 'Published' : 'Superseded'}`}
                      timestamp={`${v.by} · ${when(v.at)}`}
                      tone={
                        v.state === 'published'
                          ? 'success'
                          : v.state === 'draft'
                            ? 'accent'
                            : 'neutral'
                      }
                      status={v.state === 'draft' ? 'current' : 'past'}
                      last={i === data.changes.length - 1}
                    >
                      <div className="flex flex-col gap-3">
                        {v.changes.length === 0 ? (
                          <p className="text-sm">
                            {v.version === 1 ? 'The first version.' : 'No question changed.'}
                          </p>
                        ) : null}
                        {other.length === 0 ? null : (
                          <ul className="flex flex-col gap-1 text-sm">
                            {other.map((c) => (
                              <li key={`${c.kind}-${c.questionId}`}>
                                {`${c.kind.charAt(0).toUpperCase()}${c.kind.slice(1)}: ${c.prompt}`}
                              </li>
                            ))}
                          </ul>
                        )}
                        {edited.length === 0 ? null : (
                          <ChangeDiff
                            items={edited.map((c) => ({
                              id: c.questionId,
                              label: 'Question',
                              before: c.was,
                              after: c.prompt,
                            }))}
                          />
                        )}
                        <span className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" asChild>
                            <a
                              href={`/performance/templates/${id}/preview?version=${String(v.version)}`}
                            >
                              Preview
                            </a>
                          </Button>
                          {v.state === 'draft' ? null : (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={act.pending}
                              onClick={() => {
                                act.run(
                                  'RestorePerformanceVersion',
                                  { id, input: { version: v.version } },
                                  () => {
                                    props.onNavigate?.(`/performance/templates/${id}`);
                                  },
                                );
                              }}
                            >
                              Restore into a new draft
                            </Button>
                          )}
                        </span>
                      </div>
                    </TimelineItem>
                  );
                })}
              </Timeline>
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}
