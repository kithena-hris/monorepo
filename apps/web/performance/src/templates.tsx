import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
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
  ModalPage,
  ModalPageBody,
  ModalPageContent,
  ModalPageHeader,
  Tooltip,
  ChangeDiff,
  icons,
  Separator,
  cn,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { FormView, QuestionBlock } from './form-view';
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
import type {
  Answers,
  FormDefinition,
  Question,
  ScaleOption,
  Score,
  ScreenProps,
  Section,
} from './types';
import { t as tr } from './i18n';

/**
 * Form templates (PRD §11, design PF2–PF3 v2): the list with its filters, the
 * builder in two panes (sections and questions on the left, the form as it
 * reads on the right), publishing with what it moves, versions, and the AI
 * that writes, checks and translates a form for a person to accept.
 */

const ACTIVITIES = ['self', 'manager', 'peer', 'upward', 'goals', 'feedback'] as const;
const activityLabel = (a: string): string =>
  a === 'feedback' ? tr('templates.feedback', 'Feedback') : kindLabel(a);

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
  ['', tr('templates.all', 'All')],
  ['scored', tr('templates.has_a_performance_score', 'Has a performance score')],
  ['feedback', tr('templates.usable_for_feedback', 'Usable for feedback')],
  ['archived', tr('templates.archived', 'Archived')],
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
              title={tr('templates.form_templates', 'Form templates')}
              description={tr(
                'templates.the_forms_every_review_and_feedback',
                'The forms every review and feedback request is written on. A published version never changes.',
              )}
              actions={
                data.hr ? (
                  <Button
                    startIcon={<icons.add aria-hidden />}
                    onClick={() => {
                      setCreating(true);
                    }}
                  >
                    {tr('templates.new_template', 'New template')}
                  </Button>
                ) : null
              }
            />
            <Refusal error={act.error} />
            <div className="flex flex-wrap items-center gap-3">
              <ChipRow aria-label={tr('templates.show', 'Show')}>
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
                label={tr('templates.search_templates', 'Search templates')}
                placeholder={tr('templates.search_by_name', 'Search by name')}
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
                    title={tr('templates.no_templates_here', 'No templates here')}
                    description={tr(
                      'templates.start_one_from_scratch_or_describe',
                      'Start one from scratch, or describe it and let AI draft it.',
                    )}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr('templates.template', 'Template')}</TableHead>
                        <TableHead>{tr('templates.status', 'Status')}</TableHead>
                        <TableHead>{tr('templates.latest', 'Latest')}</TableHead>
                        <TableHead>{tr('templates.cycles', 'Cycles')}</TableHead>
                        <TableHead>{tr('templates.edited', 'Edited')}</TableHead>
                        <TableHead>
                          <span className="sr-only">{tr('templates.actions', 'Actions')}</span>
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
                                  {tr('templates.performance_score', 'Performance score')}
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
                                ? tr('templates.published', 'Published')
                                : r.state === 'archived'
                                  ? tr('templates.archived', 'Archived')
                                  : r.state === 'draft'
                                    ? tr('templates.draft', 'Draft')
                                    : tr('templates.draft_changes', 'Draft changes')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {tr('templates.text', '{{version}} · {{questions}}', {
                              version: r.version,
                              questions: plural(r.questions, 'question'),
                            })}
                          </TableCell>
                          <TableCell className="text-sm text-fg-muted">
                            {r.inCycles === 0
                              ? tr('templates.none', 'None')
                              : plural(r.inCycles, 'cycle')}
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
                                    aria-label={tr(
                                      'templates.actions_for',
                                      'Actions for {{name}}',
                                      { name: r.name },
                                    )}
                                    startIcon={<icons.more aria-hidden />}
                                  />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      props.onNavigate?.(`/performance/templates/${r.id}`);
                                    }}
                                  >
                                    {tr('templates.edit', 'Edit')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      props.onNavigate?.(`/performance/templates/${r.id}/preview`);
                                    }}
                                  >
                                    {tr('templates.preview', 'Preview')}
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
                                    {tr('templates.duplicate', 'Duplicate')}
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
                                      {tr('templates.unarchive', 'Unarchive')}
                                    </DropdownMenuItem>
                                  ) : r.canDelete ? (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        act.run('DeletePerformanceTemplate', { id: r.id });
                                      }}
                                    >
                                      {tr('templates.delete_template', 'Delete template')}
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        setArchiving(r);
                                      }}
                                    >
                                      {tr('templates.archive', 'Archive')}
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
                title={tr('templates.archive_2', 'Archive {{name}}?', { name: archiving.name })}
                description={tr(
                  'templates.it_leaves_every_picker_cycles_already',
                  'It leaves every picker. Cycles already using it keep their version, and you can unarchive it.',
                )}
                footer={
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setArchiving(null);
                      }}
                    >
                      {tr('templates.cancel', 'Cancel')}
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
                      {tr('templates.archive', 'Archive')}
                    </Button>
                  </>
                }
              >
                {archiving.inCycles > 0 ? (
                  <Alert
                    tone="warning"
                    title={tr('templates.used_by', 'Used by {{inCycles}}', {
                      inCycles: plural(archiving.inCycles, 'cycle'),
                    })}
                  >
                    {tr(
                      'templates.an_automation_that_names_it_will',
                      'An automation that names it will need another form before its next cycle.',
                    )}
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
    how === 'ai'
      ? [
          tr('templates.describe', 'Describe'),
          tr('templates.draft', 'Draft'),
          tr('templates.open_in_builder', 'Open in builder'),
        ]
      : [tr('templates.describe', 'Describe'), tr('templates.open_in_builder', 'Open in builder')];
  const create = (): void => {
    act.run('CreatePerformanceTemplate', { input: { name, purpose, definition: draft } }, (d) => {
      onNavigate?.(`/performance/templates/${(d as { id: string }).id}`);
    });
  };
  return (
    <StepDialog
      open
      onClose={onClose}
      title={tr('templates.new_template', 'New template')}
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
            <FieldLabel>{tr('templates.name', 'Name')}</FieldLabel>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder={tr('templates.manager_review_h2', 'Manager review, H2')}
            />
          </Field>
          <Field>
            <FieldLabel>{tr('templates.used_for', 'Used for')}</FieldLabel>
            <ChipRow aria-label={tr('templates.used_for', 'Used for')}>
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
            aria-label={tr('templates.start_from', 'Start from')}
            value={how}
            onValueChange={(v) => {
              setHow(v === 'ai' ? 'ai' : 'blank');
            }}
          >
            <SegmentedControlItem value="blank">
              {tr('templates.start_blank', 'Start blank')}
            </SegmentedControlItem>
            <SegmentedControlItem value="ai">
              {tr('templates.write_with_ai', 'Write with AI')}
            </SegmentedControlItem>
          </SegmentedControl>
          {how === 'ai' ? (
            <Field>
              <FieldLabel>{tr('templates.describe_the_form', 'Describe the form')}</FieldLabel>
              <Textarea
                autoResize
                value={describe}
                onChange={(e) => {
                  setDescribe(e.target.value);
                }}
                placeholder={tr(
                  'templates.a_half_yearly_manager_review_for',
                  'A half-yearly manager review for engineers: impact, craft, collaboration, and a score.',
                )}
              />
            </Field>
          ) : null}
        </div>
      ) : how === 'ai' && step === 1 ? (
        draft === null ? (
          <p className="text-sm text-fg-muted">
            {act.pending
              ? tr('templates.drafting', 'Drafting…')
              : tr(
                  'templates.drafting_the_form_from_your_description',
                  'Drafting the form from your description.',
                )}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Alert
              tone="info"
              title={tr('templates.a_draft_for_you_to_edit', 'A draft for you to edit')}
            >
              {tr(
                'templates.nothing_is_published_until_you_publish',
                'Nothing is published until you publish it. Every question can be changed in the builder.',
              )}
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
        <p className="text-sm">
          {tr(
            'templates.opens_in_the_builder_as_a',
            '“{{name}}” opens in the builder as a draft.',
            { name },
          )}
        </p>
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
    prompt: tr('templates.new_question', 'New question'),
    help: null,
    required: true,
    allowComment: false,
    private: false,
  };
  if (type === 'scale') return { ...base, type, options: scale };
  if (type === 'binary')
    return { ...base, type, yes: tr('templates.yes', 'Yes'), no: tr('templates.no', 'No') };
  if (type === 'choice')
    return {
      ...base,
      type,
      options: [
        { id: 'a', label: tr('templates.first', 'First') },
        { id: 'b', label: tr('templates.second', 'Second') },
      ],
      multiple: false,
      min: null,
      max: null,
    };
  if (type === 'performance_score')
    return { ...base, type, prompt: tr('templates.performance_score', 'Performance score') };
  return { ...base, type: 'text', guidance: null };
};

const TYPES = [
  ['text', tr('templates.text_2', 'Text')],
  ['scale', tr('templates.scale', 'Scale')],
  ['binary', tr('templates.yes_or_no', 'Yes or no')],
  ['choice', tr('templates.choice', 'Choice')],
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
  const [previewing, setPreviewing] = useState(false);
  const [issues, setIssues] = useState<
    readonly { questionId: string; level: string; title: string }[] | null
  >(null);
  const scored = def.sections.some((s) => s.questions.some((q) => q.type === 'performance_score'));
  // The score a reviewer would see for the answers tried here, as Performance
  // computes it: read again a moment after the form or an answer changes.
  const [score, setScore] = useState<Score | null>(null);
  useEffect(() => {
    if (!scored) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      void act
        .call('ScorePerformanceTemplateSample', { input: { definition: def, answers } })
        .then((d) => {
          if (live && d.ok) setScore((d.data as { score: Score | null }).score);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [scored, def, answers]);
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
        description={`${data.published === null ? tr('templates.not_published_yet', 'Not published yet') : tr('templates.v_published', 'v{{published}} published', { published: String(data.published) })}${data.draft === null ? '' : ` · draft v${String(data.draft)}`}${dirty ? ' · unsaved changes' : ''}`}
        actions={
          data.hr ? (
            <>
              <Tooltip content="Preview the form">
                <Button
                  variant="secondary"
                  aria-label={tr('templates.preview_the_form', 'Preview the form')}
                  startIcon={<icons.visible aria-hidden />}
                  onClick={() => {
                    setPreviewing(true);
                  }}
                />
              </Tooltip>
              <Button variant="secondary" asChild>
                <a href={`/performance/templates/${data.id}/history`}>
                  {tr('templates.history', 'History')}
                </a>
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
                {tr('templates.check_with_ai', 'Check with AI')}
              </Button>
              <Button
                variant="secondary"
                disabled={!dirty}
                loading={act.pending}
                onClick={() => {
                  save();
                }}
              >
                {tr('templates.save_draft', 'Save draft')}
              </Button>
              <Button
                loading={act.pending}
                onClick={() => {
                  if (dirty) save(openPublish);
                  else openPublish();
                }}
              >
                {tr('templates.publish', 'Publish')}
              </Button>
            </>
          ) : null
        }
      />
      <Refusal error={act.error} />
      {removed === null ? null : (
        <Alert
          tone="info"
          title={tr(
            'templates.was_empty_so_it_was_removed',
            '“{{title}}” was empty, so it was removed',
            { title: removed.section.title },
          )}
        >
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
            {tr('templates.undo', 'Undo')}
          </Button>
        </Alert>
      )}
      {issues === null ? null : (
        <Alert
          tone={issues.length === 0 ? 'success' : 'warning'}
          title={
            issues.length === 0
              ? tr('templates.nothing_to_change', 'Nothing to change')
              : tr('templates.from_the_check', '{{length}} from the check', {
                  length: plural(issues.length, 'suggestion'),
                })
          }
        >
          <ul className="flex flex-col gap-1">
            {issues.map((i) => (
              <li key={`${i.questionId}-${i.title}`}>{i.title}</li>
            ))}
          </ul>
        </Alert>
      )}
      {/* One column: each question drawn as the person answering sees it,
          its editor in its place while it has focus. The whole form, as it
          will be answered, is a click away (the preview in the header). */}
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>{tr('templates.template_name', 'Template name')}</FieldLabel>
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
                    aria-label={tr('templates.section_title', 'Section title')}
                    value={s.title}
                    disabled={locked}
                    onChange={(e) => {
                      setSection(si, { title: e.target.value });
                    }}
                  />
                  {locked ? (
                    <p className="text-sm text-fg-muted">
                      {tr(
                        'templates.computed_from_the_rating_answers_on',
                        'Computed from the rating answers on the company’s scale; always last and always required.',
                      )}
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <SortableList
                    label={tr('templates.questions_in', 'Questions in {{value}}', {
                      value: s.title || 'this section',
                    })}
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
                        <div
                          className={
                            // The open editor's own padding, so a question keeps its place as it opens.
                            q.type === 'performance_score'
                              ? 'p-3'
                              : 'cursor-text rounded-md p-3 hover:bg-surface-sunken'
                          }
                          {...(q.type === 'performance_score'
                            ? {}
                            : {
                                // Focus anywhere in the question, by click or
                                // by Tab, and it opens for editing.
                                onFocusCapture: () => {
                                  setSelected(q.id);
                                },
                                onClick: () => {
                                  setSelected(q.id);
                                },
                              })}
                        >
                          <QuestionBlock
                            number={`${String(ordered.indexOf(s) + 1)}.${String(s.questions.indexOf(q) + 1)}`}
                            question={q}
                            definition={def}
                            answers={answers}
                            scale={data.scale}
                            score={score}
                            editable
                            onChange={(id, a) => {
                              setAnswers({ ...answers, [id]: a });
                            }}
                            subject="the subject"
                          />
                        </div>
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
                      {tr('templates.add_question', 'Add question')}
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
                      title: tr('templates.section', 'Section {{value}}', {
                        value: String(def.sections.length + 1),
                      }),
                      description: null,
                      questions: [q],
                    },
                  ],
                });
                setSelected(q.id);
              }}
            >
              {tr('templates.add_section', 'Add section')}
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
                        title: tr('templates.performance_score', 'Performance score'),
                        description: null,
                        questions: [blank('performance_score', data.scale)],
                      },
                    ],
                  });
                }}
              >
                {tr('templates.add_a_performance_score', 'Add a performance score')}
              </Button>
            )}
          </div>
        </div>
      </div>
      <ModalPage open={previewing} onOpenChange={setPreviewing}>
        {/* Wide enough for a five-point scale's labels, the form at the review screen's width (4xl). */}
        <ModalPageContent size="inset">
          <ModalPageHeader
            title={tr('templates.preview_2', 'Preview: {{name}}', { name })}
            description={tr(
              'templates.as_it_will_be_answered_nothing',
              'As it will be answered. Nothing here is saved.',
            )}
            actions={
              <>
                <SegmentedControl
                  size="sm"
                  aria-label={tr('templates.device', 'Device')}
                  value={device}
                  onValueChange={(v) => {
                    setDevice(v === 'phone' ? 'phone' : 'web');
                  }}
                >
                  <SegmentedControlItem value="web">
                    {tr('templates.web', 'Web')}
                  </SegmentedControlItem>
                  <SegmentedControlItem value="phone">
                    {tr('templates.phone', 'Phone')}
                  </SegmentedControlItem>
                </SegmentedControl>
                <SegmentedControl
                  size="sm"
                  aria-label={tr('templates.seen_by', 'Seen by')}
                  value={as}
                  onValueChange={(v) => {
                    setAs(v === 'subject' ? 'subject' : 'reviewer');
                  }}
                >
                  <SegmentedControlItem value="reviewer">
                    {tr('templates.reviewer', 'Reviewer')}
                  </SegmentedControlItem>
                  <SegmentedControlItem value="subject">
                    {tr('templates.subject', 'Subject')}
                  </SegmentedControlItem>
                </SegmentedControl>
              </>
            }
          />
          <ModalPageBody className="px-6 py-8 touch:px-4 touch:py-6">
            <div className={cn('mx-auto w-full', device === 'phone' ? 'max-w-sm' : 'max-w-4xl')}>
              {shown.sections.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  {tr('templates.add_a_question_to_see_the', 'Add a question to see the form.')}
                </p>
              ) : (
                <FormView
                  definition={shown}
                  answers={answers}
                  scale={data.scale}
                  score={score}
                  editable={as === 'reviewer'}
                  onChange={(id, a) => {
                    setAnswers({ ...answers, [id]: a });
                  }}
                  subject="the subject"
                />
              )}
            </div>
          </ModalPageBody>
        </ModalPageContent>
      </ModalPage>
      {warnPrivate === null ? null : (
        <Modal
          open
          onClose={() => {
            setWarnPrivate(null);
          }}
          title={tr('templates.private_on_a_self_review', 'Private on a self review?')}
          description={tr(
            'templates.a_private_question_is_hidden_from',
            'A private question is hidden from the subject. On a self review the subject is the writer, so they would answer a question they can never read back.',
          )}
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
                {tr('templates.keep_it_shared', 'Keep it shared')}
              </Button>
              <Button
                onClick={() => {
                  setWarnPrivate(null);
                }}
              >
                {tr('templates.make_it_private', 'Make it private')}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {tr(
              'templates.managers_hr_and_calibrators_still_see',
              'Managers, HR and calibrators still see the answer.',
            )}
          </p>
        </Modal>
      )}
      {publishing === null ? null : (
        <Modal
          open
          onClose={() => {
            setPublishing(null);
          }}
          title={tr('templates.publish_v', 'Publish v{{value}}?', {
            value: String(data.draft ?? (data.published ?? 0) + 1),
          })}
          description={tr(
            'templates.a_published_version_never_changes_reviews',
            'A published version never changes. Reviews already started keep the version they started on.',
          )}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setPublishing(null);
                }}
              >
                {tr('templates.cancel', 'Cancel')}
              </Button>
              <Button
                loading={act.pending}
                onClick={() => {
                  act.run('PublishPerformanceTemplate', { id: data.id }, () => {
                    setPublishing(null);
                  });
                }}
              >
                {tr('templates.publish', 'Publish')}
              </Button>
            </>
          }
        >
          <p className="text-sm font-semibold">
            {publishing.move.length === 0
              ? tr(
                  'templates.no_draft_or_scheduled_cycle_uses',
                  'No draft or scheduled cycle uses it',
                )
              : tr('templates.moves_to_the_new_version', 'Moves to the new version: {{join}}', {
                  join: publishing.move.map((c) => c.name).join(', '),
                })}
          </p>
          <p className="text-sm text-fg-muted">
            {publishing.stay.length === 0
              ? tr('templates.no_launched_cycle_uses_it', 'No launched cycle uses it.')
              : tr('templates.keep_their_version', 'Keep their version: {{join}}', {
                  join: publishing.stay.map((c) => c.name).join(', '),
                })}
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
    // No fill of its own: the list item frames it, and a sunken fill here is
    // the fields' own, which left every input and select without an edge.
    <div className="flex flex-col gap-3 p-3">
      <Field required>
        <FieldLabel>{tr('templates.question', 'Question')}</FieldLabel>
        <Input
          // Opened by focusing the question, so the focus lands here.
          autoFocus
          value={q.prompt}
          onChange={(e) => {
            onChange({ ...q, prompt: e.target.value });
          }}
        />
      </Field>
      <Choose
        label={tr('templates.type', 'Type')}
        value={q.type}
        options={TYPES}
        onChange={(t) => {
          const fresh = blank(t as Question['type'], scale);
          onChange({ ...fresh, ...base });
        }}
      />
      <Field>
        <FieldLabel>{tr('templates.help_text', 'Help text')}</FieldLabel>
        <Input
          value={q.help ?? ''}
          onChange={(e) => {
            onChange({ ...q, help: e.target.value === '' ? null : e.target.value });
          }}
        />
      </Field>
      {q.type === 'scale' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">
            {tr('templates.options_of_2_10', 'Options · {{length}} of 2–10', {
              length: String(q.options.length),
            })}
          </p>
          {q.options.map((o, i) => (
            <div
              // By position: keyed by its value, the row was rebuilt on every
              // step of the value and lost the focus mid-press.
              key={i}
              className="grid grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
            >
              <NumberField
                label={tr('templates.value', 'Value')}
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
                <FieldLabel>{tr('templates.label', 'Label')}</FieldLabel>
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
                <FieldLabel>{tr('templates.description', 'Description')}</FieldLabel>
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
                aria-label={tr('templates.remove', 'Remove {{label}}', { label: o.label })}
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
                    label: tr('templates.new_option', 'New option'),
                    description: null,
                  },
                ],
              });
            }}
          >
            {tr('templates.add_option', 'Add option')}
          </Button>
        </div>
      ) : null}
      {q.type === 'choice' ? (
        <div className="flex flex-col gap-2">
          {q.options.map((o, i) => (
            <div key={o.id} className="flex items-end gap-2">
              <Field className="flex-1">
                <FieldLabel>
                  {tr('templates.option', 'Option {{value}}', { value: String(i + 1) })}
                </FieldLabel>
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
                aria-label={tr('templates.remove', 'Remove {{label}}', { label: o.label })}
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
                options: [
                  ...q.options,
                  { id: `o${short()}`, label: tr('templates.new_option', 'New option') },
                ],
              });
            }}
          >
            {tr('templates.add_option', 'Add option')}
          </Button>
          <SwitchRow
            label={tr('templates.several_answers', 'Several answers')}
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
            <FieldLabel>{tr('templates.yes_reads', 'Yes reads')}</FieldLabel>
            <Input
              value={q.yes}
              onChange={(e) => {
                onChange({ ...q, yes: e.target.value });
              }}
            />
          </Field>
          <Field>
            <FieldLabel>{tr('templates.no_reads', 'No reads')}</FieldLabel>
            <Input
              value={q.no}
              onChange={(e) => {
                onChange({ ...q, no: e.target.value });
              }}
            />
          </Field>
        </div>
      ) : null}
      <Separator />
      <div className="flex flex-col">
        <p className="text-sm font-semibold">{tr('templates.settings', 'Settings')}</p>
        <SwitchRow
          dense
          label={tr('templates.required', 'Required')}
          checked={q.required}
          onChange={(on) => {
            onChange({ ...q, required: on });
          }}
        />
        <SwitchRow
          dense
          label={tr('templates.allow_a_comment', 'Allow a comment')}
          checked={q.allowComment}
          onChange={(on) => {
            onChange({ ...q, allowComment: on });
          }}
        />
        <SwitchRow
          dense
          label={tr('templates.private', 'Private')}
          hint={tr(
            'templates.hidden_from_the_subject_managers_hr',
            'Hidden from the subject; managers, HR and calibrators see it',
          )}
          checked={q.private}
          onChange={(on) => {
            onChange({ ...q, private: on });
          }}
        />
      </div>
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="danger" onClick={onRemove}>
          {tr('templates.remove_question', 'Remove question')}
        </Button>
        <Button size="sm" onClick={onDone}>
          {tr('templates.done', 'Done')}
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
            title={tr('templates.v', '{{name}} · v{{version}}', {
              name: data.name,
              version: String(data.version),
            })}
            description={tr(
              'templates.as_the_sees_it_on_a',
              'As the {{as}} sees it, on a {{activityLabel}}, with sample answers.',
              { as: data.as, activityLabel: activityLabel(data.activity).toLowerCase() },
            )}
          />
          <ChipRow aria-label={tr('templates.seen_by', 'Seen by')}>
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
              title={tr('templates.hidden_from_the_subject', '{{length}} hidden from the subject', {
                length: plural(
                  data.removed.length,
                  tr('templates.private_question', 'private question'),
                ),
              })}
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
            title={tr('templates.history_2', '{{name}} · history', { name: data.name })}
            description={tr(
              'templates.every_version_who_made_it_and',
              'Every version, who made it and what changed. A published version is never edited.',
            )}
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
                      title={`v${String(v.version)} · ${v.state === 'draft' ? tr('templates.draft', 'Draft') : v.state === 'published' ? tr('templates.published', 'Published') : tr('templates.superseded', 'Superseded')}`}
                      timestamp={tr('templates.text_3', '{{by}} · {{at}}', {
                        by: v.by,
                        at: when(v.at),
                      })}
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
                            {v.version === 1
                              ? tr('templates.the_first_version', 'The first version.')
                              : tr('templates.no_question_changed', 'No question changed.')}
                          </p>
                        ) : null}
                        {other.length === 0 ? null : (
                          <ul className="flex flex-col gap-1 text-sm">
                            {other.map((c) => (
                              <li key={`${c.kind}-${c.questionId}`}>
                                {tr('templates.text_4', '{{charAt}}{{slice}}: {{prompt}}', {
                                  charAt: c.kind.charAt(0).toUpperCase(),
                                  slice: c.kind.slice(1),
                                  prompt: c.prompt,
                                })}
                              </li>
                            ))}
                          </ul>
                        )}
                        {edited.length === 0 ? null : (
                          <ChangeDiff
                            items={edited.map((c) => ({
                              id: c.questionId,
                              label: tr('templates.question', 'Question'),
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
                              {tr('templates.preview', 'Preview')}
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
                              {tr('templates.restore_into_a_new_draft', 'Restore into a new draft')}
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
