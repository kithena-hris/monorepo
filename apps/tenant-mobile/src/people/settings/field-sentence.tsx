import { Button, Card, Icon, ListItem, Text } from '@reach/ui-native';
import { EyeOff, Sparkles, Users } from 'lucide-react-native';
import { View } from 'react-native';

import { useAct } from '../act';
import { draftFrom, type Draft, type Registry } from './fields-model';
import { draftInput } from './field-editor';
import { changeFrom, seersOf } from './sentences';
import { t } from '../../i18n';

/**
 * A setting changed by asking (design v3 S2): the field it found, before and
 * after, and who it affects, saved as a draft. Nothing changes until the
 * draft is published.
 */
export function AskedChange({
  registry,
  sentence,
  onDone,
  onDismiss,
}: {
  registry: Registry;
  sentence: string;
  onDone: () => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const change = changeFrom(sentence, registry.fields);
  const field = change === null ? undefined : registry.fields.find((f) => f.key === change.key);
  const section = registry.sections.find((s) => s.key === field?.sectionKey);
  if (change === null || field === undefined || section === undefined) {
    return (
      <Card variant="assistant">
        <Text>
          {t(
            'people.settings.field-sentence.i_couldnt_tell_which_setting_that',
            'I couldn’t tell which setting that is. Try “let managers see salary” or “make job title required”, or open the setting below.',
          )}
        </Text>
        <Button size="sm" variant="ghost" onPress={onDismiss}>
          {t('people.settings.field-sentence.dismiss', 'Dismiss')}
        </Button>
      </Card>
    );
  }
  const before = draftFrom(section, field);
  const after: Draft =
    change.kind === 'required'
      ? { ...before, requiredness: change.required ? 'always' : 'never' }
      : {
          ...before,
          visibility: [
            ...new Set([
              ...before.visibility.filter((v) => !change.remove.includes(v)),
              ...change.add,
            ]),
          ],
        };
  return (
    <Card variant="assistant" className="gap-3">
      <View className="flex-row items-center gap-2">
        <Icon icon={Sparkles} size={16} tone="accent" />
        <Text variant="headline" className="flex-1">
          {t(
            'people.settings.field-sentence.this_changes_1_field',
            'This changes 1 field: {{label}}',
            { label: field.label },
          )}
        </Text>
      </View>
      {change.kind === 'see' ? (
        <View className="gap-1">
          <Text variant="footnote" tone="subtle">
            {t('people.settings.field-sentence.who_can_see_it', 'Who can see it')}
          </Text>
          <Text tone="muted" className="line-through">
            {seersOf(before.visibility)}
          </Text>
          <Text variant="headline">{seersOf(after.visibility)}</Text>
        </View>
      ) : (
        <View className="gap-1">
          <Text variant="footnote" tone="subtle">
            {t('people.settings.field-sentence.required', 'Required')}
          </Text>
          <Text tone="muted" className="line-through">
            {before.requiredness === 'never'
              ? t('people.settings.field-sentence.optional', 'Optional')
              : t('people.settings.field-sentence.required', 'Required')}
          </Text>
          <Text variant="headline">
            {change.required
              ? t('people.settings.field-sentence.required', 'Required')
              : t('people.settings.field-sentence.optional', 'Optional')}
          </Text>
        </View>
      )}
      {change.kind === 'see' && change.add.includes('manager') ? (
        <ListItem
          listitem={false}
          icon={Users}
          description={t(
            'people.settings.field-sentence.each_manager_sees_only_their_own',
            'Each manager sees only their own reports.',
          )}
          className="bg-transparent px-0"
        >
          {t(
            'people.settings.field-sentence.managers_for_their_reports',
            'Managers, for their reports',
          )}
        </ListItem>
      ) : null}
      {field.encrypted === true ? (
        <ListItem
          listitem={false}
          icon={EyeOff}
          description="Shown masked until somebody taps Show; every view is logged."
          className="bg-transparent px-0"
        >
          {t('people.settings.field-sentence.still_masked', 'Still masked')}
        </ListItem>
      ) : null}
      <View className="flex-row gap-2">
        <Button className="flex-1" size="sm" onPress={onDismiss}>
          {t('people.settings.field-sentence.not_now', 'Not now')}
        </Button>
        <Button
          className="flex-1"
          size="sm"
          variant="primary"
          loading={busy === 'SaveDraftField'}
          onPress={() => {
            void act(
              'SaveDraftField',
              {
                input: draftInput(after, field.piiKind, 'human', field.encrypted === true),
                editing: field.key,
              },
              t('people.settings.field-sentence.saved_as_a_draft', 'Saved as a draft'),
            ).then((done) => {
              if (done !== null) onDone();
            });
          }}
        >
          {t('people.settings.field-sentence.save_as_draft', 'Save as draft')}
        </Button>
      </View>
      <Text variant="footnote" tone="subtle">
        {t(
          'people.settings.field-sentence.drafts_go_into_version_nothing_changes',
          'Drafts go into version {{String}}. Nothing changes until you publish.',
          { String: String((registry.published?.version ?? 0) + 1) },
        )}
      </Text>
    </Card>
  );
}
