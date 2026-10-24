import { LANGUAGES } from '@kithena/contracts/language';
import { Icon, List, ListItem } from '@reach/ui-native';
import { Check } from 'lucide-react-native';
import { useSyncExternalStore } from 'react';

import { Page } from './frame';
import { language, onLanguage, t } from './i18n';
import { saveLanguage } from './language-store';
import type { PeopleScreen } from './people/routes';

/**
 * Me › Language: the language this phone's screens are in, each named in
 * itself, so somebody who reads only Polish finds "Polski" in a German list.
 * Until somebody chooses, the company's language is used.
 */
export function LanguageSettings({ navigation }: PeopleScreen<'Language'>): React.JSX.Element {
  const current = useSyncExternalStore(onLanguage, language);
  return (
    <Page
      title={t('language.title', 'Language')}
      back={{ label: t('language.back', 'Back'), onPress: navigation.goBack }}
    >
      <List>
        {LANGUAGES.map((l) => (
          <ListItem
            key={l.code}
            selected={l.code === current}
            trailing={l.code === current ? <Icon icon={Check} /> : null}
            onPress={() => {
              saveLanguage(l.code);
            }}
          >
            {l.name}
          </ListItem>
        ))}
      </List>
    </Page>
  );
}
