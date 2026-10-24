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
import { t } from './i18n';

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
      setProblem(
        t(
          'screens.enter_your_companys_name_as_it',
          'Enter your company’s name as it appears in its Kithena address.',
        ),
      );
      return;
    }
    setProblem(null);
    setBusy(true);
    const found = await onFound(origin);
    setBusy(false);
    // The two failures say different things: one is a typo, the other the network.
    if (found === 'none')
      setProblem(
        t(
          'screens.there_is_no_company_at_that',
          'There is no company at that address. Check it and try again.',
        ),
      );
    if (found === 'unreachable')
      setProblem(
        t(
          'screens.that_address_could_not_be_reached',
          'That address could not be reached. Check your connection and try again.',
        ),
      );
  };

  return (
    <Screen>
      <Stack gap={2}>
        <Text accessibilityRole="header" variant="large">
          {t('screens.your_company', 'Your company')}
        </Text>
        <Text tone="muted">
          {t(
            'screens.enter_your_companys_kithena_address',
            'Enter your company’s Kithena address.',
          )}
        </Text>
      </Stack>

      <Field invalid={problem !== null} disabled={busy}>
        <FieldLabel>{t('screens.company_address', 'Company address')}</FieldLabel>
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
          placeholder={t('screens.yourcompany', 'yourcompany')}
          endAdornment={TENANT_SUFFIX}
          returnKeyType="go"
          autoFocus
          onSubmitEditing={() => {
            void go();
          }}
        />
        {problem === null ? (
          <FieldDescription>
            {t(
              'screens.the_first_part_of_the_address',
              'The first part of the address you open Kithena at.',
            )}
          </FieldDescription>
        ) : (
          <FieldError>{problem}</FieldError>
        )}
      </Field>

      <Button
        variant="primary"
        fullWidth
        loading={busy}
        loadingLabel={t('screens.finding_your_company', 'Finding your company')}
        onPress={() => {
          void go();
        }}
      >
        {t('screens.continue', 'Continue')}
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
      setProblem(
        t(
          'screens.enter_the_work_address_you_were',
          'Enter the work address you were invited with.',
        ),
      );
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
            {t('screens.sign_in', 'Sign in')}
          </Text>
          <Text tone="muted">
            {t(
              'screens.use_the_passkey_on_this_device',
              'Use the passkey on this device. There is no password to remember.',
            )}
          </Text>
        </Stack>
      </Stack>

      <Field invalid={problem !== null} disabled={busy}>
        <FieldLabel>{t('screens.work_email_address', 'Work email address')}</FieldLabel>
        <Input
          type="email"
          value={email}
          onChange={(text) => {
            setEmail(text);
            if (problem !== null) setProblem(null);
          }}
          placeholder={t('screens.you_yourcompany_com', 'you@yourcompany.com')}
          returnKeyType="go"
          onSubmitEditing={go}
        />
        {problem === null ? (
          <FieldDescription>
            {t(
              'screens.the_address_your_hr_team_invited',
              'The address your HR team invited you with.',
            )}
          </FieldDescription>
        ) : (
          <FieldError>{problem}</FieldError>
        )}
      </Field>

      <Stack gap={3}>
        <Button
          variant="primary"
          fullWidth
          loading={busy}
          loadingLabel={t('screens.waiting_for_your_passkey', 'Waiting for your passkey')}
          onPress={go}
        >
          {t('screens.sign_in_with_a_passkey', 'Sign in with a passkey')}
        </Button>

        {/* One message for every failure, as on the web: anybody can present a
            passkey, and telling the reasons apart answers a question that is
            not the asker's. */}
        {refused ? (
          <Alert tone="danger" title={t('screens.that_did_not_work', 'That did not work')}>
            {t(
              'screens.use_the_passkey_you_set_up',
              'Use the passkey you set up for this company. If you have not set one up yet, use the link your HR team sent you.',
            )}
          </Alert>
        ) : null}
      </Stack>

      <Stack gap={1} align="start">
        <Button variant="link" onPress={onRecover}>
          {t('screens.set_up_a_new_passkey', 'Set up a new passkey')}
        </Button>
        <Button variant="link" onPress={onChangeCompany}>
          {t('screens.use_a_different_company', 'Use a different company')}
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
      <Alert
        tone="warning"
        title={t('screens.kithena_could_not_be_reached', 'Kithena could not be reached')}
      >
        {t(
          'screens.nothing_answered_at_check_your_connection',
          'Nothing answered at {{hostOf}}. Check your connection and try again.',
          { hostOf: hostOf(origin) },
        )}
      </Alert>
      <Stack gap={1}>
        <Button variant="primary" fullWidth onPress={onRetry}>
          {t('screens.try_again', 'Try again')}
        </Button>
        <Button variant="link" onPress={onChangeCompany}>
          {t('screens.use_a_different_company', 'Use a different company')}
        </Button>
      </Stack>
    </Screen>
  );
}
