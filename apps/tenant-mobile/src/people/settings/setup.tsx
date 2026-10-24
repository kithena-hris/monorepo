import {
  Alert,
  Badge,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  List,
  ListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stepper,
  Switch,
  Text,
} from '@reach/ui-native';
import { useEffect, useState } from 'react';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useSigned } from '../api';
import type { PeopleScreen } from '../routes';
import { t } from '../../i18n';

interface PackSection {
  readonly key: string;
  readonly label: string;
  readonly summary: string;
  readonly required: number;
  readonly requiredByLaw: number;
  readonly onByDefault: boolean;
}

interface SetupState {
  readonly legalEntity: { readonly name: string; readonly country: string } | null;
  readonly entityConfirmed: boolean;
  readonly countries: readonly { readonly code: string; readonly name: string }[];
  readonly packs: readonly {
    readonly country: string;
    readonly countryName: string;
    readonly fields: number;
    readonly sections: readonly PackSection[];
  }[];
  readonly published: number | null;
}

const STEPS = () => [
  t('people.settings.setup.legal_entity', 'Legal entity'),
  t('people.settings.setup.country_pack', 'Country pack'),
  t('people.settings.setup.publish', 'Publish'),
  t('people.settings.setup.your_profile', 'Your profile'),
];

/**
 * Setting up the employee record, the first time (the web's People setup):
 * confirm the legal entity, keep the sections of its country's pack, publish
 * version 1, then fill in your own record — the first one checked against it.
 */
