import { Button, List, ListItem, Stack, Text } from '@reach/ui-native';
import { useState } from 'react';

import { useSigned } from './people/api';

/** Under your own record, in the Me tab: where you are signed in, and the way out. */
export function Account(): React.JSX.Element {
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
