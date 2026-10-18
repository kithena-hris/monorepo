import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldControl,
  FieldLabel,
  NumberField,
  Progress,
  RadioCard,
  RadioGroup,
  RadioGroupItem,
  RichTextEditor,
  SegmentedControl,
  SegmentedControlItem,
  Textarea,
} from '@reach/ui';
import type { JSX, ReactNode } from 'react';

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
        <p className="text-fg-muted">No answer</p>
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
            <CardTitle level={2}>{`${String((props.only ?? 0) + si + 1)} · ${s.title}`}</CardTitle>
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
}: FormViewProps & { readonly number: string; readonly question: Question }): JSX.Element {
  const a = answers[q.id];
  const s = suggestions?.[q.id];
  const set = (value: Answer['value']): void => {
    onChange?.(q.id, { value, comment: a?.comment ?? null });
  };
  const write = editable === true && q.type !== 'performance_score';
  let control: ReactNode;
  if (q.type === 'performance_score') {
    control = (
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold tabular-nums">
          {score === null || score === undefined ? '—' : score.display}
        </span>
        <span className="text-sm text-fg-muted">
          {score === null || score === undefined
            ? 'Computed once the rating questions are answered'
            : `${score.label} · computed from ${String(score.rated)} rated answers, by section`}
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
      />
    );
  } else if (q.type === 'scale' || q.type === 'goals') {
    const options = q.type === 'scale' ? q.options : scale;
    control = (
      <div className="flex flex-col gap-2">
        {q.type === 'goals' && q.progress !== null ? (
          <Progress value={q.progress} label={`Progress ${String(q.progress)}%`} showValue />
        ) : null}
        <RadioGroup
          aria-labelledby={`q-${q.id}`}
          className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]"
          value={typeof a?.value === 'number' ? String(a.value) : ''}
          onValueChange={(v) => {
            set(Number(v));
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
                    Suggested
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
        value={a?.value === true ? 'yes' : a?.value === false ? 'no' : ''}
        onValueChange={(v) => {
          set(v === 'yes');
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
        value={picked}
        onValueChange={(v) => {
          set([v]);
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
  return (
    <div
      className={`flex flex-col gap-2.5 py-4 first:pt-0 last:pb-0 ${s !== undefined && !s.confirmed ? 'rounded-md bg-accent-subtle/40 px-3' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-fg-muted">{number}</span>
        {/* One mark: Required, turned red while it still has no answer. */}
        {q.required && q.type !== 'performance_score' ? (
          isMissing ? (
            <Badge size="sm" tone="danger">
              Required
            </Badge>
          ) : (
            <span className="text-xs text-fg-muted">Required</span>
          )
        ) : null}
        {q.private ? (
          <Badge size="sm" tone="warning">
            {`Private: hidden from ${subject ?? 'the subject'}`}
          </Badge>
        ) : null}
        {drafted?.includes(q.id) === true ? (
          <Badge size="sm" tone="accent">
            Drafted by AI
          </Badge>
        ) : null}
      </div>
      <p id={`q-${q.id}`} className="font-semibold">
        {q.prompt}
      </p>
      {q.help === null ? null : <p className="text-sm text-fg-muted">{q.help}</p>}
      {control}
      {s !== undefined && !s.confirmed ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge size="sm" tone="accent">{`Suggested: ${optionLabel(q, s.value, scale)}`}</Badge>
          <span className="text-accent-fg">{`Reason: ${s.reason}`}</span>
          {onConfirm === undefined || editable !== true ? null : (
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                onConfirm(q.id);
              }}
            >
              Confirm
            </Button>
          )}
        </div>
      ) : null}
      {below?.(q.id)}
      {q.allowComment ? (
        write ? (
          <Textarea
            aria-label={`Comment on ${q.prompt}`}
            placeholder="Add a comment (optional)"
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
          <p className="text-sm text-fg-muted">{`Comment: ${a.comment}`}</p>
        )
      ) : null}
    </div>
  );
}
