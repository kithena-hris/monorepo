import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  icons,
} from '@reach/ui';
import { useEffect, useRef, useState, type JSX } from 'react';

import type { useAct } from './shared';
import { t as tr } from './i18n';

/**
 * The email behind a status change (PRD §12.7): rejecting, moving on,
 * confirming an interview, sending an offer. It opens filled in from the
 * company's template for that purpose, or the built-in words, so the
 * recruiter edits sentences, not variables; a placeholder can still be
 * dropped in from the menu and is filled at the send. For many candidates
 * at once the placeholders stay, since each gets their own name.
 */

export type EmailPurpose =
  'rejection' | 'selection' | 'interview_confirmation' | 'offer' | 'stage_expectations';

export const PURPOSE_LABEL: Readonly<Record<EmailPurpose, string>> = {
  rejection: tr('composer.application_not_taken_forward', 'Application not taken forward'),
  selection: tr('composer.moving_to_the_next_step', 'Moving to the next step'),
  interview_confirmation: tr('composer.interview_confirmed', 'Interview confirmed'),
  offer: tr('composer.offer_sent', 'Offer sent'),
  stage_expectations: tr('composer.what_to_expect_at_this_stage', 'What to expect at this stage'),
};

/** Every placeholder, as Recruiting fills it (`emails.ts`). */
export const PLACEHOLDERS = [
  { key: 'candidate', label: tr('composer.candidates_full_name', 'Candidate’s full name') },
  { key: 'first_name', label: tr('composer.candidates_first_name', 'Candidate’s first name') },
  { key: 'job', label: tr('composer.job_title', 'Job title') },
  { key: 'company', label: tr('composer.company_name', 'Company name') },
  { key: 'stage', label: tr('composer.current_stage', 'Current stage') },
  {
    key: 'expectations',
    label: tr('composer.what_happens_at_the_current_stage', 'What happens at the current stage'),
  },
  {
    key: 'interview',
    label: tr('composer.next_interview_date_and_time', 'Next interview, date and time'),
  },
  { key: 'where', label: tr('composer.where_the_interview_is', 'Where the interview is') },
  { key: 'sender', label: tr('composer.your_name', 'Your name') },
  { key: 'link', label: tr('composer.the_candidates_page', 'The candidate’s page') },
] as const;

export interface ComposedEmail {
  readonly subject: string;
  readonly body: string;
}

