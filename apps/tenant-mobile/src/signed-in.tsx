import { Banner, Button, TabBar, ToastProvider } from '@reach/ui-native';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  NavigationIndependentTree,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Eye, House, Inbox as InboxIcon, User, Users } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Company, Person } from './account';
import { greetingFor } from './address';
import { TAB_ROOM, TabBarHiding } from './frame';
import { ask, SignedContext, type Signed } from './people/api';
import { Directory } from './people/directory';
import { EditSection } from './people/edit-section';
import { History } from './people/history';
import { OrgChart } from './people/org-chart';
import { PeopleHome as Home } from './people/home';
import { Inbox } from './people/inbox';
import { Onboarding } from './people/onboarding';
import { PeopleHome } from './people/people-home';
import { Profile } from './people/profile';
import { ReviewChange } from './people/review/change';
import { ReviewAccess, ReviewShare } from './people/review/decide';
import { ReviewDuplicate } from './people/review/duplicate';
import { ReviewId } from './people/review/id-check';
import { Review } from './people/review/review';
import { Export, ExportRecord } from './people/transfer/export';
import { Insights } from './people/insights/insights';
import { ReportHistory, ScheduledReports } from './people/insights/reports';
import { Activity } from './people/settings/activity';
import { Roles } from './people/settings/roles';
import { Settings } from './people/settings/settings';
import { ImportExport } from './people/transfer/hub';
import { Import } from './people/transfer/import';
import { ImportRun } from './people/transfer/run';
import type { PeopleRoutes } from './people/routes';

const Stack_ = createNativeStackNavigator<PeopleRoutes>();

/** "Adam Novak": what they are called, else words from their address. */
const fullName = (person: Person): string =>
  person.name === null
    ? greetingFor(null, person.workEmail)
    : `${person.name.preferred ?? person.name.given} ${person.name.family}`;

type Tab = 'home' | 'people' | 'inbox' | 'me';

/**
 * A tab's own stack: what was pushed in it stays when another tab is chosen
 * and comes back with it. Each is an independent tree because the tab bar,
 * not a navigator, decides which one shows; the bars are Reach's, so the
 * navigator draws no header of its own.
 */
function TabStack({ initial }: { initial: keyof PeopleRoutes }): React.JSX.Element {
  const dark = useColorScheme() === 'dark';
  return (
    <NavigationIndependentTree>
      <NavigationContainer theme={dark ? DarkTheme : DefaultTheme}>
        <Stack_.Navigator initialRouteName={initial} screenOptions={{ headerShown: false }}>
          <Stack_.Screen name="Home" component={Home} />
          <Stack_.Screen name="Inbox" component={Inbox} />
          <Stack_.Screen name="Onboarding" component={Onboarding} />
          <Stack_.Screen name="People" component={PeopleHome} />
          <Stack_.Screen name="Directory" component={Directory} />
          <Stack_.Screen name="OrgChart" component={OrgChart} />
          <Stack_.Screen name="Profile" component={Profile} />
          <Stack_.Screen name="EditSection" component={EditSection} />
          <Stack_.Screen name="History" component={History} />
          <Stack_.Screen name="Review" component={Review} />
          <Stack_.Screen name="ReviewChange" component={ReviewChange} />
          <Stack_.Screen name="ReviewId" component={ReviewId} />
          <Stack_.Screen name="ReviewDuplicate" component={ReviewDuplicate} />
          <Stack_.Screen name="ReviewAccess" component={ReviewAccess} />
          <Stack_.Screen name="ReviewShare" component={ReviewShare} />
          <Stack_.Screen name="ImportExport" component={ImportExport} />
          <Stack_.Screen name="Import" component={Import} />
          <Stack_.Screen name="ImportRun" component={ImportRun} />
          <Stack_.Screen name="Export" component={Export} />
          <Stack_.Screen name="ExportRecord" component={ExportRecord} />
          <Stack_.Screen name="Insights" component={Insights} />
          <Stack_.Screen name="ScheduledReports" component={ScheduledReports} />
          <Stack_.Screen name="ReportHistory" component={ReportHistory} />
          <Stack_.Screen name="Settings" component={Settings} />
          <Stack_.Screen name="Roles" component={Roles} />
          <Stack_.Screen name="Activity" component={Activity} />
        </Stack_.Navigator>
      </NavigationContainer>
    </NavigationIndependentTree>
  );
}

