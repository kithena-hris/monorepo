import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ListItem,
  locale,
  Spinner,
  Stat,
  Text,
} from '@reach/ui-native';
import * as DocumentPicker from 'expo-document-picker';
import { FileSpreadsheet } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { ask, useSigned } from '../api';
import { blobOf, put, type Target } from '../media';
import { parsed } from '../review/load';
import { mappingOf, type MapStage, type Mapping, type NewFieldsView, type PlanView } from './model';
import { t } from '../../i18n';

/**
 * Importing people in a centred modal (design v3 P8): drop a spreadsheet,
 * Kithena maps the columns and asks only about the ones it isn't sure of,
 * then the dry run's counts and Import. Nothing is written until Import.
 * Columns that aren't fields yet are left out here; the full import, a tap
 * away, designs them.
 */
export function ImportDialog({
  onClose,
  onStarted,
  onFull,
  onHistory,
}: {
  onClose: () => void;
  onStarted: (runId: string) => void;
  /** The full import, for new fields and workplaces. */
  onFull: () => void;
  /** Imports and exports before this one. */
  onHistory: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [stage, setStage] = useState<MapStage | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [answered, setAnswered] = useState<readonly number[]>([]);
  const [fields, setFields] = useState<NewFieldsView | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);

  const fail = (message: string): void => {
    setBusy(null);
    setProblem(message);
  };
  const stepOf = (mapped: Mapping) => ({
    uploadId,
    mapping: Object.fromEntries(Object.entries(mapped)),
  });

  const pick = async (): Promise<void> => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        'text/csv',
        'text/comma-separated-values',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ],
      copyToCacheDirectory: true,
    });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (asset === undefined) return;
    setBusy('upload');
    setProblem(null);
    setPlan(null);
    setAnswered([]);
    const body = await blobOf(asset.uri);
    if (body.size > 100 * 1024 * 1024) {
      fail(t('people.transfer.import-dialog.a_file_can_be_up_to', 'A file can be up to 100 MB.'));
      return;
    }
    const target = await ask<Target>(signed, 'StartImportUpload', {
      name: asset.name.slice(0, 255),
      size: body.size,
    });
    if (!target.ok) {
      fail(target.message);
      return;
    }
    if (!(await put(target.data, body))) {
      fail('The upload did not go through; try again.');
      return;
    }
    const done = await ask<MapStage>(signed, 'CompleteImportUpload', {
      uploadId: target.data.uploadId,
    });
    if (!done.ok) {
      fail(done.message);
      return;
    }
    setUploadId(target.data.uploadId);
    setStage(done.data);
    const mapped = mappingOf(done.data.columns);
    setMapping(mapped);
    setBusy(null);
    if (!done.data.columns.some((c) => c.status === 'review'))
      void planWith(target.data.uploadId, mapped);
  };

  /** The new-field step, every proposal left out, then the dry run. */
  const planWith = async (upload: string | null, mapped: Mapping): Promise<void> => {
    setBusy('plan');
    const step = { uploadId: upload, mapping: Object.fromEntries(Object.entries(mapped)) };
    const proposed = await ask<string>(signed, 'ProposeImportFields', {
      step: JSON.stringify(step),
    });
    if (!proposed.ok) {
      fail(proposed.message);
      return;
    }
    const view = parsed(proposed.data) as NewFieldsView | null;
    if (view === null) {
      fail(
        t(
          'people.transfer.import-dialog.people_answered_in_a_way_this',
          'People answered in a way this screen cannot read.',
        ),
      );
      return;
    }
    setFields(view);
    const proposals = view.proposals.map((p) => ({ ...p, include: false }));
    const planned = await ask<string>(signed, 'PlanImport', {
      input: JSON.stringify({ ...step, proposals, places: {} }),
    });
    if (!planned.ok) {
      fail(planned.message);
      return;
    }
    const p = parsed(planned.data) as PlanView | null;
    if (p === null) {
      fail(
        t(
          'people.transfer.import-dialog.people_answered_in_a_way_this',
          'People answered in a way this screen cannot read.',
        ),
      );
      return;
    }
    setPlan(p);
    setBusy(null);
  };

  const run = async (): Promise<void> => {
    if (plan === null) return;
    setBusy('run');
    const answer = await ask<string>(signed, 'RunImport', {
      input: JSON.stringify({
        ...stepOf(mapping),
        proposals: (fields?.proposals ?? []).map((p) => ({ ...p, include: false })),
        places: {},
        basedOn: plan.basedOn ?? plan.version,
      }),
    });
    if (!answer.ok) {
      fail(answer.message);
      return;
    }
    const ran = parsed(answer.data) as { runId?: string } | null;
    if (typeof ran?.runId !== 'string') {
      fail(
        t(
          'people.transfer.import-dialog.the_import_did_not_start_try',
          'The import did not start. Try again.',
        ),
      );
      return;
    }
    onStarted(ran.runId);
  };

  const unsure = (stage?.columns ?? []).filter(
    (c) => c.status === 'review' && !answered.includes(c.index),
  );
  const question = unsure[0];
  const fieldLabel = (key: string | null): string =>
    stage?.fields.find((f) => f.key === key)?.label.toLowerCase() ?? 'a field';
  const answer = (keep: boolean): void => {
    if (question === undefined) return;
    const mapped = keep ? mapping : { ...mapping, [question.index]: null };
    setMapping(mapped);
    const done = [...answered, question.index];
    setAnswered(done);
    if (unsure.length === 1) void planWith(uploadId, mapped);
  };
  const matched = stage === null ? 0 : stage.columns.filter((c) => c.status === 'mapped').length;
  const counts = plan?.review.dryRun.counts;
  const toImport = counts === undefined ? 0 : counts.create + counts.update;
  const leftOut = (fields?.proposals ?? []).length;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('people.transfer.import-dialog.import_people', 'Import people')}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          {problem === null ? null : (
            <Alert
              tone="danger"
              title={t('people.transfer.import-dialog.that_did_not_work', 'That did not work')}
            >
              {problem}
            </Alert>
          )}
          <Card variant="fill" padded={false}>
            <ListItem
              listitem={false}
              icon={FileSpreadsheet}
              iconTone={2}
              className="bg-transparent"
              {...(stage === null
                ? {
                    description: t(
                      'people.transfer.import-dialog.excel_or_csv_one_person_a',
                      'Excel or CSV, one person a row',
                    ),
                  }
                : {
                    description: t(
                      'people.transfer.import-dialog.rows_columns',
                      '{{toLocaleString}} rows · {{String}} columns',
                      {
                        toLocaleString: stage.file.rows.toLocaleString(locale()),
                        String: String(stage.columns.length),
                      },
                    ),
                  })}
              trailing={
                <Button
                  size="sm"
                  variant="link"
                  loading={busy === 'upload'}
                  onPress={() => void pick()}
                >
                  {stage === null
                    ? t('people.transfer.import-dialog.choose', 'Choose')
                    : t('people.transfer.import-dialog.change', 'Change')}
                </Button>
              }
            >
              {stage?.file.name ??
                t('people.transfer.import-dialog.choose_a_spreadsheet', 'Choose a spreadsheet')}
            </ListItem>
          </Card>
          {stage === null ? null : (
            <Card variant="assistant">
              <Text variant="headline">
                {t(
                  'people.transfer.import-dialog.matched_of_columns',
                  'Matched {{String}} of {{String2}} columns',
                  { String: String(matched), String2: String(stage.columns.length) },
                )}
              </Text>
              {question === undefined ? (
                <Text variant="subhead" tone="muted">
                  {stage.columns.some((c) => c.status === 'refused')
                    ? t(
                        'people.transfer.import-dialog.columns_it_cant_read_are_left',
                        'Columns it can’t read are left out.',
                      )
                    : t('people.transfer.import-dialog.nothing_needs_you', 'Nothing needs you.')}
                </Text>
              ) : (
                <View className="gap-2">
                  <Text variant="subhead" tone="muted">
                    {unsure.length === 1
                      ? t('people.transfer.import-dialog.one_needs_you', 'One needs you:')
                      : t('people.transfer.import-dialog.need_you', '{{String}} need you:', {
                          String: String(unsure.length),
                        })}
                  </Text>
                  <Text weight="semibold">
                    {t(
                      'people.transfer.import-dialog.is_the',
                      'Is “{{header}}” the {{fieldLabel}}?',
                      {
                        header: question.header,
                        fieldLabel: fieldLabel(mapping[question.index] ?? question.key),
                      },
                    )}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="tinted"
                      onPress={() => {
                        answer(true);
                      }}
                    >
                      {t('people.transfer.import-dialog.yes', 'Yes, {{fieldLabel}}', {
                        fieldLabel: fieldLabel(mapping[question.index] ?? question.key),
                      })}
                    </Button>
                    <Button
                      size="sm"
                      onPress={() => {
                        answer(false);
                      }}
                    >
                      {t('people.transfer.import-dialog.no', 'No')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        answer(false);
                      }}
                    >
                      {t('people.transfer.import-dialog.skip_it', 'Skip it')}
                    </Button>
                  </View>
                </View>
              )}
            </Card>
          )}
          {busy === 'plan' ? (
            <Spinner
              label={t('people.transfer.import-dialog.checking_every_row', 'Checking every row')}
            />
          ) : null}
          {counts === undefined ? null : (
            <View className="flex-row gap-2">
              <Stat
                className="flex-1"
                inset
                size={22}
                label={t('people.transfer.import-dialog.new_people', 'new people')}
                value={String(counts.create)}
              />
              <Stat
                className="flex-1"
                inset
                size={22}
                label={t('people.transfer.import-dialog.updates', 'updates')}
                value={String(counts.update)}
              />
              <Stat
                className="flex-1"
                inset
                size={22}
                label={t('people.transfer.import-dialog.problems', 'problems')}
                value={String(counts.blocked)}
              />
            </View>
          )}
          {plan?.blocked == null ? null : (
            <Alert
              tone="danger"
              title={t('people.transfer.import-dialog.this_cant_run_yet', 'This can’t run yet')}
            >
              {plan.blocked}
            </Alert>
          )}
          {leftOut === 0 && (plan?.review.dryRun.workplaces ?? []).length === 0 ? null : (
            <Button variant="link" onPress={onFull}>
              {leftOut === 0
                ? t(
                    'people.transfer.import-dialog.check_the_work_locations_in_the',
                    'Check the work locations in the full import',
                  )
                : t(
                    'people.transfer.import-dialog.yet_open_the_full_import',
                    {
                      one: '{{count}} column isn’t a field yet: open the full import',
                      other: '{{count}} columns aren’t fields yet: open the full import',
                    },
                    { count: leftOut },
                  )}
            </Button>
          )}
          {stage === null ? (
            <Button variant="link" onPress={onHistory}>
              {t(
                'people.transfer.import-dialog.past_imports_and_exports',
                'Past imports and exports',
              )}
            </Button>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.transfer.import-dialog.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={plan === null || plan.blocked !== null || toImport === 0}
            loading={busy === 'run'}
            onPress={() => void run()}
          >
            {toImport === 0
              ? t('people.transfer.import-dialog.import', 'Import')
              : t('people.transfer.import-dialog.import_2', 'Import {{String}}', {
                  String: String(toImport),
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
