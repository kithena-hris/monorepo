import {
  Alert,
  Badge,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  PageSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Stepper,
  Switch,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { isMissing, type PendingValue, type RecordSection, type Values } from '../record/model';
import { SectionForm } from '../record/section-form';
import { t } from '../i18n';

export interface PackSection {
  readonly key: string;
  readonly label: string;
  /** "Legal name, date of birth, nationality…" */
  readonly summary: string;
  readonly required: number;
  /** Required because the country's law requires it, not by choice. */
  readonly requiredByLaw: number;
  /** On unless the admin turns it off. Diversity is off until chosen. */
  readonly onByDefault: boolean;
}

export interface CountryPack {
  readonly country: string;
  readonly countryName: string;
  readonly fields: number;
  readonly sections: readonly PackSection[];
}

export interface SetupState {
  /** What the back office recorded, for the admin to confirm or correct. */
  readonly legalEntity: { readonly name: string; readonly country: string };
  readonly entityConfirmed: boolean;
  readonly countries: readonly { readonly code: string; readonly name: string }[];
  readonly packs: readonly CountryPack[];
  /** Null until version 1 is published. */
  readonly published: number | null;
  /** The administrator's own record, once there is a version to evaluate it against. */
  readonly profile: {
    readonly sections: readonly RecordSection[];
    readonly values: Values;
    /** Their own changes waiting for approval, such as the NIF (PEO-077). */
    readonly pending?: readonly PendingValue[];
  } | null;
}

export interface PeopleSetupProps {
  readonly load: Loadable<SetupState>;
  readonly onConfirmEntity: (entity: { name: string; country: string }) => Promise<Outcome>;
  /** Accept the pack with these sections on, and publish it as version 1. */
  readonly onPublish: (pack: { country: string; sections: readonly string[] }) => Promise<Outcome>;
  readonly onSaveProfile: (sectionKey: string, changed: Values) => Promise<Outcome>;
  /**
   * The first administrator is usually the only HR member, so nobody else can
   * approve their NIF: they approve it themselves, once they confirm (PEO-077).
   */
  readonly onSelfApprove?: (changeId: string) => Promise<Outcome>;
  readonly onWithdraw?: (changeId: string) => Promise<Outcome>;
  readonly onFinish: () => void;
}

const STEPS = [
  { id: 'entity', label: t('setup.people-setup.legal_entity', 'Legal entity') },
  { id: 'pack', label: t('setup.people-setup.country_pack', 'Country pack') },
  { id: 'publish', label: t('setup.people-setup.publish', 'Publish') },
  { id: 'profile', label: t('setup.people-setup.your_profile', 'Your profile') },
] as const;

/**
 * Setting up the employee record, on first sign-in (PRD §8.2 steps 6 and 7,
 * design screen 1).
 *
 * The tenant has no published schema, so the first administrator lands here
 * rather than on an empty directory. The last step is their own profile — the
 * first record evaluated against version 1, and the cheapest usability test
 * there is.
 */
export function PeopleSetup(props: PeopleSetupProps): JSX.Element {
  return (
    <Stack gap={6}>
      <PageHeader
        title={t('setup.people-setup.set_up_the_employee_record', 'Set up the employee record')}
        description={t(
          'setup.people-setup.what_your_company_keeps_about_each',
          'What your company keeps about each person. You can change all of it later.',
        )}
      />
      <Loaded load={props.load} what={t('setup.people-setup.the_setup', 'the setup')}>
        {(state) => <Wizard {...props} state={state} />}
      </Loaded>
    </Stack>
  );
}

function stepOf(state: SetupState): number {
  if (state.published !== null) return 3;
  return state.entityConfirmed ? 1 : 0;
}

function Wizard({
  state,
  onConfirmEntity,
  onPublish,
  onSaveProfile,
  onSelfApprove,
  onWithdraw,
  onFinish,
}: PeopleSetupProps & { readonly state: SetupState }): JSX.Element {
  // Where the admin is, resumed from what the tenant already has: coming back
  // tomorrow starts at the first step not yet done.
  const [step, setStep] = useState(() => stepOf(state));
  const [entity, setEntity] = useState(state.legalEntity);
  const [country, setCountry] = useState(state.legalEntity.country);
  // Only what the admin changed; everything else is the pack's default.
  const [choices, setChoices] = useState<Readonly<Record<string, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [nameMissing, setNameMissing] = useState(false);

  const pack = state.packs.find((p) => p.country === country) ?? null;
  const enabled =
    pack === null
      ? []
      : pack.sections.filter((s) => s.requiredByLaw > 0 || (choices[s.key] ?? s.onByDefault));
  const countryName = state.countries.find((c) => c.code === country)?.name ?? country;

  const attempt = async (action: () => Promise<Outcome>, then: () => void): Promise<void> => {
    setBusy(true);
    setRefused(null);
    const outcome = await action();
    setBusy(false);
    if (outcome.ok) then();
    else setRefused(outcome.message);
  };

  const missing =
    state.profile === null
      ? 0
      : state.profile.sections
          .flatMap((s) => s.fields)
          .filter((f) => f.required && isMissing(state.profile?.values[f.key])).length;

  return (
    <Stack gap={6}>
      <Stepper
        label={t(
          'setup.people-setup.setting_up_the_employee_record',
          'Setting up the employee record',
        )}
        steps={STEPS}
        current={step}
      />

      {refused === null ? null : (
        <Alert
          tone="danger"
          title={t('setup.people-setup.that_did_not_go_through', 'That did not go through')}
        >
          {refused}
        </Alert>
      )}

      {step === 0 ? (
        <PageSection
          surface
          title={
            <>{t('setup.people-setup.confirm_the_legal_entity', 'Confirm the legal entity')}</>
          }
          description={
            <>
              {t(
                'setup.people-setup.the_company_that_employs_people_its',
                'The company that employs people. Its country decides which fields the law requires.',
              )}
            </>
          }
        >
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (entity.name.trim() === '') {
                setNameMissing(true);
                return;
              }
              const confirmed = { name: entity.name.trim(), country: entity.country };
              void attempt(
                () => onConfirmEntity(confirmed),
                () => {
                  setCountry(confirmed.country);
                  setStep(1);
                },
              );
            }}
          >
            <Stack gap={4}>
              <Field required invalid={nameMissing}>
                <FieldLabel>
                  {t('setup.people-setup.registered_name', 'Registered name')}
                </FieldLabel>
                <FieldControl>
                  <Input
                    value={entity.name}
                    autoComplete="organization"
                    onChange={(e) => {
                      setEntity({ ...entity, name: e.target.value });
                    }}
                  />
                </FieldControl>
                <FieldError>
                  {t(
                    'setup.people-setup.give_the_entitys_registered_name',
                    "Give the entity's registered name.",
                  )}
                </FieldError>
              </Field>
              <Field required>
                <FieldLabel>{t('setup.people-setup.country', 'Country')}</FieldLabel>
                <Select
                  value={entity.country}
                  onValueChange={(value) => {
                    setEntity({ ...entity, country: value });
                  }}
                >
                  <FieldControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    {state.countries.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {t(
                    'setup.people-setup.where_the_entity_is_registered_not',
                    'Where the entity is registered, not where people work.',
                  )}
                </FieldDescription>
              </Field>
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  loadingLabel={t('setup.people-setup.confirming', 'Confirming')}
                >
                  {t('setup.people-setup.continue', 'Continue')}
                </Button>
              </div>
            </Stack>
          </form>
        </PageSection>
      ) : null}

      {step === 1 ? (
        <Stack gap={4}>
          {pack === null ? (
            <Alert
              tone="warning"
              title={t(
                'setup.people-setup.no_country_pack_for_yet',
                'No country pack for {{countryName}} yet',
                { countryName },
              )}
            >
              {t(
                'setup.people-setup.you_can_still_publish_the_core',
                'You can still publish: the core fields every company needs are always there, and you can add the rest yourself.',
              )}
            </Alert>
          ) : (
            <>
              <Alert tone="info">
                {t(
                  'setup.people-setup.the_entity_is_registered_in_so',
                  'The entity is registered in {{countryName}}, so the {{countryName2}} pack is selected. Fields its law requires are marked required and cannot be turned off.',
                  { countryName: pack.countryName, countryName2: pack.countryName },
                )}
              </Alert>
              <PageSection
                surface
                title={
                  <>
                    {pack.countryName}: {pack.sections.length}{' '}
                    {t('setup.people-setup.sections_fields', 'sections, {{fields}} fields', {
                      fields: pack.fields,
                    })}
                  </>
                }
                description={
                  <>
                    {pack.sections.reduce((n, s) => n + s.requiredByLaw, 0)}{' '}
                    {t(
                      'setup.people-setup.required_by_law_all_editable_later',
                      'required by law · all editable later',
                    )}
                  </>
                }
              >
                <ul className="flex flex-col gap-4">
                  {pack.sections.map((section) => {
                    const on = enabled.includes(section);
                    const locked = section.requiredByLaw > 0;
                    return (
                      <li key={section.key}>
                        <Field orientation="horizontal" disabled={locked}>
                          <div className="min-w-0 flex-1">
                            <FieldLabel>{section.label}</FieldLabel>
                            <FieldDescription>
                              {section.summary}
                              {locked
                                ? ' ' +
                                  t(
                                    'setup.people-setup.the_law_requires_this_section',
                                    'The law requires this section.',
                                  )
                                : ''}
                            </FieldDescription>
                          </div>
                          <Badge tone={section.requiredByLaw > 0 ? 'warning' : 'neutral'} size="sm">
                            {section.requiredByLaw > 0
                              ? t(
                                  'setup.people-setup.required_by_law',
                                  '{{requiredByLaw}} required by law',
                                  { requiredByLaw: String(section.requiredByLaw) },
                                )
                              : on
                                ? t('setup.people-setup.required', '{{required}} required', {
                                    required: String(section.required),
                                  })
                                : t('setup.people-setup.off', 'Off')}
                          </Badge>
                          <FieldControl>
                            <Switch
                              checked={on}
                              disabled={locked}
                              onCheckedChange={(next) => {
                                setChoices((c) => ({ ...c, [section.key]: next }));
                              }}
                            />
                          </FieldControl>
                        </Field>
                      </li>
                    );
                  })}
                </ul>
              </PageSection>
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                setStep(0);
              }}
            >
              {t('setup.people-setup.back', 'Back')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setStep(2);
              }}
            >
              {t('setup.people-setup.continue', 'Continue')}
            </Button>
          </div>
        </Stack>
      ) : null}

      {step === 2 ? (
        <PageSection
          surface
          title={<>{t('setup.people-setup.publish_version_1', 'Publish version 1')}</>}
          description={
            <>
              {t(
                'setup.people-setup.all_forms_exports_and_integrations_now',
                'All forms, exports and integrations now use this version. Later changes create a new version.',
              )}
            </>
          }
        >
          <Stack gap={4}>
            <ul className="list-disc ps-5 text-sm">
              {enabled.map((s) => (
                <li key={s.key}>{s.label}</li>
              ))}
              <li>
                {t(
                  'setup.people-setup.the_core_fields_every_company_has',
                  'The core fields every company has: name, work email, start date, manager.',
                )}
              </li>
            </ul>
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  setStep(1);
                }}
              >
                {t('setup.people-setup.back', 'Back')}
              </Button>
              <Button
                variant="primary"
                loading={busy}
                loadingLabel={t('setup.people-setup.publishing_version_1', 'Publishing version 1')}
                onClick={() => {
                  void attempt(
                    () => onPublish({ country, sections: enabled.map((s) => s.key) }),
                    () => {
                      setStep(3);
                    },
                  );
                }}
              >
                {t('setup.people-setup.publish_version_1', 'Publish version 1')}
              </Button>
            </div>
          </Stack>
        </PageSection>
      ) : null}

      {step === 3 ? (
        state.profile === null ? (
          <Alert
            tone="info"
            title={t('setup.people-setup.version_1_is_published', 'Version 1 is published')}
          >
            {t(
              'setup.people-setup.your_own_profile_will_be_ready',
              'Your own profile will be ready in a moment.',
            )}
          </Alert>
        ) : (
          <Stack gap={4}>
            <Alert tone="info">
              {t(
                'setup.people-setup.this_is_exactly_what_every_employee',
                'This is exactly what every employee will see. Anything confusing here will confuse them too.',
              )}
            </Alert>
            {state.profile.sections.map((section) => (
              <PageSection key={section.key} surface title={section.label}>
                <SectionForm
                  section={section}
                  values={state.profile?.values ?? {}}
                  onSave={onSaveProfile}
                  pending={state.profile?.pending ?? []}
                  {...(onSelfApprove === undefined ? {} : { onSelfApprove })}
                  {...(onWithdraw === undefined ? {} : { onWithdraw })}
                />
              </PageSection>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={missing === 0 ? 'success' : 'warning'}>
                {missing === 0
                  ? t('setup.people-setup.complete', 'Complete')
                  : t('setup.people-setup.missing', '{{missing}} missing', {
                      missing: String(missing),
                    })}
              </Badge>
              <Button variant="primary" onClick={onFinish}>
                {missing === 0
                  ? t('setup.people-setup.finish', 'Finish')
                  : t('setup.people-setup.finish_later', 'Finish later')}
              </Button>
            </div>
          </Stack>
        )
      ) : null}
    </Stack>
  );
}
