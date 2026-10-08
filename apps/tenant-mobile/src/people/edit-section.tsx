import { Alert, Button, Stack, Text, useToast } from '@reach/ui-native';
import { useMemo, useState } from 'react';

import { Failed, Loading, Page } from '../frame';
import { AttributeInput } from './attribute-input';
import {
  ask,
  formInputs,
  isEmpty,
  sameValue,
  useRead,
  useSigned,
  valuesOf,
  type Entry,
  type Finding,
  type RecordField,
  type Value,
} from './api';
import type { PeopleScreen } from './routes';

interface SectionData {
  readonly person: { readonly name: string };
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly fields: readonly RecordField[];
  }[];
  readonly values: readonly Entry[];
}

/** Values a save is checked for first (PEO-125): the identifiers People validates. */
const CHECKED = new Set(['national_id', 'bank_account']);

/**
 * Editing one section of a record (design D3), the viewer's own or, for HR
 * and managers, somebody else's: what they may change is a control, the rest
 * says who changes it. Save is pinned above the keyboard.
 *
 * An identifier is checked before it is saved. When the checks doubt it, the
 * doubt is said under the field and the button becomes "Save anyway": the
 * person may know better, and HR reviews it either way. Some changes wait for
 * HR's approval instead of saving (PEO-077); the toast says which.
 */
export function EditSection({ navigation, route }: PeopleScreen<'EditSection'>): React.JSX.Element {
  const { personId, sectionKey, back } = route.params;
  const signed = useSigned();
  const { toast } = useToast();
  const { load, reload } = useRead<SectionData>('Profile', { personId: personId ?? null });
  const [draft, setDraft] = useState<Readonly<Record<string, Value>>>({});
  const [warnings, setWarnings] = useState<readonly Finding[] | null>(null);
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const section =
    load.status === 'ready' ? load.data.sections.find((s) => s.key === sectionKey) : undefined;
  const original = useMemo(
    () => (load.status === 'ready' ? valuesOf(load.data.values) : {}),
    [load],
  );
  const valueOf = (key: string): Value | undefined => (key in draft ? draft[key] : original[key]);
  const changed = Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => !sameValue(value, original[key])),
  );
  const dirty = Object.keys(changed).length > 0;

  const save = async (): Promise<void> => {
    if (section === undefined) return;
    // A required field emptied here is refused before anything is sent.
    const emptied = Object.fromEntries(
      section.fields
        .filter((f) => f.required && f.key in changed && isEmpty(changed[f.key]))
        .map((f) => [f.key, `${f.label} is required.`]),
    );
    setProblems(emptied);
    if (Object.keys(emptied).length > 0) return;

    setSaving(true);
    setFailed(null);
    const inputs = formInputs(changed);
    if (
      warnings === null &&
      section.fields.some((f) => CHECKED.has(f.dataType) && f.key in changed)
    ) {
      const checked = await ask<{ findings: Finding[] }>(signed, 'IdentifierCheck', {
        personId: personId ?? null,
        changed: inputs,
      });
      if (checked.ok && checked.data.findings.length > 0) {
        setWarnings(checked.data.findings);
        setSaving(false);
        return;
      }
    }
    const answer = await ask<{ ok: boolean; held: readonly string[] | null }>(
      signed,
      personId === undefined ? 'SaveOwnSection' : 'SavePersonSection',
      personId === undefined ? { changed: inputs } : { personId, changed: inputs },
    );
    setSaving(false);
    if (!answer.ok) {
      setFailed(answer.message);
      return;
    }
    const held = answer.data.held ?? [];
    toast(
      held.length === 0
        ? { title: 'Saved', tone: 'success' }
        : {
            title: 'Sent to HR for approval',
            description: `${held.join(', ')} change when HR approves.`,
            tone: 'info',
          },
    );
    navigation.goBack();
  };

  const foot =
    load.status === 'ready' && section !== undefined ? (
      <>
        <Button className="flex-1" fullWidth onPress={navigation.goBack} disabled={saving}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          fullWidth
          variant="primary"
          disabled={!dirty}
          loading={saving}
          loadingLabel="Saving"
          onPress={() => void save()}
        >
          {warnings !== null && warnings.length > 0 ? 'Save anyway' : 'Save'}
        </Button>
      </>
    ) : undefined;

  return (
    <Page
      {...(section === undefined ? {} : { title: section.label })}
      back={{ label: back, onPress: navigation.goBack }}
      {...(foot === undefined ? {} : { foot })}
    >
      {load.status === 'loading' ? (
        <Loading label="Loading the section" />
      ) : load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : section === undefined ? (
        <Text tone="muted">This section is not on the record any more.</Text>
      ) : (
        <Stack gap={5}>
          {failed === null ? null : (
            <Alert tone="danger" title="That was not saved">
              {failed}
            </Alert>
          )}
          {section.fields.map((field) => (
            <AttributeInput
              key={field.key}
              field={field}
              value={valueOf(field.key)}
              onChange={(value) => {
                setDraft((d) => ({ ...d, [field.key]: value }));
                // A changed identifier is checked again before it saves.
                if (CHECKED.has(field.dataType)) setWarnings(null);
              }}
              warning={warnings?.find((w) => w.key === field.key)?.message}
              problem={problems[field.key]}
            />
          ))}
        </Stack>
      )}
    </Page>
  );
}
