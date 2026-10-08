import { ReachProvider, Spinner } from '@reach/ui-native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';

import {
  companyAt,
  forgetCompany,
  forgetSession,
  endViewing,
  startViewing,
  lastEmail,
  openRecovery,
  restore,
  signIn,
  signOut,
  whoAmI,
  type Company,
  type Person,
} from './src/account';
import { CompanyScreen, SignInScreen, UnreachableScreen } from './src/screens';
import { SignedIn } from './src/signed-in';

import './global.css';

/**
 * Kithena on a phone, for the people at a company: the tenant app, signed in
 * with the passkey they already use on the web.
 *
 * Four places to be: which company (its address), signing in there with the
 * work address and the passkey, signed in (a dashboard and the person's own
 * tab, with signing out), and the company not answering.
 */
type Place =
  | { readonly kind: 'starting' }
  | { readonly kind: 'company' }
  | { readonly kind: 'sign-in'; readonly company: Company; readonly email: string }
  | {
      readonly kind: 'signed-in';
      readonly company: Company;
      readonly sessionId: string;
      readonly person: Person;
    }
  | { readonly kind: 'unreachable'; readonly origin: string };

/** Signing in at a company, with the address last used there offered again. */
async function signingIn(company: Company): Promise<Place> {
  return { kind: 'sign-in', company, email: await lastEmail() };
}

/** Where a remembered company and session put somebody when the app opens. */
async function resumed(): Promise<Place> {
  const saved = await restore();
  if (saved.origin === null) return { kind: 'company' };

  const company = await companyAt(saved.origin);
  if (company === 'unreachable') return { kind: 'unreachable', origin: saved.origin };
  if (company === null) return { kind: 'company' };
  if (saved.sessionId === null) return signingIn(company);

  const person = await whoAmI(company.origin, saved.sessionId);
  if (person === 'unreachable') return { kind: 'unreachable', origin: company.origin };
  if (person === 'signed-out') {
    // A view that lapsed while the app was closed: the administrator's own session, if any.
    await forgetSession();
    const own = (await restore()).sessionId;
    const back = own === null ? 'signed-out' : await whoAmI(company.origin, own);
    if (own === null || typeof back === 'string') return signingIn(company);
    return { kind: 'signed-in', company, sessionId: own, person: back };
  }
  return { kind: 'signed-in', company, sessionId: saved.sessionId, person };
}

export default function App(): React.JSX.Element {
  const scheme = useColorScheme();
  const [place, setPlace] = useState<Place>({ kind: 'starting' });

  const resume = useCallback(async (): Promise<void> => {
    setPlace({ kind: 'starting' });
    setPlace(await resumed());
  }, []);

  useEffect(() => {
    void resume();
  }, [resume]);

  const changeCompany = (): void => {
    void forgetCompany().then(() => {
      setPlace({ kind: 'company' });
    });
  };

  return (
    <ReachProvider theme={scheme === 'dark' ? 'dark' : 'light'}>
      {place.kind === 'starting' ? (
        <View className="flex-1 items-center justify-center bg-canvas">
          <Spinner label="Opening Kithena" />
        </View>
      ) : place.kind === 'company' ? (
        <CompanyScreen
          onFound={async (origin) => {
            const company = await companyAt(origin);
            if (company === null) return 'none';
            if (company === 'unreachable') return 'unreachable';
            setPlace(await signingIn(company));
            return 'found';
          }}
        />
      ) : place.kind === 'sign-in' ? (
        <SignInScreen
          company={place.company}
          initialEmail={place.email}
          onSignIn={async (workEmail) => {
            const outcome = await signIn(place.company.origin, workEmail);
            if (outcome.kind === 'signed-in') {
              setPlace({
                kind: 'signed-in',
                company: place.company,
                sessionId: outcome.sessionId,
                person: outcome.person,
              });
            }
            return outcome.kind;
          }}
          onRecover={() => {
            void openRecovery(place.company.origin);
          }}
          onChangeCompany={changeCompany}
        />
      ) : place.kind === 'signed-in' ? (
        <SignedIn
          company={place.company}
          sessionId={place.sessionId}
          person={place.person}
          onSignOut={async () => {
            await signOut(place.company.origin, place.sessionId);
            setPlace(await signingIn(place.company));
          }}
          onSignedOut={() => {
            // A lapsed view puts the administrator's own session back; resume finds it.
            void forgetSession().then(resume);
          }}
          onViewAs={async (personId, reason) => {
            const started = await startViewing(
              place.company.origin,
              place.sessionId,
              personId,
              reason,
            );
            if (!started.ok) return started.message;
            setPlace({ ...place, sessionId: started.sessionId, person: started.person });
            return null;
          }}
          onEndViewing={async () => {
            await endViewing(place.company.origin, place.sessionId);
            await resume();
          }}
        />
      ) : (
        <UnreachableScreen
          origin={place.origin}
          onRetry={() => {
            void resume();
          }}
          onChangeCompany={changeCompany}
        />
      )}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </ReachProvider>
  );
}
