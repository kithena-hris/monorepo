import { Card, CardDescription, CardTitle, Stack, TabBar, Text } from '@reach/ui-native';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  NavigationIndependentTree,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { House, User, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Company, Person } from './account';
import { greetingFor } from './address';
import { Page } from './frame';
import { SignedContext, useSigned, type Signed } from './people/api';
import { Directory } from './people/directory';
import { OrgChart } from './people/org-chart';
import { PeopleHome } from './people/people-home';
import { Profile } from './people/profile';
import type { PeopleRoutes } from './people/routes';

const Stack_ = createNativeStackNavigator<PeopleRoutes>();

type Tab = 'home' | 'people' | 'me';

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
          <Stack_.Screen name="People" component={PeopleHome} />
          <Stack_.Screen name="Directory" component={Directory} />
          <Stack_.Screen name="OrgChart" component={OrgChart} />
          <Stack_.Screen name="Profile" component={Profile} />
        </Stack_.Navigator>
      </NavigationContainer>
    </NavigationIndependentTree>
  );
}

/** Home: the greeting, and what is to come on the phone. */
function Dashboard(): React.JSX.Element {
  const { company, person } = useSigned();
  return (
    <Page>
      <Stack gap={1} className="pt-6">
        <Text
          variant="footnote"
          tone="accent"
          weight="semibold"
          className="uppercase tracking-widest"
        >
          {company.displayName ?? company.slug}
        </Text>
        <Text accessibilityRole="header" variant="large">
          {`Hi, ${greetingFor(person.name, person.workEmail)}`}
        </Text>
      </Stack>
      <Card>
        <CardTitle>You are signed in</CardTitle>
        <CardDescription>
          Your time off, your team and your requests will appear here as they come to Kithena on the
          phone. People is in the tab beside this one.
        </CardDescription>
      </Card>
    </Page>
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
}: {
  company: Company;
  sessionId: string;
  person: Person;
  onSignOut: () => Promise<void>;
  onSignedOut: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('home');
  const signed = useMemo<Signed>(
    () => ({ company, sessionId, person, signOut: onSignOut, signedOut: onSignedOut }),
    [company, sessionId, person, onSignOut, onSignedOut],
  );
  const shown = (which: Tab) => ({
    display: tab === which ? ('flex' as const) : ('none' as const),
  });

  return (
    <SignedContext value={signed}>
      <View className="flex-1 bg-canvas">
        <View className="flex-1" style={shown('home')}>
          <Dashboard />
        </View>
        <View className="flex-1" style={shown('people')}>
          <TabStack initial="People" />
        </View>
        <View className="flex-1" style={shown('me')}>
          <TabStack initial="Profile" />
        </View>
        <View className="absolute inset-x-2.5" style={{ bottom: insets.bottom + 4 }}>
          <TabBar
            label="Kithena"
            items={[
              { key: 'home', label: 'Home', icon: House },
              { key: 'people', label: 'People', icon: Users },
              { key: 'me', label: 'Me', icon: User },
            ]}
            value={tab}
            onValueChange={(key) => {
              setTab(key === 'people' || key === 'me' ? key : 'home');
            }}
          />
        </View>
      </View>
    </SignedContext>
  );
}
