import { List, ListItem } from '@reach/ui-native';
import {
  Briefcase,
  FolderOpen,
  Rocket,
  Settings as SettingsIcon,
  Target,
  User,
} from 'lucide-react-native';
import { createContext, useContext } from 'react';

import { Page } from './frame';
import type { PeopleScreen } from './people/routes';

/** Which modules the company has beyond the tabs, as the tab bar learned it. */
export const MoreModules = createContext<{
  readonly recruiting: boolean;
  readonly documents: boolean;
  readonly onboarding: boolean;
  readonly performance: boolean;
}>({
  recruiting: false,
  documents: false,
  onboarding: false,
  performance: false,
});

/**
 * The last tab when a company has more modules than tabs (Recruiting design
 * RM0, Performance PFM0): Recruiting, Documents, Onboarding and Performance
 * side by side, then you.
 */
export function More({ navigation }: PeopleScreen<'More'>): React.JSX.Element {
  const modules = useContext(MoreModules);
  return (
    <Page large="More">
      <List>
        {modules.recruiting ? (
          <ListItem
            icon={Briefcase}
            chevron
            onPress={() => {
              navigation.navigate('Recruiting');
            }}
          >
            Recruiting
          </ListItem>
        ) : null}
        {modules.documents ? (
          <ListItem
            icon={FolderOpen}
            chevron
            onPress={() => {
              navigation.navigate('Documents');
            }}
          >
            Documents
          </ListItem>
        ) : null}
        {modules.onboarding ? (
          <ListItem
            icon={Rocket}
            chevron
            onPress={() => {
              navigation.navigate('OnboardingTasks');
            }}
          >
            Onboarding
          </ListItem>
        ) : null}
        {modules.performance ? (
          <ListItem
            icon={Target}
            chevron
            onPress={() => {
              navigation.navigate('Performance');
            }}
          >
            Performance
          </ListItem>
        ) : null}
      </List>
      <List>
        <ListItem
          icon={User}
          chevron
          onPress={() => {
            navigation.navigate('Profile');
          }}
        >
          Profile
        </ListItem>
        <ListItem
          icon={SettingsIcon}
          chevron
          onPress={() => {
            navigation.navigate('Settings');
          }}
        >
          Settings
        </ListItem>
      </List>
    </Page>
  );
}
