import {
  Alert,
  Avatar,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Stack,
  Text,
} from '@reach/ui-native';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Company } from './account';
import { asLabel, companyOrigin, TENANT_SUFFIX } from './address';

/** A screen's frame: the canvas, inside the safe area, scrollable over the keyboard. */
function Screen({
  children,
  centred = true,
  bottom = 0,
}: {
  children: ReactNode;
  /** Sign-in screens sit in the middle; a signed-in screen starts at the top. */
  centred?: boolean;
  /** Room kept under the content, for a tab bar floating over it. */
  bottom?: number;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    // The keyboard lifts the content rather than covering the button under it.
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-canvas"
      style={{ paddingTop: insets.top }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName={
          centred ? 'grow justify-center gap-6 px-4 py-8' : 'gap-6 px-4 py-6'
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + bottom + 32 }}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const hostOf = (origin: string): string => origin.replace(/^https:\/\//, '');
const nameOf = (company: Company): string => company.displayName ?? hostOf(company.origin);

/** Which company: its name, in front of a suffix that is not typed. */
export function CompanyScreen({
  onFound,
}: {
  onFound: (origin: string) => Promise<'none' | 'unreachable' | 'found'>;
}): React.JSX.Element {
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (): Promise<void> => {
    const origin = companyOrigin(label);
    if (origin === null) {
      setProblem('Enter your company’s name as it appears in its Kithena address.');
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
        <Text tone="muted">Enter your company’s Kithena address.</Text>
      </Stack>

      <Field invalid={problem !== null} disabled={busy}>
        <FieldLabel>Company address</FieldLabel>
        {/* Plain text, verbatim: a label has no `/` or `.com` to offer. */}
        <Input
          value={label}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          onChange={(text) => {
            setLabel(asLabel(text));
            if (problem !== null) setProblem(null);
          }}
          placeholder="yourcompany"
          endAdornment={TENANT_SUFFIX}
          returnKeyType="go"
          autoFocus
          onSubmitEditing={() => {
            void go();
          }}
        />
        {problem === null ? (
          <FieldDescription>The first part of the address you open Kithena at.</FieldDescription>
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

/** The company's name, and its logo when it has one, as its web sign-in page shows them. */
function CompanyHeading({ company }: { company: Company }): React.JSX.Element {
  return (
    <Stack gap={3} align="start">
      {company.logoUrl === null ? null : (
        <Avatar
          name={nameOf(company)}
          src={company.logoUrl}
          shape="rounded"
          fit="contain"
          size="2xl"
          decorative
        />
      )}
      <Text
        variant="footnote"
        tone="accent"
        weight="semibold"
        className="uppercase tracking-widest"
      >
        {nameOf(company)}
      </Text>
    </Stack>
  );
}

/** Shape only, to save a wasted prompt, as on the web. Existence is identity's answer. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Signing in at the company: the work address, then the passkey. The address
 * is the web's reason too — on a phone holding several people's passkeys it
 * says which person this is meant to be.
 */
export function SignInScreen({
  company,
  initialEmail,
  onSignIn,
  onRecover,
  onChangeCompany,
}: {
  company: Company;
  initialEmail: string;
  onSignIn: (workEmail: string) => Promise<'cancelled' | 'refused' | 'signed-in'>;
  onRecover: () => void;
  onChangeCompany: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState(initialEmail);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  const go = (): void => {
    if (!LOOKS_LIKE_EMAIL.test(email.trim())) {
      setProblem('Enter the work address you were invited with.');
      return;
    }
    setProblem(null);
    setBusy(true);
    setRefused(false);
    void onSignIn(email.trim()).then((outcome) => {
      // Cancelling the prompt is not a failure: nothing happened, try again.
      if (outcome !== 'signed-in') {
        setBusy(false);
        setRefused(outcome === 'refused');
      }
    });
  };

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

      <Field invalid={problem !== null} disabled={busy}>
        <FieldLabel>Work email address</FieldLabel>
        <Input
          type="email"
          value={email}
          onChange={(text) => {
            setEmail(text);
            if (problem !== null) setProblem(null);
          }}
          placeholder="you@yourcompany.com"
          returnKeyType="go"
          onSubmitEditing={go}
        />
        {problem === null ? (
          <FieldDescription>The address your HR team invited you with.</FieldDescription>
        ) : (
          <FieldError>{problem}</FieldError>
        )}
      </Field>

      <Stack gap={3}>
        <Button
          variant="primary"
          fullWidth
          loading={busy}
          loadingLabel="Waiting for your passkey"
          onPress={go}
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
