import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Chip,
  ChipRow,
  Field,
  FieldControl,
  FieldLabel,
  NumberField,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  RadioCard,
  RadioGroup,
  RadioGroupItem,
  RichTextEditor,
  SegmentedControl,
  SegmentedControlItem,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import type {
  Answer,
  AnswerValue,
  Answers,
  FormDefinition,
  Question,
  ScaleOption,
  Score,
  Suggestion,
} from './types';
import { t as tr } from './i18n';

/**
 * The form, drawn from its definition (PRD §11, Reach additions §28 composed
 * here from Reach's parts): the six question types, written or read, with
 * required and private marked, comments, AI suggestions marked until a
 * person confirms each, and the performance score Kithena computes.
 *
 * Read-only text is drawn as plain paragraphs from the stored rich text, so
 * markup a writer sent never reaches another reader's page as markup.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
};

/**
 * Rich text as lines of plain text, in one pass (form-kit's `plainLines`,
 * copied: a remote imports no package of Kithena's): a tag is skipped whole,
 * an entity decoded once, and an unclosed tag ends the text.
 */
export function paragraphs(html: string): string[] {
  const lines: string[] = [];
  let line = '';
  let i = 0;
  while (i < html.length) {
    const c = html.charAt(i);
    if (c === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) break;
      const tag = html
        .slice(i + 1, end)
        .trim()
        .toLowerCase();
      if (/^(\/(p|li|h[1-6])|br)\b/u.test(tag)) {
        lines.push(line);
        line = '';
      }
      i = end + 1;
    } else if (c === '&') {
      const end = html.indexOf(';', i);
      const decoded = end === -1 || end - i > 8 ? undefined : ENTITIES[html.slice(i + 1, end)];
      line += decoded ?? c;
      i = decoded === undefined ? i + 1 : end + 1;
    } else {
      line += c;
      i += 1;
    }
  }
  lines.push(line);
  return lines.map((l) => l.trim()).filter((l) => l !== '');
}

export function Paragraphs({
  html,
  muted,
}: {
  readonly html: string;
  readonly muted?: boolean;
}): JSX.Element {
  const lines = paragraphs(html);
  return (
    <div className={`flex flex-col gap-1.5 ${muted === true ? 'text-fg-muted' : ''}`}>
      {lines.length === 0 ? (
        <p className="text-fg-muted">{tr('form-view.no_answer', 'No answer')}</p>
      ) : (
        lines.map((l, i) => <p key={`${String(i)}-${l.slice(0, 12)}`}>{l}</p>)
      )}
    </div>
  );
}

const optionLabel = (
  q: Question,
  value: AnswerValue | undefined,
  scale: readonly ScaleOption[],
): string => {
  if (value === null || value === undefined) return '—';
  const list = typeof value === 'object' ? value : null;
  const text = list === null ? String(value) : list.join(', ');
  if (q.type === 'scale') return q.options.find((o) => o.value === value)?.label ?? text;
  if (q.type === 'goals') return scale.find((o) => o.value === value)?.label ?? text;
  if (q.type === 'binary') return value === true ? q.yes : q.no;
  if (q.type === 'choice')
    return (list ?? [text]).map((v) => q.options.find((o) => o.id === v)?.label ?? v).join(', ');
  return text;
};

export interface FormViewProps {
  readonly definition: FormDefinition;
  readonly answers: Answers;
  /** The company's scale, for goal ratings. */
  readonly scale?: readonly ScaleOption[];
  readonly editable?: boolean;
  readonly onChange?: (questionId: string, answer: Answer) => void;
  readonly suggestions?: Readonly<Record<string, Suggestion>>;
  readonly drafted?: readonly string[];
  readonly onConfirm?: (questionId: string) => void;
  readonly score?: Score | null;
  /** The subject's first name, for "Private: hidden from Adam". */
  readonly subject?: string;
  readonly missing?: readonly string[];
  /** One section at a time on a phone (design PFM3): the index shown, else all. */
  readonly only?: number;
  /** Anything to say under a question's answer: how a sentence in it will read. */
  readonly below?: (questionId: string) => ReactNode;
  /** A text answer said again in the tones chosen, its links and formatting kept. */
  readonly onRephrase?: (
    questionId: string,
    html: string,
    tones: readonly string[],
  ) => Promise<{ ok: true; html: string } | { ok: false; message: string }>;
}

