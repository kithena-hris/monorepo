import { Alert, Button, Stack } from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import type { Checked, IdentifierFinding, Outcome } from '../load';
import { AttributeInput } from './attribute-input';
import {
  isMissing,
  type AttributeValue,
  type PendingValue,
  type RecordSection,
  type Values,
} from './model';
import { PendingNote } from './pending';

/**
 * One section of a record, as a form that saves on its own.
 *
 * Saving one section never waits on another (§8.3): a person who stops half
 * way has everything they saved, and each save is its own `profile_updated`.
 * Only what changed is sent, so a save cannot overwrite a value somebody else
 * wrote since this form was opened.
 *
 * **A doubtful national identifier is warned about, never refused**
 * (PEO-125). Before saving one, the form asks People what its checks find;
 * if they doubt it, the warning is shown on the field and above the button,
 * and the next press saves it anyway — to HR's review.
 */
export function SectionForm({
  section,
  values,
  onSave,
  onCheck,
  submitLabel = 'Save',
  footer,
  pending = [],
  onWithdraw,
  onSelfApprove,
}: {
  readonly section: RecordSection;
  readonly values: Values;
  readonly onSave: (sectionKey: string, changed: Values) => Promise<Outcome>;
  /** Ask what the checks would find before saving an identifier. Absent: save straight away. */
  readonly onCheck?: (sectionKey: string, changed: Values) => Promise<Checked>;
  readonly submitLabel?: string;
  /** Beside the save button: a skip, a note. */
  readonly footer?: ReactNode;
  /** Values waiting for HR's approval, shown under their fields (PEO-077). */
  readonly pending?: readonly PendingValue[];
  readonly onWithdraw?: (changeId: string) => Promise<Outcome>;
  /** The only HR member approving their own held change, once they confirm (PEO-077). */
  readonly onSelfApprove?: (changeId: string) => Promise<Outcome>;
}): JSX.Element {
  const [draft, setDraft] = useState<Values>(values);
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  /** The identifiers warned about, and the values they were warned about for. */
  const [warned, setWarned] = useState<{
    readonly values: string;
    readonly findings: readonly IdentifierFinding[];
  } | null>(null);
  /** After a save: what went to HR's review. */
  const [reviewed, setReviewed] = useState<readonly IdentifierFinding[]>([]);
  /** After a save: the fields sent for approval rather than saved (PEO-077). */
  const [held, setHeld] = useState<readonly string[]>([]);

  const writable = section.fields.filter((f) => !f.readOnly);
  const identifiers = new Set(
    writable.filter((f) => f.dataType === 'national_id').map((f) => f.key),
  );

  const changedValues = (): Values =>
    Object.fromEntries(
      writable
        .filter(
          (f) => JSON.stringify(draft[f.key] ?? null) !== JSON.stringify(values[f.key] ?? null),
        )
        .map((f) => [f.key, draft[f.key] ?? null]),
    );
  const identifierValues = (changed: Values): Values =>
    Object.fromEntries(
      Object.entries(changed).filter(([key, v]) => identifiers.has(key) && typeof v === 'string'),
    );
  // Still the values the warning was about: the next press saves them anyway.
  const stillWarned =
    warned !== null && warned.values === JSON.stringify(identifierValues(changedValues()));

  const save = async (): Promise<void> => {
    const missing = Object.fromEntries(
      writable
        .filter((f) => f.required && isMissing(draft[f.key]))
        .map((f) => [f.key, `${f.label} is required.`]),
    );
    setProblems(missing);
    if (Object.keys(missing).length > 0) return;

    const changed = changedValues();
    const asked = identifierValues(changed);
    setSaving(true);
    setRefused(null);
    setReviewed([]);
    setHeld([]);

    if (onCheck !== undefined && Object.keys(asked).length > 0 && !stillWarned) {
      const checked = await onCheck(section.key, asked);
      if (!checked.ok) {
        setSaving(false);
        setRefused(checked.message);
        return;
      }
      // A value HR already accepted is final: nothing to warn about.
      const doubted = checked.findings.filter((f) => f.review !== 'accepted');
      if (doubted.length > 0) {
        setSaving(false);
        setWarned({ values: JSON.stringify(asked), findings: doubted });
        return;
      }
    }

    const outcome = await onSave(section.key, changed);
    setSaving(false);
    if (!outcome.ok) {
      setRefused(outcome.message);
      return;
    }
    setWarned(null);
    setReviewed((outcome.findings ?? []).filter((f) => f.review === 'pending'));
    setHeld(outcome.held ?? []);
  };

  const shown = stillWarned ? warned.findings : [];
  const warningFor = (key: string): string | undefined => {
    const messages = shown.filter((f) => f.key === key).map((f) => f.message);
    return messages.length === 0 ? undefined : `Our checks suggest this may be wrong: ${messages.join(' ')}`;
  };
  const labels = [...new Set(shown.map((f) => f.label))];

  return (
    <form
      noValidate
      aria-label={section.label}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Stack gap={4}>
        {section.fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <AttributeInput
              field={field}
              value={draft[field.key] ?? null}
              problem={problems[field.key]}
              warning={warningFor(field.key)}
              onChange={(value: AttributeValue) => {
                setDraft((d) => ({ ...d, [field.key]: value }));
              }}
            />
            {pending
              .filter((p) => p.key === field.key)
              .map((p) => (
                <PendingNote
                  key={p.id}
                  field={field}
                  pending={p}
                  onWithdraw={onWithdraw}
                  onSelfApprove={onSelfApprove}
                />
              ))}
          </div>
        ))}
        {shown.length === 0 ? null : (
          <Alert tone="warning" title="Our checks suggest this may be wrong">
            Please look again at {labels.join(' and ')}. If it is right as it is, save anyway: HR
            will review it, and what they decide is final.
          </Alert>
        )}
        {reviewed.length === 0 ? null : (
          <Alert tone="info" title="Saved, and sent to HR for review">
            Our checks doubted {[...new Set(reviewed.map((f) => f.label))].join(' and ')}. HR will
            look at it; you will see here if they ask you to correct it.
          </Alert>
        )}
        {held.length === 0 ? null : (
          <Alert tone="info" title="Sent to HR for approval">
            {held.join(' and ')} {held.length === 1 ? 'is' : 'are'} not changed until HR approves;
            until then the record keeps what it had. You can withdraw the change while it waits.
          </Alert>
        )}
        {refused === null ? null : (
          <Alert tone="danger" title="Not saved">
            {refused}
          </Alert>
        )}
        {/* Sticky above the safe-area inset (§17.2): on a phone, "Save" is
            never below the keyboard or behind a scroll. */}
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 bg-surface pt-3 pb-[calc(0.75rem+var(--spacing-safe-bottom))]">
          <Button type="submit" variant="primary" loading={saving} loadingLabel="Saving">
            {shown.length > 0 ? 'Save anyway' : submitLabel}
          </Button>
          {footer}
        </div>
      </Stack>
    </form>
  );
}
