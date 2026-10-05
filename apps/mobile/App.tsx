import { Button, Text } from '@reach/ui-native';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';

import './global.css';

/**
 * Dark mode is the web's mechanism: a `dark` class on an ancestor re-points
 * the `--reach-color-*` variables for everything under it.
 */
export default function App(): React.JSX.Element {
  const [dark, setDark] = useState(false);
  return (
    <View className={dark ? 'dark flex-1' : 'flex-1'}>
      <View className="flex-1 justify-center gap-4 bg-canvas px-4">
        <Text variant="large">Time off</Text>
        <Text>Body text at 17 over 22.</Text>
        <Text variant="headline">Headline at 17 over 22, semibold</Text>
        <Button onPress={() => setDark(!dark)}>{dark ? 'Light mode' : 'Dark mode'}</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="tinted" size="sm">
          Tinted small
        </Button>
        <Button variant="danger" loading>
          Deleting
        </Button>
      </View>
      <StatusBar style={dark ? 'light' : 'dark'} />
    </View>
  );
}