/** The tones an answer can be rephrased in, several at once (the server's `REPHRASE_TONES`). */
const TONES = [
  ['clearer', tr('form-view.clearer', 'Clearer')],
  ['concise', tr('form-view.more_concise', 'More concise')],
  ['specific', tr('form-view.more_specific', 'More specific')],
  ['warmer', tr('form-view.warmer', 'Warmer')],
  ['direct', tr('form-view.more_direct', 'More direct')],
  ['formal', tr('form-view.more_formal', 'More formal')],
  ['constructive', tr('form-view.more_constructive', 'More constructive')],
  ['confident', tr('form-view.more_confident', 'More confident')],
] as const;

/**
 * Rephrase, at the end of a text answer's toolbar: choose one tone or several,
 * see the answer said again (links and formatting as they were), then use it,
 * try again, or leave the answer as it is. Nothing changes until Use this.
 */
function Rephrase({
  html,
  onRephrase,
  onUse,
}: {
  readonly html: string;
  readonly onRephrase: (
    html: string,
    tones: readonly string[],
  ) => Promise<{ ok: true; html: string } | { ok: false; message: string }>;
  readonly onUse: (html: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [tones, setTones] = useState<readonly string[]>(['clearer']);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const empty = paragraphs(html).length === 0;
  const run = (): void => {
    setBusy(true);
    setError(null);
    void onRephrase(html, tones).then((r) => {
      setBusy(false);
      if (r.ok) setResult(r.html);
      else setError(r.message);
    });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setResult(null);
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          startIcon={<icons.assistant aria-hidden />}
          disabled={empty}
          {...(empty
            ? {
                title: tr(
                  'form-view.write_something_to_rephrase_first',
                  'Write something to rephrase first',
                ),
              }
            : {})}
        >
          {tr('form-view.rephrase', 'Rephrase')}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={tr('form-view.rephrase', 'Rephrase')}
        className="flex w-[26rem] flex-col gap-3"
      >
        <div>
          <p className="text-sm font-semibold">
            {tr('form-view.rephrase_this_answer', 'Rephrase this answer')}
          </p>
          <p className="text-xs text-fg-muted">
            {tr(
              'form-view.choose_one_or_more_tones_the',
              'Choose one or more tones. The meaning, links, lists and formatting stay.',
            )}
          </p>
        </div>
        <ChipRow aria-label={tr('form-view.tones', 'Tones')}>
          {TONES.map(([v, l]) => (
            <Chip
              key={v}
              selected={tones.includes(v)}
              onClick={() => {
                setTones((t) => (t.includes(v) ? t.filter((x) => x !== v) : [...t, v]));
              }}
            >
              {l}
            </Chip>
          ))}
        </ChipRow>
        {result === null ? null : (
          <div className="max-h-64 overflow-y-auto">
            <RichTextEditor
              aria-label={tr('form-view.rephrased_answer', 'Rephrased answer')}
              readOnly
              value={result}
              toolbar={[]}
            />
          </div>
        )}
        {error === null ? null : <Alert tone="danger" title={error} />}
        <div className="flex justify-end gap-2">
          {result === null ? (
            <Button size="sm" loading={busy} disabled={tones.length === 0} onClick={run}>
              {tr('form-view.rephrase', 'Rephrase')}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                disabled={tones.length === 0}
                onClick={run}
              >
                {tr('form-view.try_again', 'Try again')}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onUse(result);
                  setOpen(false);
                  setResult(null);
                }}
              >
                {tr('form-view.use_this', 'Use this')}
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FormView(props: FormViewProps): JSX.Element {
  const sections =
    props.only === undefined
      ? props.definition.sections
      : props.definition.sections.slice(props.only, props.only + 1);
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s, si) => (
        <Card key={s.id}>
          <CardHeader>
            <CardTitle level={2}>
              {tr('form-view.text', '{{value}} · {{title}}', {
                value: String((props.only ?? 0) + si + 1),
                title: s.title,
              })}
            </CardTitle>
            {s.description === null ? null : (
              <p className="text-sm text-fg-muted">{s.description}</p>
            )}
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-[var(--reach-line)]">
            {s.questions.map((q, qi) => (
              <QuestionBlock
                key={q.id}
                number={`${String((props.only ?? 0) + si + 1)}.${String(qi + 1)}`}
                question={q}
                {...props}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** One question as the person answering sees it; the template builder draws each so. */
export function QuestionBlock({
  number,
  question: q,
  answers,
  editable,
  onChange,
  suggestions,
  drafted,
  onConfirm,
  score,
  subject,
  missing,
  scale = [],
  below,
  onRephrase,
}: FormViewProps & { readonly number: string; readonly question: Question }): JSX.Element {
  const a = answers[q.id];
  const s = suggestions?.[q.id];
  const set = (value: Answer['value']): void => {
    onChange?.(q.id, { value, comment: a?.comment ?? null });
  };
  const write = editable === true && q.type !== 'performance_score';
  let control: ReactNode;
  if (q.type === 'performance_score') {
    // No number until there is one: a bold dash at this size read as a bar.
    control =
      score === null || score === undefined ? (
        <p className="text-sm text-fg-muted">
          {tr(
            'form-view.computed_once_the_rating_questions_are',
            'Computed once the rating questions are answered',
          )}
        </p>
      ) : (
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold tabular-nums">{score.display}</span>
          <span className="text-sm text-fg-muted">
            {tr(
              'form-view.computed_from_rated_answers_by_section',
              '{{label}} · computed from {{rated}} rated answers, by section',
              { label: score.label, rated: String(score.rated) },
            )}
          </span>
        </div>
      );
  } else if (!write) {
    control =
      q.type === 'text' ? (
        <Paragraphs html={typeof a?.value === 'string' ? a.value : ''} />
      ) : (
        <p className="font-medium">{optionLabel(q, a?.value, scale)}</p>
      );
  } else if (q.type === 'text') {
    control = (
      <RichTextEditor
        aria-labelledby={`q-${q.id}`}
        value={typeof a?.value === 'string' ? a.value : ''}
        onChange={(html) => {
          set(html);
        }}
        toolbar={['inline', 'lists']}
        minHeight="5rem"
        showCount
        countUnit="words"
        {...(onRephrase === undefined
          ? {}
          : {
              toolbarEnd: (
                <Rephrase
                  html={typeof a?.value === 'string' ? a.value : ''}
                  onRephrase={(html, tones) => onRephrase(q.id, html, tones)}
                  onUse={(html) => {
                    set(html);
                  }}
                />
              ),
            })}
      />
    );
  } else if (q.type === 'scale' || q.type === 'goals') {
    const options = q.type === 'scale' ? q.options : scale;
    control = (
      <div className="flex flex-col gap-2">
        {q.type === 'goals' && q.progress !== null ? (
          <Progress
            value={q.progress}
            label={tr('form-view.progress', 'Progress {{progress}}%', {
              progress: String(q.progress),
            })}
            showValue
          />
        ) : null}
        {/* Pressing the chosen rating again leaves the question unanswered. */}
        <RadioGroup
          aria-labelledby={`q-${q.id}`}
          className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]"
          deselectable
          value={typeof a?.value === 'number' ? String(a.value) : ''}
          onValueChange={(v) => {
            set(v === '' ? null : Number(v));
          }}
        >
          {options.map((o) => (
            <RadioCard
              key={o.value}
              value={String(o.value)}
              description={o.description ?? undefined}
              badge={
                s !== undefined && !s.confirmed && s.value === o.value ? (
                  <Badge size="sm" tone="accent">
                    {tr('form-view.suggested', 'Suggested')}
                  </Badge>
                ) : undefined
              }
            >
              {/* The label only: the value is what the score is worked out
                  from, not something the person answering needs to read. */}
              {o.label}
            </RadioCard>
          ))}
        </RadioGroup>
      </div>
    );
  } else if (q.type === 'binary') {
    control = (
      <SegmentedControl
        aria-labelledby={`q-${q.id}`}
        deselectable
        value={a?.value === true ? 'yes' : a?.value === false ? 'no' : ''}
        onValueChange={(v) => {
          set(v === '' ? null : v === 'yes');
        }}
      >
        <SegmentedControlItem value="yes">{q.yes}</SegmentedControlItem>
        <SegmentedControlItem value="no">{q.no}</SegmentedControlItem>
      </SegmentedControl>
    );
  } else if (q.type === 'choice' && !q.multiple) {
    const v = a?.value;
    const picked: string =
      typeof v === 'object' && v !== null ? (v[0] ?? '') : typeof v === 'string' ? v : '';
    control = (
      <RadioGroup
        aria-labelledby={`q-${q.id}`}
        deselectable
        value={picked}
        onValueChange={(v) => {
          set(v === '' ? null : [v]);
        }}
      >
        {q.options.map((o) => (
          <RadioGroupItem key={o.id} value={o.id}>
            {o.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
    );
  } else if (q.type === 'choice') {
    const picked = Array.isArray(a?.value) ? (a.value as readonly string[]) : [];
    control = (
      <div className="flex flex-col gap-1.5">
        {q.options.map((o) => (
          <Field key={o.id} orientation="horizontal">
            <FieldControl>
              <Checkbox
                checked={picked.includes(o.id)}
                onCheckedChange={(on) => {
                  set(on === true ? [...picked, o.id] : picked.filter((x) => x !== o.id));
                }}
              />
            </FieldControl>
            <FieldLabel>{o.label}</FieldLabel>
          </Field>
        ))}
      </div>
    );
  } else {
    control = (
      <NumberField
        label={q.prompt}
        value={typeof a?.value === 'number' ? a.value : null}
        onChange={(v) => {
          set(v);
        }}
        {...(q.min === null ? {} : { min: q.min })}
        {...(q.max === null ? {} : { max: q.max })}
        {...(q.unit === null ? {} : { suffix: q.unit })}
      />
    );
  }
  const isMissing = missing?.includes(q.id) === true;
  const required = q.required && q.type !== 'performance_score';
  const isDrafted = drafted?.includes(q.id) === true;
  const marks = required || q.private || isDrafted;
  return (
    <div
      className={`flex flex-col gap-2.5 py-4 first:pt-0 last:pb-0 ${s !== undefined && !s.confirmed ? 'rounded-md bg-accent-subtle/40 px-3' : ''}`}
    >
      {/* The question beside its number, wrapping under itself; its marks on the line below. */}
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-xs text-fg-muted">{number}</span>
        <p id={`q-${q.id}`} className="min-w-0 flex-1 font-semibold">
          {q.prompt}
        </p>
      </div>
      {marks ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* One mark: Required, turned red while it still has no answer. */}
          {required ? (
            isMissing ? (
              <Badge size="sm" tone="danger">
                {tr('form-view.required', 'Required')}
              </Badge>
            ) : (
              <span className="text-xs text-fg-muted">{tr('form-view.required', 'Required')}</span>
            )
          ) : null}
          {q.private ? (
            <Badge size="sm" tone="warning">
              {subject === null || subject === undefined
                ? tr(
                    'form-view.private_hidden_from_the_subject',
                    'Private: hidden from the subject',
                  )
                : tr('form-view.private_hidden_from', 'Private: hidden from {{value}}', {
                    value: subject,
                  })}
            </Badge>
          ) : null}
          {isDrafted ? (
            <Badge size="sm" tone="accent">
              {tr('form-view.drafted_by_ai', 'Drafted by AI')}
            </Badge>
          ) : null}
        </div>
      ) : null}
      {q.help === null ? null : <p className="text-sm text-fg-muted">{q.help}</p>}
      {control}
      {s !== undefined && !s.confirmed ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge size="sm" tone="accent">
            {tr('form-view.suggested_2', 'Suggested: {{optionLabel}}', {
              optionLabel: optionLabel(q, s.value, scale),
            })}
          </Badge>
          <span className="text-accent-fg">
            {tr('form-view.reason', 'Reason: {{reason}}', { reason: s.reason })}
          </span>
          {onConfirm === undefined || editable !== true ? null : (
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                onConfirm(q.id);
              }}
            >
              {tr('form-view.confirm', 'Confirm')}
            </Button>
          )}
        </div>
      ) : null}
      {below?.(q.id)}
      {q.allowComment ? (
        write ? (
          <Textarea
            aria-label={tr('form-view.comment_on', 'Comment on {{prompt}}', { prompt: q.prompt })}
            placeholder={tr('form-view.add_a_comment_optional', 'Add a comment (optional)')}
            autoResize
            value={a?.comment ?? ''}
            onChange={(e) => {
              onChange?.(q.id, {
                value: a?.value ?? null,
                comment: e.target.value === '' ? null : e.target.value,
              });
            }}
          />
        ) : a?.comment === null || a?.comment === undefined ? null : (
          <p className="text-sm text-fg-muted">
            {tr('form-view.comment', 'Comment: {{comment}}', { comment: a.comment })}
          </p>
        )
      ) : null}
    </div>
  );
}
