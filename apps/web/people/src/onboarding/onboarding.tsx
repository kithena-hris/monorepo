import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  EmptyState,
  PageHeader,
  Progress,
  Stack,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { seenBy, type RecordSection, type Values } from '../record/model';
import { SectionForm } from '../record/section-form';

export interface OnboardingSection extends RecordSection {
  /** Voluntary is its own word: diversity questions are never "optional homework". */
  readonly ask: 'required' | 'optional' | 'voluntary';
}

export interface OnboardingState {
  readonly firstName: string;
  /** Only `collectAt: onboarding` sections this person may fill in. */
  readonly sections: readonly OnboardingSection[];
  readonly values: Values;
  /** Sections already saved, on this device or another. */
  readonly saved: readonly string[];
}

export interface OnboardingProps {
  readonly load: Loadable<OnboardingState>;
  /** One section, only what changed. Each save is its own `profile_updated`. */
  readonly onSave: (sectionKey: string, changed: Values) => Promise<Outcome>;
}

const ASK = {
  required: { tone: 'warning', text: 'Required' },
  optional: { tone: 'neutral', text: 'Optional' },
  voluntary: { tone: 'info', text: 'Voluntary' },
} as const;

/**
 * A new starter's first day, in several sittings (PRD §8.3, design screen 5).
 *
 * Sectioned and resumable: every section saves on its own, so abandoning half
 * way leaves a partial record rather than nothing, and coming back opens the
 * first section not yet saved. Each section says who will read the answers,
 * because that is the question somebody filling in a form on a train is asking.
 */
export function Onboarding({ load, onSave }: OnboardingProps): JSX.Element {
  return (
    <Loaded load={load} what="your onboarding">
      {(state) => <Sections state={state} onSave={onSave} />}
    </Loaded>
  );
}

function Sections({
  state,
  onSave,
}: {
  readonly state: OnboardingState;
  readonly onSave: OnboardingProps['onSave'];
}): JSX.Element {
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set(state.saved));
  const [values, setValues] = useState<Values>(state.values);
  const firstOpen = state.sections.find((s) => !saved.has(s.key))?.key ?? '';
  const [open, setOpen] = useState(firstOpen);

  if (state.sections.length === 0) {
    return (
      <Stack gap={6}>
        <PageHeader title={`Welcome, ${state.firstName}`} />
        <EmptyState
          title="Nothing to fill in"
          description="Your company has not asked for anything during onboarding."
        />
      </Stack>
    );
  }

  const done = state.sections.filter((s) => saved.has(s.key)).length;
  const total = state.sections.length;

  return (
    <Stack gap={6}>
      <PageHeader
        title={`Welcome, ${state.firstName}`}
        description={
          done === total
            ? 'All done. You can change any of this later from your profile.'
            : `${String(done)} of ${String(total)} sections done. You can stop any time; nothing you have saved is lost.`
        }
      />
      <Progress value={done} max={total} label="Sections done" />
      <Accordion type="single" collapsible value={open} onValueChange={setOpen}>
        {state.sections.map((section, index) => {
          const ask = ASK[section.ask];
          const next = state.sections.slice(index + 1).find((s) => !saved.has(s.key));
          return (
            <AccordionItem key={section.key} value={section.key}>
              <AccordionTrigger
                level={2}
                meta={
                  saved.has(section.key) ? (
                    <Badge tone="success" size="sm">
                      Saved
                    </Badge>
                  ) : (
                    <Badge tone={ask.tone} size="sm">
                      {ask.text}
                    </Badge>
                  )
                }
              >
                {section.label}
              </AccordionTrigger>
              <AccordionContent>
                <Stack gap={4}>
                  <p className="text-sm">{seenBy(section.visibility)}</p>
                  <SectionForm
                    section={section}
                    values={values}
                    submitLabel={next === undefined ? 'Save' : 'Save and continue'}
                    onSave={async (key, changed) => {
                      const outcome = await onSave(key, changed);
                      if (outcome.ok) {
                        setValues((v) => ({ ...v, ...changed }));
                        setSaved((s) => new Set([...s, key]));
                        setOpen(next?.key ?? '');
                      }
                      return outcome;
                    }}
                  />
                </Stack>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </Stack>
  );
}
