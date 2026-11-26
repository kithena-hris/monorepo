'use client';

import { Alert, Button, Spinner, useToast } from '@reach/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { saveOwnFields } from '../app/(app)/people/actions';
import { t } from '../lib/t';
import { FieldInput } from './inbox/detail-people';
import { Actions } from './inbox/pane';
import { gapsQuery } from './home-reads';

/** The form's id: its Save is drawn outside it, in the footer. */
const FORM = 'home-missing';

const filled = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * What their record still needs, as fields to fill in right here (Home's
 * modal): each section's required fields left empty, the controls the Inbox's
 * own checklist draws, and one Save that sends whatever is filled so far.
 * Saving some and coming back for the rest is the point: what was saved
 * leaves the list, what was not stays, and a field People refuses says why
 * under itself and takes the focus.
 *
 * The gaps are a kept read (`home-reads.ts`), asked for ahead by Home's modal,
 * so this opens at once; a save takes what it saved out of them in place.
 */
export function MissingFields({
  personId,
  onSaved,
}: {
  readonly personId: string;
  /** Something was saved: the page behind is out of date. */
  readonly onSaved: () => void;
}): JSX.Element {
  const { toast } = useToast();
  const client = useQueryClient();
  const { data: gaps } = useQuery(gapsQuery(personId));
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  /** Why People refused a field, by its key: said under it. */
  const [refused, setRefused] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  // The first field refused takes the focus, once it is drawn as refused.
  useEffect(() => {
    // Not while the save is still closing: a disabled control takes no focus.
    if (pending) return;
    document.getElementById(FORM)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refused, pending]);

  if (gaps === undefined) {
    return (
      <div className="grid min-h-48 place-items-center">
        <Spinner label={t('components.home-missing.reading_your_record', 'Reading your record')} />
      </div>
    );
  }
  if (!gaps.ok) return <Alert tone="danger" title={gaps.message} />;
  if (gaps.sections.length === 0) {
    return (
      <Alert
        tone="success"
        title={t('components.home-missing.nothing_is_missing', 'Nothing is missing')}
      >
        {t(
          'components.home-missing.every_required_detail_you_can_fill',
          'Every required detail you can fill in is on your record.',
        )}
      </Alert>
    );
  }
  const changed = Object.fromEntries(Object.entries(values).filter(([, v]) => filled(v)));
  const count = Object.keys(changed).length;
  const save = (): void => {
    setError(null);
    start(async () => {
      let answers: Record<string, string | null>;
      try {
        answers = await saveOwnFields(changed);
      } catch {
        setError(t('components.home-missing.not_saved_try_again', 'Not saved. Try again.'));
        return;
      }
      const refused = Object.fromEntries(
        Object.entries(answers).flatMap(([key, why]) => (why === null ? [] : [[key, why]])),
      );
      const done = new Set(Object.keys(answers).filter((key) => answers[key] === null));
      // What was saved leaves the list where it stands: nothing is read again,
      // so the fields still to fill in do not blink.
      client.setQueryData<typeof gaps>(gapsQuery(personId).queryKey, (was) =>
        was?.ok !== true
          ? was
          : {
              ...was,
              sections: was.sections
                .map((s) => ({ ...s, fields: s.fields.filter((f) => !done.has(f.key)) }))
                .filter((s) => s.fields.length > 0),
            },
      );
      setValues((was) => Object.fromEntries(Object.entries(was).filter(([key]) => !done.has(key))));
      setRefused(refused);
      if (done.size === 0) return;
      onSaved();
      toast({
        title: t(
          'components.home-missing.saved_to_your_record',
          {
            one: '{{count}} detail saved to your record',
            other: '{{count}} details saved to your record',
          },
          { count: done.size },
        ),
        tone: 'success',
      });
    });
  };
  return (
    <form
      id={FORM}
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (count > 0) save();
      }}
    >
      {gaps.sections.map((section) => (
        <section key={section.key} aria-label={section.label} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-fg">{section.label}</h3>
          {section.fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={values[field.key]}
              disabled={pending}
              error={refused[field.key]}
              onChange={(v) => {
                setValues((was) => ({ ...was, [field.key]: v }));
                // Changed since it was refused: the reason no longer applies.
                if (field.key in refused) {
                  setRefused(({ [field.key]: _gone, ...rest }) => rest);
                }
              }}
            />
          ))}
        </section>
      ))}
      {error === null ? null : <Alert tone="danger" title={error} />}
      {/* In the footer of what holds it (Home's modal), as a task's actions are. */}
      <Actions
        hint={
          count === 0
            ? t(
                'components.home-missing.fill_in_any_and_save',
                'Fill in any of these and save. The rest can wait.',
              )
            : t(
                'components.home-missing.count_to_save',
                { one: '{{count}} detail to save', other: '{{count}} details to save' },
                { count },
              )
        }
      >
        <Button
          type="submit"
          form={FORM}
          variant="primary"
          loading={pending}
          disabled={count === 0}
        >
          {t('components.home-missing.save', 'Save')}
        </Button>
      </Actions>
    </form>
  );
}
