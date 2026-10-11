import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  ListItem,
  Progress,
  Text,
} from '@reach/ui-native';
import { Circle, CircleCheck } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from './act';
import {
  ask,
  formInputs,
  sameValue,
  useRead,
  useSigned,
  valuesOf,
  type Entry,
  type Finding,
  type RecordField,
  type Value,
} from './api';
import { AttributeInput } from './attribute-input';
import type { PeopleScreen } from './routes';

export interface OnboardingData {
  readonly firstName: string;
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly ask: 'required' | 'optional' | 'voluntary';
    readonly fields: readonly RecordField[];
  }[];
  readonly values: readonly Entry[];
  readonly saved: readonly string[];
}

const ASK = {
  required: { tone: 'warning', text: 'Required' },
  optional: { tone: 'neutral', text: 'Optional' },
  voluntary: { tone: 'info', text: 'Voluntary' },
} as const;

/**
 * A new starter's onboarding (design D7): one section card at a time, the
 * step list hidden on a phone. Every section saves on its own, so stopping
 * half way leaves a partial record, and coming back opens the first section
 * not saved yet. A section that is not required can be left for later.
 */
export function Onboarding({ navigation }: PeopleScreen<'Onboarding'>): React.JSX.Element {
  const signed = useSigned();
  const { load, reload } = useRead<OnboardingData>('Onboarding');
  const { act, busy } = useAct();
  const [saved, setSaved] = useState<readonly string[] | null>(null);
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState<Readonly<Record<string, Value>>>({});
  const [warnings, setWarnings] = useState<readonly Finding[] | null>(null);
  const back = { label: 'Home', onPress: navigation.goBack };

  if (load.status === 'loading')
    return (
      <Page back={back}>
        <Loading label="Loading your onboarding" />
      </Page>
    );
  if (load.status === 'error')
    return (
      <Page back={back}>
        <Failed message={load.message} onRetry={reload} />
      </Page>
    );
  const data = load.data;
  const done = new Set(saved ?? data.saved);
  const original = valuesOf(data.values);
  const section = data.sections.find((s) => !done.has(s.key) && !skipped.includes(s.key));
  const count = data.sections.filter((s) => done.has(s.key)).length;
  const total = data.sections.length;
  const changed = Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => !sameValue(value, original[key])),
  );

  const save = async (): Promise<void> => {
    if (section === undefined) return;
    const inputs = formInputs(
      Object.fromEntries(
        Object.entries(changed).filter(([key]) => section.fields.some((f) => f.key === key)),
      ),
    );
    if (warnings === null && inputs.length > 0) {
      const checked = await ask<{ findings: Finding[] }>(signed, 'IdentifierCheck', {
        personId: null,
        changed: inputs,
      });
      if (checked.ok && checked.data.findings.length > 0) {
        setWarnings(checked.data.findings);
        return;
      }
    }
    const result = await act('SaveOwnSection', { changed: inputs });
    if (result === null) return;
    setWarnings(null);
    setSaved([...done, section.key]);
  };

  const left = total - count;
  return (
    <Page
      large={`Welcome, ${data.firstName}`}
      back={back}
      {...(section === undefined
        ? {}
        : {
            foot: (
              <>
                {section.ask === 'required' ? null : (
                  <Button
                    className="flex-1"
                    fullWidth
                    onPress={() => {
                      setSkipped((s) => [...s, section.key]);
                      setWarnings(null);
                    }}
                  >
                    Later
                  </Button>
                )}
                <Button
                  className="flex-1"
                  fullWidth
                  variant="primary"
                  loading={busy !== null}
                  onPress={() => void save()}
                >
                  {warnings !== null && warnings.length > 0 ? 'Save anyway' : 'Save and continue'}
                </Button>
              </>
            ),
          })}
    >
      {total === 0 ? (
        <EmptyState
          icon={CircleCheck}
          title="Nothing to fill in"
          description="Your company has not asked for anything during onboarding."
        />
      ) : (
        <>
          <Alert tone="accent" variant="summary">
            {left === 0
              ? 'All done. You can change any of this later from your profile.'
              : `${left === 1 ? 'One short step' : `${String(left)} short steps`} left. HR only sees what you finish, and nothing you save is lost.`}
          </Alert>
          {/* One checklist (P20): done steps ticked, the current one open in place. */}
          <Card padded={false} className="overflow-hidden">
            <View className="gap-2 px-4 pb-2 pt-4">
              <Text variant="headline">{`${String(count)} of ${String(total)} done`}</Text>
              <Progress value={count} max={total} label="Steps done" />
            </View>
            {data.sections.map((s, i) => {
              const finished = done.has(s.key);
              const current = section?.key === s.key;
              if (current)
                return (
                  <View key={s.key} className="gap-4 bg-accent-subtle px-4 py-4">
                    <View className="flex-row items-center gap-3">
                      <View className="size-7 items-center justify-center rounded-full bg-accent-solid">
                        <Text variant="footnote" weight="bold" className="text-fg-on-accent">
                          {String(i + 1)}
                        </Text>
                      </View>
                      <Text variant="headline" className="flex-1">
                        {s.label}
                      </Text>
                      {s.ask === 'required' ? null : (
                        <Badge size="sm" tone={ASK[s.ask].tone}>
                          {ASK[s.ask].text}
                        </Badge>
                      )}
                    </View>
                    {s.fields.map((field) => (
                      <AttributeInput
                        key={field.key}
                        field={field}
                        value={field.key in draft ? draft[field.key] : original[field.key]}
                        onChange={(value) => {
                          setDraft((d) => ({ ...d, [field.key]: value }));
                          setWarnings(null);
                        }}
                        warning={warnings?.find((w) => w.key === field.key)?.message}
                      />
                    ))}
                  </View>
                );
              return (
                <ListItem
                  key={s.key}
                  listitem={false}
                  leading={
                    <Icon
                      icon={finished ? CircleCheck : Circle}
                      size={22}
                      tone={finished ? 'success' : 'subtle'}
                    />
                  }
                  {...(finished || s.ask === 'required'
                    ? {}
                    : { description: ASK[s.ask].text })}
                  {...(finished
                    ? { className: 'opacity-70' }
                    : {
                        chevron: true,
                        onPress: () => {
                          // Jump to it: what comes before it is left for later.
                          setSkipped(
                            data.sections
                              .slice(0, i)
                              .filter((x) => !done.has(x.key))
                              .map((x) => x.key),
                          );
                          setWarnings(null);
                        },
                      })}
                >
                  {s.label}
                </ListItem>
              );
            })}
          </Card>
          {section === undefined && skipped.length > 0 ? (
            <Text tone="muted">What you left for later is on your profile, in the Me tab.</Text>
          ) : null}
        </>
      )}
    </Page>
  );
}
