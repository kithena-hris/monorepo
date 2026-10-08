import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ChipGroup,
  ChipGroupItem,
  Icon,
  Inline,
  KeyValues,
  List,
  ListItem,
  Stack,
  Text,
} from '@reach/ui-native';
import { Clock, Lock, Mail, Phone } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';

import { Account } from '../account-card';
import { Failed, Loading, Page } from '../frame';
import {
  isEmpty,
  useRead,
  valueOf,
  valuesOf,
  type Entry,
  type RecordField,
  type Value,
} from './api';
import { DisplayValue, longDate } from './display';
import { STATUS_TONE } from './directory';
import type { PeopleScreen } from './routes';

interface Pending {
  readonly id: string;
  readonly key: string;
  readonly kind: string;
  readonly value: Entry;
  readonly effectiveFrom: string;
  readonly expiresAt: string;
  readonly requestedBy: string;
}

interface Linked {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
}

interface ProfileData {
  readonly person: {
    readonly name: string;
    readonly summary: string | null;
    readonly missing: number | null;
  };
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly fields: readonly RecordField[];
  }[];
  readonly values: readonly Entry[];
  readonly employment: { readonly status: string | null } | null;
  readonly pending: readonly Pending[] | null;
  readonly reportingLine: {
    readonly chain: readonly Linked[];
    readonly peers: readonly Linked[];
  } | null;
}

/** The web's words for a status (`statusLabel`). */
const STATUS: Record<string, string> = {
  provisional: 'Provisional',
  pre_hire: 'Starting soon',
  active: 'Active',
  on_leave: 'On leave',
  notice: 'On notice',
  terminated: 'Left',
  discarded: 'Discarded',
  merged: 'Merged into another record',
};

/** "2026-11-01" or an instant, as a day in words. */
const day = (iso: string): string => longDate(iso.slice(0, 10));

/** A change waiting on somebody, under the value it would replace (design `pend`). */
function PendingNote({
  field,
  pending,
}: {
  field: RecordField;
  pending: Pending;
}): React.JSX.Element {
  return (
    <Alert tone="warning" icon={Clock}>
      <Stack gap={1}>
        <DisplayValue field={field} value={valueOf(pending.value)} />
        <Text variant="subhead">
          {`From ${day(pending.effectiveFrom)}, asked by ${pending.requestedBy}. Waits until ${day(pending.expiresAt)}.`}
        </Text>
      </Stack>
    </Alert>
  );
}

/** What a field's value says about the person, by type: the address to write to, the number to call. */
function contactOf(data: ProfileData, values: Readonly<Record<string, Value>>, type: string) {
  for (const section of data.sections) {
    for (const field of section.fields) {
      const value = values[field.key];
      if (field.dataType === type && typeof value === 'string' && value !== '') return value;
    }
  }
  return null;
}

/**
 * A record (design D1, D2): the person centred at the top with Email and
 * Call, the sections as a row of pills, and each field's value with what
 * waits to replace it. The viewer's own when no person is named: the Me tab.
 *
 * Read-only on the phone for now. Everything here is what People sent for
 * this viewer: a field they may not read is not in the answer to draw.
 */
