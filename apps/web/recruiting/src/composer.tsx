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

/**
 * The email behind a status change (PRD §12.7): rejecting, moving on,
 * confirming an interview, sending an offer. It opens filled in from the
 * company's template for that purpose, or the built-in words, so the
 * recruiter edits sentences, not variables; a placeholder can still be
 * dropped in from the menu and is filled at the send. For many candidates
 * at once the placeholders stay, since each gets their own name.
 */

export type EmailPurpose = 'rejection' | 'selection' | 'interview_confirmation' | 'offer';

export const PURPOSE_LABEL: Readonly<Record<EmailPurpose, string>> = {
  rejection: 'Application not taken forward',
  selection: 'Moving to the next step',
  interview_confirmation: 'Interview confirmed',
  offer: 'Offer sent',
};

/** Every placeholder, as Recruiting fills it (`emails.ts`). */
export const PLACEHOLDERS = [
  { key: 'candidate', label: 'Candidate’s full name' },
  { key: 'first_name', label: 'Candidate’s first name' },
  { key: 'job', label: 'Job title' },
  { key: 'company', label: 'Company name' },
  { key: 'stage', label: 'Current stage' },
  { key: 'interview', label: 'Next interview, date and time' },
  { key: 'where', label: 'Where the interview is' },
  { key: 'sender', label: 'Your name' },
  { key: 'link', label: 'The candidate’s page' },
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
          Insert placeholder
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Filled in when the email is sent</DropdownMenuLabel>
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
          <FieldLabel>Subject</FieldLabel>
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
          <FieldLabel>Message</FieldLabel>
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
          Plain text. A placeholder such as {'{{first_name}}'} is filled in for each candidate when
          the email goes; {'{{link}}'} becomes their own page.
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
      <Field orientation="horizontal">
        <span className="flex min-w-0 flex-col">
          <FieldLabel>Email the candidate</FieldLabel>
          <FieldDescription>
            {enabled
              ? `${PURPOSE_LABEL[purpose]}: read it, change what you like, and it goes with the decision.`
              : 'No email goes with this.'}
          </FieldDescription>
        </span>
        <FieldControl>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        </FieldControl>
      </Field>
      {!enabled ? null : (
        <>
          {mine.length + others.length === 0 ? null : (
            <Field>
              <FieldLabel>Start from</FieldLabel>
              <Select value={templateId} onValueChange={setTemplateId}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {mine.length === 0 ? (
                    <SelectItem value="default">{`${PURPOSE_LABEL[purpose]} (built in)`}</SelectItem>
                  ) : null}
                  {mine.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                  {others.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {`${t.name} (${t.purpose.replaceAll('_', ' ')})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {value === null ? (
            <p className="text-sm text-fg-muted">{loading ? 'Filling it in…' : ''}</p>
          ) : (
            <EmailFields value={value} onChange={onChange} disabled={loading} />
          )}
          {many ? (
            <Badge size="sm" tone="info">
              Each candidate gets their own name and link
            </Badge>
          ) : null}
        </>
      )}
    </div>
  );
}
