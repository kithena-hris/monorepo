import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  List,
  ListItem,
  Stack,
  Text,
} from '@reach/ui-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Building2, CalendarDays, EyeOff, LogOut, Moon, Settings, User } from 'lucide-react-native';
import { createContext, useContext, useState } from 'react';
import { useColorScheme } from 'react-native';

import type { Person } from './account';
import { greetingFor } from './address';
import { setLook } from './appearance';
import { useSigned } from './people/api';
import type { PeopleRoutes } from './people/routes';

/** "Adam Novak": what they are called, else words from their address. */
export const fullName = (person: Person): string =>
  person.name === null
    ? greetingFor(null, person.workEmail)
    : `${person.name.preferred ?? person.name.given} ${person.name.family}`;

/** What the account menu does beyond the screen it is on: the tab bar's and the app's. */
export interface AccountActions {
  /** Shows the Me tab, or the Time off tab. */
  readonly open: (tab: 'me' | 'timeoff') => void;
  /** Whether the company has Time Off, so My time off has somewhere to go. */
  readonly timeOff: boolean;
  /** Signs out and asks for another company's address. */
  readonly changeCompany: () => Promise<void>;
  /** While viewing as somebody: back to the administrator's own session. */
  readonly endViewing: (() => Promise<void>) | null;
}

export const AccountActionsContext = createContext<AccountActions | null>(null);

/**
 * The account menu (design A3), under the avatar beside each tab's large
 * title: your profile, your time off, Settings, dark mode, another company,
 * and the way out. While viewing as somebody, the way back comes first.
 */
export function AccountMenu(): React.JSX.Element | null {
  const { company, person, signOut } = useSigned();
  const actions = useContext(AccountActionsContext);
  const navigation = useNavigation<NativeStackNavigationProp<PeopleRoutes>>();
  const dark = useColorScheme() === 'dark';
  if (actions === null) return null;
  const name = fullName(person);
  const companyName = company.displayName ?? company.slug;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button size="sm" startIcon={<Icon icon={User} />} accessibilityLabel="Your account" />
      </DropdownMenuTrigger>
      <DropdownMenuContent label="Your account" align="end" className="w-[300px]">
        {actions.endViewing === null ? null : (
          <>
            <DropdownMenuItem
              icon={EyeOff}
              onSelect={() => {
                void actions.endViewing?.();
              }}
            >
              {`End viewing as ${name}`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          lead={<Avatar name={name} size={32} decorative />}
          description={companyName}
        >
          {name}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={User}
          onSelect={() => {
            actions.open('me');
          }}
        >
          My profile
        </DropdownMenuItem>
        {actions.timeOff ? (
          <DropdownMenuItem
            icon={CalendarDays}
            onSelect={() => {
              actions.open('timeoff');
            }}
          >
            My time off
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          icon={Settings}
          onSelect={() => {
            navigation.navigate('Settings');
          }}
        >
          Settings
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          icon={Moon}
          checked={dark}
          onCheckedChange={(on) => {
            setLook(on ? 'dark' : 'light');
          }}
        >
          Dark mode
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem
          icon={Building2}
          description={companyName}
          onSelect={() => {
            void actions.changeCompany();
          }}
        >
          Switch company
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={LogOut}
          destructive
          onSelect={() => {
            void signOut();
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Under your own record, in the Me tab: where you are signed in, Settings, and the way out. */
export function Account({ onSettings }: { onSettings: () => void }): React.JSX.Element {
  const { company, person, signOut } = useSigned();
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
    <Stack gap={3}>
      <List>
        <ListItem trailing={<Text tone="muted">{company.displayName ?? company.slug}</Text>}>
          Company
        </ListItem>
        {person.workEmail === null ? null : (
          <ListItem trailing={<Text tone="muted">{person.workEmail}</Text>}>Work email</ListItem>
        )}
        {until === null ? null : (
          <ListItem trailing={<Text tone="muted">{until}</Text>}>Signed in until</ListItem>
        )}
      </List>
      <List>
        <ListItem
          icon={Settings}
          description="Your company’s, and your own"
          chevron
          onPress={onSettings}
        >
          Settings
        </ListItem>
      </List>
      <Button
        variant="danger-soft"
        fullWidth
        loading={busy}
        loadingLabel="Signing out"
        onPress={() => {
          setBusy(true);
          void signOut();
        }}
      >
        Sign out
      </Button>
    </Stack>
  );
}
