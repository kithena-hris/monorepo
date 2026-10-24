import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  RadioCard,
  RadioGroup,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';
import { t } from '../i18n';

/**
 * A new manager, confirmed before it is saved, wherever HR sets one: the
 * profile, a dated change, a bulk edit. The host asks what else it touches
 * (Performance's manager reviews in a running cycle, say) as questions with
 * choices, and once the change is made, or sent for approval, or dated, it
 * passes the answers on to be carried out when the change takes effect.
 */

/** The reporting line's attribute: a change to it is confirmed first. */
export const MANAGER_KEY = 'manager_id';

/** Something a change touches beyond the record, asked before it is made, with its choices. */
export interface ChangeQuestion {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly options: readonly {
    readonly id: string;
    readonly label: string;
    readonly description: string;
  }[];
  /** The choice made unless HR picks another. */
  readonly value: string;
}

/** What the host offers for a new manager: the questions, and carrying out the answers. */
export interface ManagerChange {
  readonly questions: (
    personIds: readonly string[],
    managerId: string | null,
  ) => Promise<readonly ChangeQuestion[]>;
  readonly apply: (
    personIds: readonly string[],
    managerId: string | null,
    answers: Readonly<Record<string, string>>,
  ) => Promise<Outcome>;
}

/** The new manager a change sets, or null for none: `manager_id` holds a person's id. */
export const managerOf = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * The confirm, as a promise: `confirm` opens it and settles with HR's answers,
 * or null when they cancel; render `dialog` where the screen is.
 */
export function useManagerConfirm(
  managerChange: ManagerChange | undefined,
  title: string,
): {
  readonly confirm: (
    personIds: readonly string[],
    managerId: string | null,
    when?: string,
  ) => Promise<Readonly<Record<string, string>> | null>;
  readonly dialog: JSX.Element | null;
} {
  const [asking, setAsking] = useState<{
    readonly questions: readonly ChangeQuestion[] | null;
    readonly when: string | undefined;
    readonly resolve: (answers: Readonly<Record<string, string>> | null) => void;
  } | null>(null);
  const confirm = (personIds: readonly string[], managerId: string | null, when?: string) =>
    new Promise<Readonly<Record<string, string>> | null>((resolve) => {
      setAsking({ questions: null, when, resolve });
      void (managerChange?.questions(personIds, managerId) ?? Promise.resolve([])).then(
        (questions) => {
          setAsking((a) => (a === null ? a : { ...a, questions }));
        },
        () => {
          setAsking((a) => (a === null ? a : { ...a, questions: [] }));
        },
      );
    });
  return {
    confirm,
    dialog:
      asking === null ? null : (
        <ManagerChangeConfirm
          title={title}
          when={asking.when}
          questions={asking.questions}
          onDone={(answers) => {
            asking.resolve(answers);
            setAsking(null);
          }}
        />
      ),
  };
}

/** The confirm itself: each question a choice, the host's suggestion picked. Cancel saves nothing. */
function ManagerChangeConfirm({
  title,
  when,
  questions,
  onDone,
}: {
  readonly title: string;
  readonly when: string | undefined;
  readonly questions: readonly ChangeQuestion[] | null;
  readonly onDone: (answers: Readonly<Record<string, string>> | null) => void;
}): JSX.Element {
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  const chosen = (q: ChangeQuestion): string => answers[q.id] ?? q.value;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {when === undefined
              ? t(
                  'record.manager-change.they_report_to_the_person_you',
                  'They report to the person you chose from now on, and who may see their record follows.',
                )
              : t(
                  'record.manager-change.they_report_to_the_person_from',
                  'They report to the person you chose from {{when}}; whatever you choose here happens then.',
                  { when },
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          {questions === null ? (
            <p className="text-sm text-fg-muted" aria-live="polite">
              {t(
                'record.manager-change.checking_what_else_this_touches',
                'Checking what else this touches…',
              )}
            </p>
          ) : (
            questions.map((q) => (
              <Field key={q.id}>
                <FieldLabel>{q.title}</FieldLabel>
                <p className="text-sm text-fg-muted">{q.description}</p>
                <RadioGroup
                  aria-label={q.title}
                  className="flex flex-col gap-2"
                  value={chosen(q)}
                  onValueChange={(v) => {
                    setAnswers((a) => ({ ...a, [q.id]: v }));
                  }}
                >
                  {q.options.map((o) => (
                    <RadioCard key={o.id} value={o.id} description={o.description}>
                      {o.label}
                    </RadioCard>
                  ))}
                </RadioGroup>
              </Field>
            ))
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onDone(null);
            }}
          >
            {t('record.manager-change.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={questions === null}
            onClick={() => {
              onDone(Object.fromEntries((questions ?? []).map((q) => [q.id, chosen(q)] as const)));
            }}
          >
            {t('record.manager-change.change_manager', 'Change manager')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
