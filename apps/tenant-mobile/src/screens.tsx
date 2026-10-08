import {
  Alert,
  Avatar,
  Button,
  Card,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  KeyValues,
  Stack,
  Text,
} from '@reach/ui-native';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Company, Person } from './account';
import { companyOrigin, greetingFor } from './address';

/** A screen's frame: the canvas, inside the safe area, content centred and scrollable over the keyboard. */
function Screen({ children }: { children: ReactNode }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-canvas"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="grow justify-center gap-6 px-4 py-8"
      >
        {children}
      </ScrollView>
    </View>
  );
}

const hostOf = (origin: string): string => origin.replace(/^https:\/\//, '');

/** Which company: its own address, as the web needs it in the address bar. */
export function CompanyScreen({
  onFound,
}: {
  onFound: (origin: string) => Promise<'none' | 'unreachable' | 'found'>;
}): React.JSX.Element {
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (): Promise<void> => {
    const origin = companyOrigin(typed);
    if (origin === null) {
      setProblem('Enter your company’s Kithena address, like yourcompany.app.kithena.com.');
      return;
    }
    setProblem(null);
    setBusy(true);
    const found = await onFound(origin);
    setBusy(false);
    // The two failures say different things: one is a typo, the other the network.
    if (found === 'none')
      setProblem('There is no company at that address. Check it and try again.');
    if (found === 'unreachable')
      setProblem('That address could not be reached. Check your connection and try again.');
  };

  return (
    <Screen>
      <Stack gap={2}>
        <Text accessibilityRole="header" variant="large">
          Your company
        </Text>
        <Text tone="muted">Enter the address you open Kithena at in a browser.</Text>
      </Stack>

      <Field invalid={problem !== null} disabled={busy}>
        <FieldLabel>Company address</FieldLabel>
        <Input
          type="url"
          value={typed}
          onChange={(text) => {
            setTyped(text);
            if (problem !== null) setProblem(null);
          }}
          placeholder="yourcompany.app.kithena.com"
          returnKeyType="go"
          onSubmitEditing={() => {
            void go();
          }}
        />
        {problem === null ? (
          <FieldDescription>Your company’s name on its own works too.</FieldDescription>
        ) : (
          <FieldError>{problem}</FieldError>
        )}
      </Field>

      <Button
        variant="primary"
        fullWidth
        loading={busy}
        loadingLabel="Finding your company"
        onPress={() => {
          void go();
        }}
      >
        Continue
      </Button>
    </Screen>
  );
}

/** The company's name and mark, as its web sign-in page shows them. */
function CompanyHeading({ company }: { company: Company }): React.JSX.Element {
  const name = company.displayName ?? hostOf(company.origin);
  return (
    <Stack gap={3} align="start">
      {company.logoUrl === null ? null : (
        <Avatar name={name} src={company.logoUrl} shape="rounded" fit="contain" size="2xl" />
      )}
      <Text
        variant="footnote"
        tone="accent"
        weight="semibold"
        className="uppercase tracking-widest"
      >
        {name}
      </Text>
    </Stack>
  );
}

/** Signing in with a passkey, on the company's own sign-in page. */
export function SignInScreen({
  company,
  onSignIn,
  onRecover,
  onChangeCompany,
}: {
  company: Company;
  onSignIn: () => Promise<'cancelled' | 'refused' | 'signed-in'>;
  onRecover: () => void;
  onChangeCompany: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  return (
    <Screen>
      <Stack gap={4}>
        <CompanyHeading company={company} />
        <Stack gap={2}>
          <Text accessibilityRole="header" variant="large">
            Sign in
          </Text>
          <Text tone="muted">
            Use the passkey on this device. There is no password to remember.
          </Text>
        </Stack>
      </Stack>

      <Stack gap={3}>
        <Button
          variant="primary"
          fullWidth
          loading={busy}
          loadingLabel="Waiting for your device"
          onPress={() => {
            setBusy(true);
            setRefused(false);
            void onSignIn().then((outcome) => {
              // Cancelling the sheet is not a failure: nothing happened, try again.
              if (outcome !== 'signed-in') {
                setBusy(false);
                setRefused(outcome === 'refused');
              }
            });
          }}
        >
          Sign in with a passkey
        </Button>

        {/* One message for every failure, as on the web: anybody can present a
            passkey, and telling the reasons apart answers a question that is
            not the asker's. */}
        {refused ? (
          <Alert tone="danger" title="That did not work">
            Use the passkey you set up for this company. If you have not set one up yet, use the
            link your HR team sent you.
          </Alert>
        ) : null}
      </Stack>

      <Stack gap={1} align="start">
        <Button variant="link" onPress={onRecover}>
          Set up a new passkey
        </Button>
        <Button variant="link" onPress={onChangeCompany}>
          Use a different company
        </Button>
      </Stack>
    </Screen>
  );
}

/** Signed in: who, where, until when, and the way out. */
export function SignedInScreen({
  company,
  person,
  onSignOut,
}: {
  company: Company;
  person: Person;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const until =
    person.expiresAt === null
      ? null
      : new Date(person.expiresAt).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });

  return (
    <Screen>
      <Stack gap={2}>
        <Text accessibilityRole="header" variant="large">
          {`Hello, ${greetingFor(person.name, person.workEmail)}`}
        </Text>
        <Text tone="muted">You are signed in.</Text>
      </Stack>

      <Card>
        <KeyValues
          items={[
            { label: 'Company', value: company.displayName ?? hostOf(company.origin) },
            ...(person.workEmail === null
              ? []
              : [{ label: 'Work email', value: person.workEmail }]),
            ...(until === null ? [] : [{ label: 'Signed in until', value: until }]),
          ]}
        />
      </Card>

      <Button
        fullWidth
        loading={busy}
        loadingLabel="Signing out"
        onPress={() => {
          setBusy(true);
          void onSignOut();
        }}
      >
        Sign out
      </Button>
    </Screen>
  );
}

/** Nothing answered at the company's address: say so, and offer the two ways on. */
export function UnreachableScreen({
  origin,
  onRetry,
  onChangeCompany,
}: {
  origin: string;
  onRetry: () => void;
  onChangeCompany: () => void;
}): React.JSX.Element {
  return (
    <Screen>
      <Alert tone="warning" title="Kithena could not be reached">
        {`Nothing answered at ${hostOf(origin)}. Check your connection and try again.`}
      </Alert>
      <Stack gap={1}>
        <Button variant="primary" fullWidth onPress={onRetry}>
          Try again
        </Button>
        <Button variant="link" onPress={onChangeCompany}>
          Use a different company
        </Button>
      </Stack>
    </Screen>
  );
}