/** A menu that drops a placeholder where the caret is in the field it is given. */
export function InsertPlaceholder({
  target,
  onInsert,
}: {
  readonly target: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  readonly onInsert: (next: string) => void;
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" startIcon={<icons.add aria-hidden />}>
          {tr('composer.insert_placeholder', 'Insert placeholder')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>
          {tr('composer.filled_in_when_the_email_is', 'Filled in when the email is sent')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PLACEHOLDERS.map((p) => (
          <DropdownMenuItem
            key={p.key}
            onSelect={() => {
              const field = target.current;
              const token = `{{${p.key}}}`;
              if (field === null) {
                onInsert(token);
                return;
              }
              const start = field.selectionStart ?? field.value.length;
              const end = field.selectionEnd ?? start;
              const next = `${field.value.slice(0, start)}${token}${field.value.slice(end)}`;
              onInsert(next);
              requestAnimationFrame(() => {
                field.focus();
                field.setSelectionRange(start + token.length, start + token.length);
              });
            }}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-mono text-xs text-fg-muted">{`{{${p.key}}}`}</span>
              <span>{p.label}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Subject and body, each with its placeholder menu: the heart of the template editor and the composer. */
export function EmailFields({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: ComposedEmail;
  readonly onChange: (next: ComposedEmail) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <Field required>
        <span className="flex items-center justify-between gap-2">
          <FieldLabel>{tr('composer.subject', 'Subject')}</FieldLabel>
          <InsertPlaceholder
            target={subjectRef}
            onInsert={(subject) => {
              onChange({ ...value, subject });
            }}
          />
        </span>
        <FieldControl>
          <Input
            ref={subjectRef}
            value={value.subject}
            disabled={disabled}
            onChange={(e) => {
              onChange({ ...value, subject: e.target.value });
            }}
          />
        </FieldControl>
      </Field>
      <Field required>
        <span className="flex items-center justify-between gap-2">
          <FieldLabel>{tr('composer.message', 'Message')}</FieldLabel>
          <InsertPlaceholder
            target={bodyRef}
            onInsert={(body) => {
              onChange({ ...value, body });
            }}
          />
        </span>
        <FieldControl>
          <Textarea
            ref={bodyRef}
            autoResize
            rows={8}
            value={value.body}
            disabled={disabled}
            onChange={(e) => {
              onChange({ ...value, body: e.target.value });
            }}
          />
        </FieldControl>
        <FieldDescription>
          {tr(
            'composer.plain_text_a_placeholder_such_as',
            'Plain text. A placeholder such as {{first_name}} is filled in for each candidate when the email goes; {{link}} becomes their own page.',
          )}
        </FieldDescription>
      </Field>
    </>
  );
}

/**
 * The composer: a switch for whether an email goes at all, the template it
 * starts from, and the words, opened filled in for the candidate.
 */
export function EmailComposer({
  applicationId,
  purpose,
  templates,
  act,
  enabled,
  onEnabledChange,
  value,
  onChange,
  many = false,
  optional = true,
}: {
  /** The application the preview is filled from; the first of many. */
  readonly applicationId: string | undefined;
  readonly purpose: EmailPurpose;
  readonly templates: readonly {
    readonly id: string;
    readonly name: string;
    readonly purpose: string;
  }[];
  readonly act: ReturnType<typeof useAct>;
  readonly enabled: boolean;
  readonly onEnabledChange: (on: boolean) => void;
  readonly value: ComposedEmail | null;
  readonly onChange: (next: ComposedEmail | null) => void;
  /** Several candidates: the placeholders stay and are filled per person. */
  readonly many?: boolean;
  /** False where the email is the whole point: no switch to turn it off. */
  readonly optional?: boolean;
}): JSX.Element {
  const mine = templates.filter((t) => t.purpose === purpose);
  const others = templates.filter((t) => t.purpose !== purpose);
  const [templateId, setTemplateId] = useState<string>(mine[0]?.id ?? 'default');
  const [loading, setLoading] = useState(false);
  const { run } = act;
  // Opened, or the template changed: the words come from Recruiting, filled in.
  useEffect(() => {
    if (!enabled || applicationId === undefined) return;
    setLoading(true);
    run(
      'PreviewEmail',
      {
        applicationId,
        input: { purpose, templateId: templateId === 'default' ? null : templateId, fill: !many },
      },
      (drafted) => {
        const d = drafted as ComposedEmail;
        onChange({ subject: d.subject, body: d.body });
        setLoading(false);
      },
    );
  }, [enabled, applicationId, purpose, templateId, many]);
  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-[var(--reach-fill)] p-4">
      {optional ? (
        <Field orientation="horizontal">
          <span className="flex min-w-0 flex-col">
            <FieldLabel>{tr('composer.email_the_candidate', 'Email the candidate')}</FieldLabel>
            <FieldDescription>
              {enabled
                ? tr(
                    'composer.read_it_change_what_you_like',
                    '{{PURPOSE_LABEL}}: read it, change what you like, and it goes with the decision.',
                    { PURPOSE_LABEL: PURPOSE_LABEL[purpose] },
                  )
                : tr('composer.no_email_goes_with_this', 'No email goes with this.')}
            </FieldDescription>
          </span>
          <FieldControl>
            <Switch checked={enabled} onCheckedChange={onEnabledChange} />
          </FieldControl>
        </Field>
      ) : null}
      {!enabled ? null : (
        <>
          {mine.length + others.length === 0 ? null : (
            <Field>
              <FieldLabel>{tr('composer.start_from', 'Start from')}</FieldLabel>
              <Select value={templateId} onValueChange={setTemplateId}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {mine.length === 0 ? (
                    <SelectItem value="default">
                      {tr('composer.built_in', '{{PURPOSE_LABEL}} (built in)', {
                        PURPOSE_LABEL: PURPOSE_LABEL[purpose],
                      })}
                    </SelectItem>
                  ) : null}
                  {mine.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                  {others.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {tr('composer.text', '{{name}} ({{replaceAll}})', {
                        name: t.name,
                        replaceAll: t.purpose.replaceAll('_', ' '),
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {value === null ? (
            <p className="text-sm text-fg-muted">
              {loading ? tr('composer.filling_it_in', 'Filling it in…') : ''}
            </p>
          ) : (
            <EmailFields value={value} onChange={onChange} disabled={loading} />
          )}
          {many ? (
            <Badge size="sm" tone="info">
              {tr(
                'composer.each_candidate_gets_their_own_name',
                'Each candidate gets their own name and link',
              )}
            </Badge>
          ) : null}
        </>
      )}
    </div>
  );
}
