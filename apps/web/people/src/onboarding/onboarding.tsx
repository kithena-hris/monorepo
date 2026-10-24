import { Badge, Button, Card, EmptyState, PageHeader, Progress, Stack, Stepper } from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Checked, type Loadable, type Outcome } from '../load';
import { FieldFiles, type UploadOutcome } from '../record/files';
import { seenBy, type RecordSection, type Values } from '../record/model';
import { ReviewNotices, type IdentifierReview } from '../record/review-notices';
import { SectionForm } from '../record/section-form';
import { t } from '../i18n';

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
  /** Their doubted identifiers still open (PEO-125). */
  readonly reviews?: readonly IdentifierReview[];
}

export interface OnboardingProps {
  readonly load: Loadable<OnboardingState>;
  /** One section, only what changed. Each save is its own `profile_updated`. */
  readonly onSave: (sectionKey: string, changed: Values) => Promise<Outcome>;
  /** What our checks would warn about a national identifier, before it is saved (PEO-125). */
  readonly onCheck?: (sectionKey: string, changed: Values) => Promise<Checked>;
  /** Keep a file for an image or document field; saving the section points the record at it. */
  readonly onUploadFile?: (key: string, file: File) => Promise<UploadOutcome>;
}

const ASK = {
  required: { tone: 'warning', text: t('onboarding.onboarding.required', 'Required') },
  optional: { tone: 'neutral', text: t('onboarding.onboarding.optional', 'Optional') },
  voluntary: { tone: 'info', text: t('onboarding.onboarding.voluntary', 'Voluntary') },
} as const;

/**
 * A new starter's first day, in several sittings (PRD §8.3, design screen 5).
 *
 * Sectioned and resumable: every section saves on its own, so abandoning half
 * way leaves a partial record rather than nothing, and coming back opens the
 * first section not yet saved. Each section says who will read the answers,
 * because that is the question somebody filling in a form on a train is asking.
 */
export function Onboarding({ load, onSave, onCheck, onUploadFile }: OnboardingProps): JSX.Element {
  return (
    <Loaded load={load} what={t('onboarding.onboarding.your_onboarding', 'your onboarding')}>
      {(state) => (
        <FieldFiles.Provider value={{ upload: onUploadFile ?? null, known: new Map() }}>
          <Sections state={state} onSave={onSave} onCheck={onCheck} />
        </FieldFiles.Provider>
      )}
    </Loaded>
  );
}

function Sections({
  state,
  onSave,
  onCheck,
}: {
  readonly state: OnboardingState;
  readonly onSave: OnboardingProps['onSave'];
  readonly onCheck: OnboardingProps['onCheck'];
}): JSX.Element {
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set(state.saved));
  const [values, setValues] = useState<Values>(state.values);
  const firstOpen = state.sections.find((s) => !saved.has(s.key))?.key ?? '';
  const [open, setOpen] = useState(firstOpen);

  if (state.sections.length === 0) {
    return (
      <Stack gap={6}>
        <PageHeader
          title={t('onboarding.onboarding.welcome', 'Welcome, {{firstName}}', {
            firstName: state.firstName,
          })}
        />
        <EmptyState
          title={t('onboarding.onboarding.nothing_to_fill_in', 'Nothing to fill in')}
          description={t(
            'onboarding.onboarding.your_company_has_not_asked_for',
            'Your company has not asked for anything during onboarding.',
          )}
        />
      </Stack>
    );
  }

  const done = state.sections.filter((s) => saved.has(s.key)).length;
  const total = state.sections.length;
  const index = Math.max(
    0,
    state.sections.findIndex((s) => s.key === open),
  );
  const section = open === '' ? null : (state.sections[index] ?? null);
  const nextOf = (key: string) =>
    state.sections
      .slice(state.sections.findIndex((s) => s.key === key) + 1)
      .find((s) => !saved.has(s.key));

  return (
    <Stack gap={6}>
      <PageHeader
        title={t('onboarding.onboarding.welcome', 'Welcome, {{firstName}}', {
          firstName: state.firstName,
        })}
        description={
          done === total
            ? t(
                'onboarding.onboarding.all_done_you_can_change_any',
                'All done. You can change any of this later from your profile.',
              )
            : t(
                'onboarding.onboarding.sections_done_stop_any_time',
                {
                  one: '{{done}} of {{count}} section done. You can stop any time; nothing you have saved is lost.',
                  other:
                    '{{done}} of {{count}} sections done. You can stop any time; nothing you have saved is lost.',
                },
                { done, count: total },
              )
        }
      />
      <Progress
        value={done}
        max={total}
        label={t('onboarding.onboarding.sections_done', 'Sections done')}
        showValue
        valueLabel={t('onboarding.onboarding.of', '{{done}} of {{total}}', {
          done: String(done),
          total: String(total),
        })}
        className="max-w-105 touch:max-w-none"
      />
      <ReviewNotices reviews={state.reviews} />
      {/*
        One section at a time (W16, M8): the sections as steps down the side,
        done or not, and the one being filled in beside them. Every step can
        be left for later and done from the profile.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 @4xl/page:grid-cols-[18.75rem_minmax(0,1fr)] @4xl/page:items-start">
        <Card padded className="touch:hidden">
          <Stepper
            label={t('onboarding.onboarding.onboarding_sections', 'Onboarding sections')}
            orientation="vertical"
            current={section === null ? total : index}
            steps={state.sections.map((s) => ({
              id: s.key,
              label: s.label,
              description: saved.has(s.key)
                ? t('onboarding.onboarding.saved', 'Saved')
                : ASK[s.ask].text,
              status: saved.has(s.key) ? 'complete' : s.key === open ? 'current' : 'upcoming',
            }))}
            onStepChange={(_, step) => {
              setOpen(step.id);
            }}
          />
        </Card>
        {section === null ? (
          <Card padded>
            <EmptyState
              title={t('onboarding.onboarding.all_done', 'All done')}
              description={t(
                'onboarding.onboarding.everything_is_saved_change_any_of',
                'Everything is saved. Change any of it later from your profile.',
              )}
            />
          </Card>
        ) : (
          <Card padded className="@container flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold">{section.label}</h2>
              {saved.has(section.key) ? (
                <Badge tone="success" size="sm">
                  {t('onboarding.onboarding.saved', 'Saved')}
                </Badge>
              ) : (
                <Badge tone={ASK[section.ask].tone} size="sm">
                  {ASK[section.ask].text}
                </Badge>
              )}
            </div>
            <p className="text-sm text-fg-muted">{seenBy(section.visibility)}</p>
            <SectionForm
              key={section.key}
              section={section}
              values={values}
              columns={2}
              submitLabel={
                nextOf(section.key) === undefined
                  ? t('onboarding.onboarding.save', 'Save')
                  : t('onboarding.onboarding.save_and_continue', 'Save and continue')
              }
              {...(onCheck === undefined ? {} : { onCheck })}
              footer={
                section.ask === 'required' || nextOf(section.key) === undefined ? undefined : (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setOpen(nextOf(section.key)?.key ?? '');
                    }}
                  >
                    {t('onboarding.onboarding.do_this_later', 'Do this later')}
                  </Button>
                )
              }
              onSave={async (key, changed) => {
                const outcome = await onSave(key, changed);
                if (outcome.ok) {
                  setValues((v) => ({ ...v, ...changed }));
                  setSaved((s) => new Set([...s, key]));
                  setOpen(nextOf(key)?.key ?? '');
                }
                return outcome;
              }}
            />
          </Card>
        )}
      </div>
    </Stack>
  );
}
