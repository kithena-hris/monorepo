import { Alert, Button, Stack } from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import type { Outcome } from '../load';
import { AttributeInput } from './attribute-input';
import { isMissing, type AttributeValue, type RecordSection, type Values } from './model';

/**
 * One section of a record, as a form that saves on its own.
 *
 * Saving one section never waits on another (§8.3): a person who stops half
 * way has everything they saved, and each save is its own `profile_updated`.
 * Only what changed is sent, so a save cannot overwrite a value somebody else
 * wrote since this form was opened.
 */
export function SectionForm({
  section,
  values,
  onSave,
  submitLabel = 'Save',
  footer,
}: {
  readonly section: RecordSection;
  readonly values: Values;
  readonly onSave: (sectionKey: string, changed: Values) => Promise<Outcome>;
  readonly submitLabel?: string;
  /** Beside the save button: a skip, a note. */
  readonly footer?: ReactNode;
}): JSX.Element {
  const [draft, setDraft] = useState<Values>(values);
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const writable = section.fields.filter((f) => !f.readOnly);

  const save = async (): Promise<void> => {
    const missing = Object.fromEntries(
      writable
        .filter((f) => f.required && isMissing(draft[f.key]))
        .map((f) => [f.key, `${f.label} is required.`]),
    );
    setProblems(missing);
    if (Object.keys(missing).length > 0) return;

    const changed = Object.fromEntries(
      writable
        .filter(
          (f) => JSON.stringify(draft[f.key] ?? null) !== JSON.stringify(values[f.key] ?? null),
        )
        .map((f) => [f.key, draft[f.key] ?? null]),
    );
    setSaving(true);
    setRefused(null);
    const outcome = await onSave(section.key, changed);
    setSaving(false);
    if (!outcome.ok) setRefused(outcome.message);
  };

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
          <AttributeInput
            key={field.key}
            field={field}
            value={draft[field.key] ?? null}
            problem={problems[field.key]}
            onChange={(value: AttributeValue) => {
              setDraft((d) => ({ ...d, [field.key]: value }));
            }}
          />
        ))}
        {refused === null ? null : (
          <Alert tone="danger" title="Not saved">
            {refused}
          </Alert>
        )}
        {/* Sticky above the safe-area inset (§17.2): on a phone, "Save" is
            never below the keyboard or behind a scroll. */}
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 bg-surface pt-3 pb-[calc(0.75rem+var(--spacing-safe-bottom))]">
          <Button type="submit" variant="primary" loading={saving} loadingLabel="Saving">
            {submitLabel}
          </Button>
          {footer}
        </div>
      </Stack>
    </form>
  );
}
