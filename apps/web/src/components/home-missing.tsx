'use client';

import { Alert, Button, Spinner, useToast } from '@reach/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useTransition, type JSX } from 'react';

import { saveOwnSection } from '../app/(app)/people/actions';
import { t } from '../lib/t';
import { FieldInput } from './inbox/detail-people';
import { gapsQuery } from './home-reads';

const filled = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * What their record still needs, as fields to fill in right here (Home's
 * modal): each section's required fields left empty, the controls the Inbox's
 * own checklist draws, and one Save that sends whatever is filled so far.
 * Saving some and coming back for the rest is the point: what was saved
 * leaves the list, what was not stays.
 *
 * The gaps are a kept read (`home-reads.ts`), asked for ahead by Home's modal,
 * so this opens at once; a save asks for them again.
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
  const [pending, start] = useTransition();

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
      const saved = await saveOwnSection('', changed);
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      // What was saved leaves the list: the gaps are read again before the fields clear.
      await client.invalidateQueries({ queryKey: gapsQuery(personId).queryKey });
      setValues({});
      onSaved();
      toast({
        title: t(
          'components.home-missing.saved_to_your_record',
          {
            one: '{{count}} detail saved to your record',
            other: '{{count}} details saved to your record',
          },
          { count },
        ),
        tone: 'success',
      });
    });
  };
  return (
    <form
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
              onChange={(v) => {
                setValues((was) => ({ ...was, [field.key]: v }));
              }}
            />
          ))}
        </section>
      ))}
      {error === null ? null : <Alert tone="danger" title={error} />}
      <div className="sticky bottom-0 -mx-5 flex items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3">
        <p className="text-sm text-fg-muted">
          {count === 0
            ? t(
                'components.home-missing.fill_in_any_and_save',
                'Fill in any of these and save. The rest can wait.',
              )
            : t(
                'components.home-missing.count_to_save',
                { one: '{{count}} detail to save', other: '{{count}} details to save' },
                { count },
              )}
        </p>
        <Button type="submit" variant="primary" loading={pending} disabled={count === 0}>
          {t('components.home-missing.save', 'Save')}
        </Button>
      </div>
    </form>
  );
}
