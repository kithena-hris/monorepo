import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Icon,
  Input,
  KeyValues,
  ListItem,
  Sentence,
  Switch,
  Text,
  Textarea,
} from '@reach/ui-native';
import { Check, EyeOff, Sparkles, Users } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useAct } from '../act';
import {
  approvalByDefault,
  AUDIENCES,
  CLASSIFICATION,
  COLLECT,
  DATA_TYPE_LABEL,
  draftFrom,
  type Draft,
  type Registry,
  type RegistryField,
  type RegistrySection,
  type ViewerScope,
  type WriterRole,
} from './fields-model';
import { draftInput } from './field-editor';
import { changeFrom, describedField, fieldSentence, seersOf } from './sentences';

type Part = 'who' | 'see' | 'asked' | 'kind';

const WRITERS: readonly { id: WriterRole; label: string }[] = [
  { id: 'employee', label: 'The employee' },
  { id: 'manager', label: 'Their manager' },
  { id: 'hr', label: 'HR' },
  { id: 'finance', label: 'Finance' },
];

/** The sentence, its parts tappable, and the choices of the open one right under it (S4, S5). */
function FieldWords({
  draft,
  set,
  fixed,
}: {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  /** Built in: what it holds is fixed, so its sensitivity is too. */
  fixed: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState<Part | null>(null);
  const words = fieldSentence(draft);
  const kind = CLASSIFICATION.find((c) => c.value === draft.classification);
  const toggle = <T,>(list: readonly T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  const choices: { label: string; on: boolean; pick: () => void }[] =
    open === 'who'
      ? WRITERS.map((w) => ({
          label: w.label,
          on: draft.ownership.includes(w.id),
          pick: () => {
            set({ ownership: toggle(draft.ownership, w.id) });
          },
        }))
      : open === 'see'
        ? AUDIENCES.map((a) => ({
            label: a.label,
            on: draft.visibility.includes(a.id),
            pick: () => {
              set({ visibility: toggle<ViewerScope>(draft.visibility, a.id) });
            },
          }))
        : open === 'asked'
          ? COLLECT.map((c) => ({
              label: c.label,
              on: draft.collectAt === c.value,
              pick: () => {
                set({ collectAt: c.value });
              },
            }))
          : open === 'kind'
            ? CLASSIFICATION.map((c) => ({
                label: c.label,
                on: draft.classification === c.value,
                pick: () => {
                  set({
                    classification: c.value,
                    confirmedSpecial: c.value === 'special-category',
                  });
                },
              }))
            : [];
  return (
    <>
      <Sentence
        onPartPress={(id) => {
          setOpen((was) => (was === id ? null : (id as Part)));
        }}
        parts={[
          { id: 'who', text: words.who, active: open === 'who' },
          ' fills it in. ',
          { id: 'see', text: words.see, active: open === 'see' },
          ' can see it. ',
          ...(draft.collectAt === 'hr_only'
            ? ['Nobody is asked for it ', { id: 'asked', text: 'until HR adds it', active: open === 'asked' }, '. ']
            : ['People are asked for it ', { id: 'asked', text: words.asked, active: open === 'asked' }, '. ']),
          'It’s ',
          {
            id: 'kind',
            text: kind?.label.toLowerCase() ?? 'not classified yet',
            active: open === 'kind',
            disabled: fixed,
          },
          '.',
        ]}
      />
      {open === null ? (
        <Text variant="footnote" tone="subtle">
          Tap any highlighted part to change it.
        </Text>
      ) : (
        <Card variant="elevated" padded={false} className="overflow-hidden">
          {choices.map((c) => (
            <ListItem
              key={c.label}
              listitem={false}
              leading={
                <View className="w-4">{c.on ? <Icon icon={Check} size={16} tone="accent" /> : null}</View>
              }
              onPress={c.pick}
            >
              {c.label}
            </ListItem>
          ))}
        </Card>
      )}
    </>
  );
}

/**
 * Editing a field (design v3 S4, S5): the four-step wizard as one sentence,
 * each highlighted part a choice. The preview and the rarer options sit
 * underneath; the full editor is one of them.
 */
export function FieldSentenceDialog({
  section,
  field,
  onClose,
  onSaved,
  onMore,
}: {
  section: RegistrySection;
  field: RegistryField;
  onClose: () => void;
  onSaved: () => void;
  /** The full editor: name, help text, type, rules. */
  onMore: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(section, field));
  const builtIn = field.origin !== 'tenant';
  const forced = approvalByDefault(draft.dataType, field.piiKind);
  const set = (patch: Partial<Draft>): void => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{field.label}</DialogTitle>
          <DialogDescription>
            {builtIn
              ? 'Built into Kithena, so its type is fixed.'
              : `${DATA_TYPE_LABEL[field.dataType] ?? field.dataType} · ${section.label}`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 480 }} contentContainerClassName="gap-4">
            <FieldWords draft={draft} set={set} fixed={builtIn} />
            <Card variant="fill">
              <Text variant="footnote" tone="subtle">
                How it looks on a form
              </Text>
              <Field>
                <FieldLabel>{draft.label}</FieldLabel>
                <Input value="" onChange={() => undefined} disabled placeholder={draft.description || ' '} />
              </Field>
            </Card>
            <Card padded={false} className="overflow-hidden">
              <ListItem
                listitem={false}
                description={`${field.label}${field.description === null ? ' · no help text' : ''}`}
                chevron
                onPress={onMore}
              >
                Name and help text
              </ListItem>
              <ListItem listitem={false} description={field.key}>
                Key for integrations
              </ListItem>
              <ListItem
                listitem={false}
                trailing={
                  <Switch
                    checked={forced || (draft.requiresApproval ?? false)}
                    disabled={forced}
                    accessibilityLabel="Changes need a second approval"
                    onCheckedChange={(on) => {
                      set({ requiresApproval: on });
                    }}
                  />
                }
              >
                Changes need a second approval
              </ListItem>
            </Card>
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={draft.ownership.length === 0 || draft.visibility.length === 0}
            loading={busy === 'SaveDraftField'}
            onPress={() => {
              void act(
                'SaveDraftField',
                {
                  input: draftInput(draft, field.piiKind, 'human', field.encrypted === true || forced),
                  editing: field.key,
                },
                'Saved to the draft',
              ).then((done) => {
                if (done !== null) onSaved();
              });
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A new field, described (design v3 S6): Kithena drafts the name, the answer
 * type and who sees it from a sentence, and you check one sentence, not a
 * form. Change opens the full editor on the draft.
 */
export function NewFieldDialog({
  registry,
  initial,
  onClose,
  onSaved,
  onChange,
}: {
  registry: Registry;
  initial: string;
  onClose: () => void;
  onSaved: () => void;
  /** The full editor, for what a sentence cannot say. */
  onChange: (section: RegistrySection) => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [text, setText] = useState(initial);
  const described = describedField(text);
  const section =
    registry.sections.find((s) => /misc|other|additional/iu.test(s.label) && !s.fixed) ??
    registry.sections.find((s) => !s.fixed) ??
    registry.sections[0];
  const [draft, setDraft] = useState<Draft | null>(null);
  const base: Draft | null =
    section === undefined
      ? null
      : {
          ...draftFrom(section, null),
          label: described.label,
          key: described.key,
          dataType: described.dataType,
          options: described.options,
          collectAt: described.collectAt,
          ownership: described.ownership,
          visibility: described.visibility,
          classification: 'internal',
        };
  const shown = draft ?? base;
  const taken = registry.fields.some((f) => f.key === shown?.key);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New field</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 500 }} contentContainerClassName="gap-4">
            <Textarea
              value={text}
              onChange={(t) => {
                setText(t);
                setDraft(null);
              }}
              placeholder="T-shirt size for the offsite, S to XXL. People fill it in during onboarding; only HR needs it."
              accessibilityLabel="Describe the field"
            />
            {shown === null || !described.understood ? null : (
              <Card variant="assistant" className="gap-3">
                <View className="flex-row items-center gap-2">
                  <Icon icon={Sparkles} size={16} tone="accent" />
                  <Text variant="headline">Here’s the field</Text>
                </View>
                <KeyValues
                  layout="stacked"
                  items={[
                    { label: 'Name', value: shown.label },
                    {
                      label: 'Answer',
                      value:
                        shown.options.length > 0
                          ? `One of ${shown.options.join(', ')}`
                          : (DATA_TYPE_LABEL[shown.dataType] ?? shown.dataType),
                    },
                    { label: 'Section', value: section?.label ?? '' },
                  ]}
                />
                <FieldWords
                  draft={shown}
                  set={(patch) => {
                    setDraft({ ...shown, ...patch });
                  }}
                  fixed={false}
                />
                {taken ? (
                  <Text variant="footnote" tone="danger">
                    A field with this name exists already. Change the name.
                  </Text>
                ) : null}
              </Card>
            )}
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button
            className="flex-1"
            disabled={section === undefined}
            onPress={() => {
              if (section !== undefined) onChange(section);
            }}
          >
            Change
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={shown === null || !described.understood || taken}
            loading={busy === 'SaveDraftField'}
            onPress={() => {
              if (shown === null) return;
              void act(
                'SaveDraftField',
                { input: draftInput(shown, 'none', 'human', false), editing: null },
                'Added to the draft',
              ).then((done) => {
                if (done !== null) onSaved();
              });
            }}
          >
            {registry.published === null
              ? 'Add to the draft'
              : `Add to version ${String(registry.published.version + 1)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
          I couldn’t tell which setting that is. Try “let managers see salary” or “make job title
          required”, or open the setting below.
        </Text>
        <Button size="sm" variant="ghost" onPress={onDismiss}>
          Dismiss
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
            ...new Set([...before.visibility.filter((v) => !change.remove.includes(v)), ...change.add]),
          ],
        };
  return (
    <Card variant="assistant" className="gap-3">
      <View className="flex-row items-center gap-2">
        <Icon icon={Sparkles} size={16} tone="accent" />
        <Text variant="headline" className="flex-1">{`This changes 1 field: ${field.label}`}</Text>
      </View>
      {change.kind === 'see' ? (
        <View className="gap-1">
          <Text variant="footnote" tone="subtle">
            Who can see it
          </Text>
          <Text tone="muted" className="line-through">
            {seersOf(before.visibility)}
          </Text>
          <Text variant="headline">{seersOf(after.visibility)}</Text>
        </View>
      ) : (
        <View className="gap-1">
          <Text variant="footnote" tone="subtle">
            Required
          </Text>
          <Text tone="muted" className="line-through">
            {before.requiredness === 'never' ? 'Optional' : 'Required'}
          </Text>
          <Text variant="headline">{change.required ? 'Required' : 'Optional'}</Text>
        </View>
      )}
      {change.kind === 'see' && change.add.includes('manager') ? (
        <ListItem listitem={false} icon={Users} description="Each manager sees only their own reports." className="bg-transparent px-0">
          Managers, for their reports
        </ListItem>
      ) : null}
      {field.encrypted === true ? (
        <ListItem
          listitem={false}
          icon={EyeOff}
          description="Shown masked until somebody taps Show; every view is logged."
          className="bg-transparent px-0"
        >
          Still masked
        </ListItem>
      ) : null}
      <View className="flex-row gap-2">
        <Button className="flex-1" size="sm" onPress={onDismiss}>
          Not now
        </Button>
        <Button
          className="flex-1"
          size="sm"
          variant="primary"
          loading={busy === 'SaveDraftField'}
          onPress={() => {
            void act(
              'SaveDraftField',
              { input: draftInput(after, field.piiKind, 'human', field.encrypted === true), editing: field.key },
              'Saved as a draft',
            ).then((done) => {
              if (done !== null) onDone();
            });
          }}
        >
          Save as draft
        </Button>
      </View>
      <Text variant="footnote" tone="subtle">
        {`Drafts go into version ${String((registry.published?.version ?? 0) + 1)}. Nothing changes until you publish.`}
      </Text>
    </Card>
  );
}