/**
 * Signed in: Home, People and Me under one tab bar, each tab its own stack.
 * Every tab stays mounted, hidden when not chosen, so coming back to one finds
 * it where it was left.
 */
export function SignedIn({
  company,
  sessionId,
  person,
  onSignOut,
  onSignedOut,
  onViewAs,
  onEndViewing,
}: {
  company: Company;
  sessionId: string;
  person: Person;
  onSignOut: () => Promise<void>;
  onSignedOut: () => void;
  onViewAs: (personId: string, reason: string) => Promise<string | null>;
  onEndViewing: () => Promise<void>;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('home');
  const [ending, setEnding] = useState(false);
  // The Inbox tab's count: what waits in Review for this person, as the bell counts it.
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    let live = true;
    const count = (): void => {
      void ask<Readonly<Record<string, number | null>>>(
        {
          company,
          sessionId,
          person,
          signOut: onSignOut,
          signedOut: onSignedOut,
          viewAs: onViewAs,
        },
        'Waiting',
      ).then((answer) => {
        if (!live || !answer.ok) return;
        setWaiting(
          ['changes', 'identifiers', 'duplicates', 'accessRequests', 'exports'].reduce(
            (sum, key) => sum + (answer.data[key] ?? 0),
            0,
          ),
        );
      });
    };
    count();
    const timer = setInterval(count, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [company, sessionId, person, onSignOut, onSignedOut, onViewAs]);
  // How many screens up now want the tab bar gone.
  const [hiding, setHiding] = useState(0);
  const hide = useCallback((hidden: boolean) => {
    setHiding((n) => Math.max(0, n + (hidden ? 1 : -1)));
  }, []);
  const signed = useMemo<Signed>(
    () => ({
      company,
      sessionId,
      person,
      signOut: onSignOut,
      signedOut: onSignedOut,
      viewAs: onViewAs,
    }),
    [company, sessionId, person, onSignOut, onSignedOut, onViewAs],
  );
  const shown = (which: Tab) => ({
    display: tab === which ? ('flex' as const) : ('none' as const),
  });

  return (
    <SignedContext value={signed}>
      <TabBarHiding value={hide}>
        <ToastProvider bottomInset={TAB_ROOM}>
          <View className="flex-1 bg-canvas">
            {person.viewing === null ? null : (
              // While an administrator views the app as somebody: whose it is, and the way back.
              <View style={{ paddingTop: insets.top }} className="bg-canvas">
                <Banner
                  tone="warning"
                  icon={Eye}
                  title={`Viewing as ${fullName(person)}`}
                  actions={
                    <Button
                      size="xs"
                      loading={ending}
                      onPress={() => {
                        setEnding(true);
                        void onEndViewing().finally(() => {
                          setEnding(false);
                        });
                      }}
                    >
                      End viewing
                    </Button>
                  }
                >
                  Read-only. It ends by itself after thirty minutes.
                </Banner>
              </View>
            )}
            <View className="flex-1" style={shown('home')}>
              <TabStack initial="Home" />
            </View>
            <View className="flex-1" style={shown('people')}>
              <TabStack initial="People" />
            </View>
            <View className="flex-1" style={shown('inbox')}>
              <TabStack initial="Inbox" />
            </View>
            <View className="flex-1" style={shown('me')}>
              <TabStack initial="Profile" />
            </View>
            <View
              className="absolute inset-x-2.5"
              style={{ bottom: insets.bottom + 4, display: hiding > 0 ? 'none' : 'flex' }}
            >
              <TabBar
                label="Kithena"
                items={[
                  { key: 'home', label: 'Home', icon: House },
                  { key: 'people', label: 'People', icon: Users },
                  {
                    key: 'inbox',
                    label: 'Inbox',
                    icon: InboxIcon,
                    ...(waiting > 0 ? { badge: waiting } : {}),
                  },
                  { key: 'me', label: 'Me', icon: User },
                ]}
                value={tab}
                onValueChange={(key) => {
                  setTab(key === 'people' || key === 'inbox' || key === 'me' ? key : 'home');
                }}
              />
            </View>
          </View>
        </ToastProvider>
      </TabBarHiding>
    </SignedContext>
  );
}