export function Profile({ navigation, route }: PeopleScreen<'Profile'>): React.JSX.Element {
  const personId = route.params?.personId ?? null;
  const { load, reload } = useRead<ProfileData>('Profile', { personId });
  const [chosen, setChosen] = useState<string | null>(null);
  const back = route.params?.back;

  const frame = (children: ReactNode, trailing?: ReactNode): React.JSX.Element => (
    <Page
      {...(back === undefined
        ? { large: load.status === 'ready' ? load.data.person.name : (route.params?.name ?? 'Me') }
        : { back: { label: back, onPress: navigation.goBack } })}
      {...(trailing === undefined ? {} : { trailing })}
    >
      {children}
    </Page>
  );

  if (load.status === 'loading') return frame(<Loading label="Loading the record" />);
  if (load.status === 'error') return frame(<Failed message={load.message} onRetry={reload} />);

  const data = load.data;
  const values = valuesOf(data.values);
  const status = data.employment?.status ?? null;
  const missingIn = (fields: readonly RecordField[]): number =>
    fields.filter((f) => f.missing === true || (f.required && isEmpty(values[f.key]))).length;
  const sections = data.sections.filter((s) => s.fields.length > 0);
  const section = sections.find((s) => s.key === chosen) ?? sections[0];
  // Nobody emails or calls themselves: the Me tab's record offers neither.
  const own = personId === null;
  const email = own ? null : contactOf(data, values, 'email');
  const phone = own ? null : contactOf(data, values, 'phone');
  // The chain runs from the top of the organisation down: the manager is its last.
  const manager = data.reportingLine?.chain.at(-1);

  return frame(
    <>
      <Stack gap={2} align="center" className="pt-2">
        <Avatar name={data.person.name} size="3xl" decorative />
        {back === undefined ? null : (
          <Text accessibilityRole="header" variant="title2" weight="bold" className="text-center">
            {data.person.name}
          </Text>
        )}
        {data.person.summary === null ? null : (
          <Text tone="muted" className="text-center">
            {data.person.summary}
          </Text>
        )}
        <Inline gap={2} justify="center">
          {status === null ? null : (
            <Badge size="sm" dot tone={STATUS_TONE[STATUS[status] ?? ''] ?? 'neutral'}>
              {STATUS[status] ?? status}
            </Badge>
          )}
          {data.person.missing === null || data.person.missing === 0 ? null : (
            <Badge size="sm" tone="warning">{`${String(data.person.missing)} missing`}</Badge>
          )}
        </Inline>
        {email === null && phone === null ? null : (
          <Inline gap={2} justify="center" className="pt-1">
            {email === null ? null : (
              <Button size="sm" startIcon={<Icon icon={Mail} />} href={`mailto:${email}`}>
                Email
              </Button>
            )}
            {phone === null ? null : (
              <Button size="sm" startIcon={<Icon icon={Phone} />} href={`tel:${phone}`}>
                Call
              </Button>
            )}
          </Inline>
        )}
      </Stack>

      {sections.length > 1 ? (
        <ChipGroup
          type="single"
          value={section?.key ?? ''}
          onValueChange={setChosen}
          accessibilityLabel="Sections"
          scroll
        >
          {sections.map((s) => {
            const missing = missingIn(s.fields);
            return (
              <ChipGroupItem key={s.key} value={s.key} variant="view">
                {missing === 0 ? s.label : `${s.label} · ${String(missing)}`}
              </ChipGroupItem>
            );
          })}
        </ChipGroup>
      ) : null}

      {section === undefined ? null : (
        <Card>
          <KeyValues
            layout="stacked"
            items={section.fields.map((field) => {
              const waiting = data.pending?.find((p) => p.key === field.key);
              return {
                id: field.key,
                label: (
                  <Inline gap={2}>
                    <Text variant="subhead" tone="muted">
                      {field.label}
                    </Text>
                    {field.sensitive === true ? (
                      <Badge size="sm" tone="warning" icon={Lock}>
                        Sensitive
                      </Badge>
                    ) : null}
                  </Inline>
                ),
                value: (
                  <Stack gap={2} className="w-full">
                    <DisplayValue field={field} value={values[field.key]} />
                    {waiting === undefined ? null : <PendingNote field={field} pending={waiting} />}
                  </Stack>
                ),
              };
            })}
          />
        </Card>
      )}

      {manager === undefined ? null : (
        <Stack gap={2}>
          <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
            Reporting line
          </Text>
          <List>
            <ListItem
              leading={<Avatar name={manager.name} size={40} decorative />}
              description={manager.title === null ? 'Manager' : `Manager · ${manager.title}`}
              chevron
              onPress={() => {
                navigation.push('Profile', {
                  personId: manager.id,
                  name: manager.name,
                  back: data.person.name.split(' ')[0] ?? data.person.name,
                });
              }}
            >
              {manager.name}
            </ListItem>
          </List>
        </Stack>
      )}

      {/* Your own record, in the Me tab: where you are signed in, and the way out. */}
      {own && back === undefined ? <Account /> : null}
    </>,
  );
}
