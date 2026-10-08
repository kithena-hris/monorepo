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

const STEPS = ['Legal entity', 'Country pack', 'Publish', 'Your profile'];

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

  const back = { label: 'Settings', onPress: navigation.goBack };
  if (failed !== null) {
    return (
      <Page title="Set up" back={back}>
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
      <Page title="Set up" back={back}>
        <Loading label="Loading the setup" />
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
    <Page title="Set up the employee record" back={back}>
      <Text tone="muted">
        What your company keeps about each person. You can change all of it later.
      </Text>
      <Stepper
        label="Setting up the employee record"
        orientation="horizontal"
        steps={STEPS.map((label, i) => ({
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
          <Text weight="semibold">Confirm the legal entity</Text>
          <Text variant="subhead" tone="muted">
            The company that employs people. Its country decides which fields the law requires.
          </Text>
          <Field required invalid={nameMissing}>
            <FieldLabel>Registered name</FieldLabel>
            <Input
              size="sm"
              value={entity.name}
              onChange={(name) => {
                setEntity({ ...entity, name });
              }}
            />
            <FieldError>Give the entity’s registered name.</FieldError>
          </Field>
          <Field required>
            <FieldLabel>Country</FieldLabel>
            <Select
              value={entity.country}
              onValueChange={(country) => {
                setEntity({ ...entity, country });
              }}
            >
              <SelectTrigger size="sm" accessibilityLabel="Country">
                <SelectValue placeholder="Choose a country" />
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
              Where the entity is registered, not where people work.
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
            Continue
          </Button>
        </>
      ) : null}
      {step === 1 || step === 2 ? (
        <>
          {pack === null ? (
            <Alert tone="warning" title={`No country pack for ${countryName} yet`}>
              You can still publish: the core fields every company needs are always there, and you
              can add the rest yourself.
            </Alert>
          ) : (
            <>
              <Alert tone="info">
                {`The entity is registered in ${pack.countryName}, so the ${pack.countryName} pack is selected. Fields its law requires are required and cannot be turned off.`}
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
                {`${String(pack.sections.reduce((n, s) => n + s.requiredByLaw, 0))} fields required by law`}
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
              Continue
            </Button>
          ) : (
            <>
              <Alert tone="info" title="Publish version 1">
                {`${String(enabled.length)} ${enabled.length === 1 ? 'section' : 'sections'} of the ${countryName} pack, beside the core fields. People can be added once it is published.`}
              </Alert>
              <Button
                variant="primary"
                loading={busy === 'PublishSetup'}
                onPress={() => {
                  void act(
                    'PublishSetup',
                    { country: entity.country, sections: enabled.map((s) => s.key) },
                    'Version 1 published',
                  ).then((done) => {
                    if (done !== null) setStep(3);
                  });
                }}
              >
                Publish
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            onPress={() => {
              setStep(step - 1);
            }}
          >
            Back
          </Button>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <Alert tone="success" title="The employee record is published">
            Yours is the first record checked against it. Fill in what is missing.
          </Alert>
          <Button
            variant="primary"
            onPress={() => {
              navigation.navigate('Profile', { back: 'Set up' });
            }}
          >
            Open your profile
          </Button>
        </>
      ) : null}
    </Page>
  );
}
