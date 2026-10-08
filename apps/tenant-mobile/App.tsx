import { ReachProvider, Spinner } from '@reach/ui-native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';

import {
  companyAt,
  forgetCompany,
  openRecovery,
  restore,
  signIn,
  signOut,
  whoAmI,
  type Company,
  type Person,
} from './src/account';
import { CompanyScreen, SignedInScreen, SignInScreen, UnreachableScreen } from './src/screens';

import './global.css';

/**
 * Kithena on a phone, for the people at a company: the tenant app, signed in
 * with the passkey they already use on the web.
 *
 * Four places to be, in the order the web has them: which company (its
 * address), signing in there, signed in, and the company not answering.
 */
type Place =
  | { readonly kind: 'starting' }
  | { readonly kind: 'company' }
  | { readonly kind: 'sign-in'; readonly company: Company }
  | {
      readonly kind: 'signed-in';
      readonly company: Company;
      readonly sessionId: string;
      readonly person: Person;
    }
  | { readonly kind: 'unreachable'; readonly origin: string };

/** Where a remembered company and session put somebody when the app opens. */
async function resumed(): Promise<Place> {
  const saved = await restore();
  if (saved.origin === null) return { kind: 'company' };

  const company = await companyAt(saved.origin);
  if (company === 'unreachable') return { kind: 'unreachable', origin: saved.origin };
  if (company === null) return { kind: 'company' };
  if (saved.sessionId === null) return { kind: 'sign-in', company };

  const person = await whoAmI(company.origin, saved.sessionId);
  if (person === 'unreachable') return { kind: 'unreachable', origin: company.origin };
  if (person === 'signed-out') return { kind: 'sign-in', company };
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
            setPlace({ kind: 'sign-in', company });
            return 'found';
          }}
        />
      ) : place.kind === 'sign-in' ? (
        <SignInScreen
          company={place.company}
          onSignIn={async () => {
            const outcome = await signIn(place.company.origin);
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
        <SignedInScreen
          company={place.company}
          person={place.person}
          onSignOut={async () => {
            await signOut(place.company.origin, place.sessionId);
            setPlace({ kind: 'sign-in', company: place.company });
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