export function PeopleSetup({ navigation }: PeopleScreen<'PeopleSetup'>): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct();
  const [state, setState] = useState<SetupState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [entity, setEntity] = useState({ name: '', country: '' });
  const [choices, setChoices] = useState<Readonly<Record<string, boolean>>>({});
  const [nameMissing, setNameMissing] = useState(false);

  useEffect(() => {
    void ask<SetupState>(signed, 'Setup').then((answer) => {
      if (!answer.ok) {
        setFailed(answer.message);
        return;
      }
      setState(answer.data);
      setEntity(answer.data.legalEntity ?? { name: signed.company.displayName ?? '', country: '' });
      setStep(answer.data.published !== null ? 3 : answer.data.entityConfirmed ? 1 : 0);
    });
  }, [signed]);

  const back = {
    label: t('people.settings.setup.settings', 'Settings'),
    onPress: navigation.goBack,
  };
  if (failed !== null) {
    return (
      <Page title={t('people.settings.setup.set_up', 'Set up')} back={back}>
        <Failed
          message={failed}
          onRetry={() => {
            setFailed(null);
          }}
        />
      </Page>
    );
  }
  if (state === null) {
    return (
      <Page title={t('people.settings.setup.set_up', 'Set up')} back={back}>
        <Loading label={t('people.settings.setup.loading_the_setup', 'Loading the setup')} />
      </Page>
    );
  }
  const pack = state.packs.find((p) => p.country === entity.country) ?? null;
  const enabled =
    pack === null
      ? []
      : pack.sections.filter((s) => s.requiredByLaw > 0 || (choices[s.key] ?? s.onByDefault));
  const countryName =
    state.countries.find((c) => c.code === entity.country)?.name ?? entity.country;

  return (
    <Page
      title={t('people.settings.setup.set_up_the_employee_record', 'Set up the employee record')}
      back={back}
    >
      <Text tone="muted">
        {t(
          'people.settings.setup.what_your_company_keeps_about_each',
          'What your company keeps about each person. You can change all of it later.',
        )}
      </Text>
      <Stepper
        label={t(
          'people.settings.setup.setting_up_the_employee_record',
          'Setting up the employee record',
        )}
        orientation="horizontal"
        steps={STEPS().map((label, i) => ({
          label,
          status: i < step ? 'done' : i === step ? 'current' : 'todo',
          ...(i < step && step < 3
            ? {
                onPress: () => {
                  setStep(i);
                },
              }
            : {}),
        }))}
      />
      {step === 0 ? (
        <>
          <Text weight="semibold">
            {t('people.settings.setup.confirm_the_legal_entity', 'Confirm the legal entity')}
          </Text>
          <Text variant="subhead" tone="muted">
            {t(
              'people.settings.setup.the_company_that_employs_people_its',
              'The company that employs people. Its country decides which fields the law requires.',
            )}
          </Text>
          <Field required invalid={nameMissing}>
            <FieldLabel>{t('people.settings.setup.registered_name', 'Registered name')}</FieldLabel>
            <Input
              size="sm"
              value={entity.name}
              onChange={(name) => {
                setEntity({ ...entity, name });
              }}
            />
            <FieldError>
              {t(
                'people.settings.setup.give_the_entitys_registered_name',
                'Give the entity’s registered name.',
              )}
            </FieldError>
          </Field>
          <Field required>
            <FieldLabel>{t('people.settings.setup.country', 'Country')}</FieldLabel>
            <Select
              value={entity.country}
              onValueChange={(country) => {
                setEntity({ ...entity, country });
              }}
            >
              <SelectTrigger
                size="sm"
                accessibilityLabel={t('people.settings.setup.country', 'Country')}
              >
                <SelectValue
                  placeholder={t('people.settings.setup.choose_a_country', 'Choose a country')}
                />
              </SelectTrigger>
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
                'people.settings.setup.where_the_entity_is_registered_not',
                'Where the entity is registered, not where people work.',
              )}
            </FieldDescription>
          </Field>
          <Button
            variant="primary"
            disabled={entity.country === ''}
            loading={busy === 'ConfirmSetupEntity'}
            onPress={() => {
              if (entity.name.trim() === '') {
                setNameMissing(true);
                return;
              }
              void act('ConfirmSetupEntity', {
                name: entity.name.trim(),
                country: entity.country,
              }).then((done) => {
                if (done !== null) setStep(1);
              });
            }}
          >
            {t('people.settings.setup.continue', 'Continue')}
          </Button>
        </>
      ) : null}
      {step === 1 || step === 2 ? (
        <>
          {pack === null ? (
            <Alert
              tone="warning"
              title={t(
                'people.settings.setup.no_country_pack_for_yet',
                'No country pack for {{countryName}} yet',
                { countryName },
              )}
            >
              {t(
                'people.settings.setup.you_can_still_publish_the_core',
                'You can still publish: the core fields every company needs are always there, and you can add the rest yourself.',
              )}
            </Alert>
          ) : (
            <>
              <Alert tone="info">
                {t(
                  'people.settings.setup.the_entity_is_registered_in_so',
                  'The entity is registered in {{countryName}}, so the {{countryName}} pack is selected. Fields its law requires are required and cannot be turned off.',
                  { countryName: pack.countryName },
                )}
              </Alert>
              <List>
                {pack.sections.map((s) => {
                  const on = enabled.includes(s);
                  const locked = s.requiredByLaw > 0;
                  return (
                    <ListItem
                      key={s.key}
                      description={`${s.summary}${locked ? ' The law requires this section.' : ''}`}
                      trailing={
                        <Switch
                          checked={on}
                          disabled={locked || step === 2}
                          accessibilityLabel={s.label}
                          onCheckedChange={(next) => {
                            setChoices((c) => ({ ...c, [s.key]: next }));
                          }}
                        />
                      }
                    >
                      {s.label}
                    </ListItem>
                  );
                })}
              </List>
              <Badge size="sm" tone="warning">
                {t(
                  'people.settings.setup.fields_required_by_law',
                  '{{String}} fields required by law',
                  { String: String(pack.sections.reduce((n, s) => n + s.requiredByLaw, 0)) },
                )}
              </Badge>
            </>
          )}
          {step === 1 ? (
            <Button
              variant="primary"
              onPress={() => {
                setStep(2);
              }}
            >
              {t('people.settings.setup.continue', 'Continue')}
            </Button>
          ) : (
            <>
              <Alert
                tone="info"
                title={t('people.settings.setup.publish_version_1', 'Publish version 1')}
              >
                {t(
                  'people.settings.setup.of_the_pack_beside_the_core',
                  {
                    one: '{{count}} section of the {{countryName}} pack, beside the core fields. People can be added once it is published.',
                    other:
                      '{{count}} sections of the {{countryName}} pack, beside the core fields. People can be added once it is published.',
                  },
                  { count: enabled.length, countryName },
                )}
              </Alert>
              <Button
                variant="primary"
                loading={busy === 'PublishSetup'}
                onPress={() => {
                  void act(
                    'PublishSetup',
                    { country: entity.country, sections: enabled.map((s) => s.key) },
                    t('people.settings.setup.version_1_published', 'Version 1 published'),
                  ).then((done) => {
                    if (done !== null) setStep(3);
                  });
                }}
              >
                {t('people.settings.setup.publish', 'Publish')}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            onPress={() => {
              setStep(step - 1);
            }}
          >
            {t('people.settings.setup.back', 'Back')}
          </Button>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <Alert
            tone="success"
            title={t(
              'people.settings.setup.the_employee_record_is_published',
              'The employee record is published',
            )}
          >
            {t(
              'people.settings.setup.yours_is_the_first_record_checked',
              'Yours is the first record checked against it. Fill in what is missing.',
            )}
          </Alert>
          <Button
            variant="primary"
            onPress={() => {
              navigation.navigate('Profile', { back: t('people.settings.setup.set_up', 'Set up') });
            }}
          >
            {t('people.settings.setup.open_your_profile', 'Open your profile')}
          </Button>
        </>
      ) : null}
    </Page>
  );
}
