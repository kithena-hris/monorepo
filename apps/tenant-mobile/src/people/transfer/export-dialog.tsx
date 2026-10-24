import {
  Button,
  Chip,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  Icon,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Text,
} from '@reach/ui-native';
import * as WebBrowser from 'expo-web-browser';
import { Download, FolderOpen, Sparkles } from 'lucide-react-native';
import { useContext, useEffect, useState } from 'react';
import { View } from 'react-native';

import { useAct } from '../act';
import { askDocuments, DocumentsOn, putFile } from '../../documents/api';
import { useRead, useSigned } from '../api';
import { t } from '../../i18n';

interface Builder {
  readonly today: string;
  readonly who: readonly { value: string; label: string; count: number | null }[];
  readonly sections: readonly {
    key: string;
    label: string;
    fields: readonly { key: string; label: string }[];
  }[];
}

/** Sections whose values are the kind an export has to justify twice. */
const SENSITIVE = /pay|bank|salary|compensation|identif|national|tax/iu;

/**
 * Exporting people in a centred modal (design v3 P9): who, which sections
 * as chips, and why, which is kept in the activity log with the file. The
 * full export (as of a date, another format, sending, a schedule) is a tap
 * away.
 */
export function ExportDialog({
  onClose,
  onDone,
  onFull,
  onKept,
}: {
  onClose: () => void;
  onDone: (exportId: string) => void;
  onFull: () => void;
  /** Kept in Documents rather than downloaded (Documents MP2): the document filed. */
  onKept?: (documentId: string, title: string) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const documents = useContext(DocumentsOn) && onKept !== undefined;
  const [keeping, setKeeping] = useState<string | null>(null);
  const { load } = useRead<Builder>('ExportBuilder', {});
  const { act, busy } = useAct();
  const builder = load.status === 'ready' ? load.data : null;
  const [who, setWho] = useState('everyone');
  const [sections, setSections] = useState<readonly string[] | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (builder !== null && sections === null)
      setSections(builder.sections.filter((s) => !SENSITIVE.test(s.label)).map((s) => s.key));
  }, [builder, sections]);

  const chosen = sections ?? [];
  const leftOut = (builder?.sections ?? []).filter(
    (s) => SENSITIVE.test(s.label) && !chosen.includes(s.key),
  );
  const made = async (): Promise<{ id: string; links: { name: string; url: string }[] } | null> => {
    setTried(true);
    if (builder === null || reason.trim() === '' || chosen.length === 0) return null;
    const segmentId = who.startsWith('segment:') ? who.slice('segment:'.length) : null;
    return act<{ id: string; links: { name: string; url: string }[] }>('RequestExport', {
      format: 'csv',
      fields: builder.sections
        .filter((s) => chosen.includes(s.key))
        .flatMap((s) => s.fields.map((f) => f.key)),
      asOf: builder.today,
      ...(segmentId === null ? {} : { segmentId }),
      reason: reason.trim(),
    });
  };
  /** People's file, put in Documents as an Export from People: HR only, gone in 90 days. */
  const keep = async (): Promise<void> => {
    setKeeping(null);
    const exported = await made();
    const link = exported?.links[0];
    if (link === undefined) return;
    const body = await fetch(link.url)
      .then((r) => (r.ok ? r.blob() : null))
      .catch(() => null);
    if (body === null) {
      setKeeping(
        t(
          'people.transfer.export-dialog.the_export_could_not_be_read',
          'The export could not be read.',
        ),
      );
      return;
    }
    const put = await putFile(signed, { name: link.name, mediaType: 'text/csv', body });
    if (!put.ok) {
      setKeeping(put.message);
      return;
    }
    const title = link.name.replace(/\.[^.]+$/u, '');
    const filed = await askDocuments<{ id: string }>(signed, 'UploadDocument', {
      input: { title, typeKey: 'people_export', upload: put.data },
    });
    if (!filed.ok) {
      setKeeping(filed.message);
      return;
    }
    onKept?.(filed.data.id, title);
  };
  const download = async (): Promise<void> => {
    const exported = await made();
    if (exported === null) return;
    const url = exported.links[0]?.url;
    if (url !== undefined) void WebBrowser.openBrowserAsync(url);
    onDone(exported.id);
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
          <DialogTitle>
            {t('people.transfer.export-dialog.export_people', 'Export people')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'people.transfer.export-dialog.kept_in_the_activity_log_with',
              'Kept in the activity log with the file.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {builder === null ? (
            <Spinner
              label={t(
                'people.transfer.export-dialog.loading_what_you_can_export',
                'Loading what you can export',
              )}
            />
          ) : (
            <>
              <Field>
                <FieldLabel>{t('people.transfer.export-dialog.who', 'Who')}</FieldLabel>
                <Select value={who} onValueChange={setWho}>
                  <FieldControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent title={t('people.transfer.export-dialog.who', 'Who')}>
                    {builder.who
                      .filter((w) => w.value !== 'conditions')
                      .map((w) => (
                        <SelectItem key={w.value} value={w.value}>
                          {w.count === null
                            ? w.label
                            : t(
                                'people.transfer.export-dialog.people',
                                '{{label}} · {{String}} people',
                                { label: w.label, String: String(w.count) },
                              )}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field invalid={tried && chosen.length === 0}>
                <FieldLabel>{t('people.transfer.export-dialog.what', 'What')}</FieldLabel>
                <View className="flex-row flex-wrap gap-2">
                  {builder.sections.map((s) => {
                    const on = chosen.includes(s.key);
                    return (
                      <Chip
                        key={s.key}
                        selected={on}
                        onPress={() => {
                          setSections(on ? chosen.filter((k) => k !== s.key) : [...chosen, s.key]);
                        }}
                      >
                        {s.label}
                      </Chip>
                    );
                  })}
                </View>
                {tried && chosen.length === 0 ? (
                  <FieldError>
                    {t('people.transfer.export-dialog.choose_what_goes_in', 'Choose what goes in.')}
                  </FieldError>
                ) : null}
              </Field>
              <Field required invalid={tried && reason.trim() === ''}>
                <FieldLabel>
                  {t('people.transfer.export-dialog.why_you_need_it', 'Why you need it')}
                </FieldLabel>
                <FieldControl>
                  <Input value={reason} onChange={setReason} maxLength={500} />
                </FieldControl>
                {tried && reason.trim() === '' ? (
                  <FieldError>
                    {t(
                      'people.transfer.export-dialog.say_why_for_the_activity_log',
                      'Say why, for the activity log.',
                    )}
                  </FieldError>
                ) : null}
              </Field>
              {leftOut.length === 0 ? null : (
                <View className="flex-row items-start gap-1.5">
                  <Icon icon={Sparkles} size={13} tone="accent" />
                  <Text variant="footnote" className="flex-1 text-accent-fg">
                    {t(
                      'people.transfer.export-dialog.left_out_adding_may_need_a',
                      {
                        one: '{{join}} is left out. Adding it may need a second approval.',
                        other: '{{join}} are left out. Adding them may need a second approval.',
                      },
                      { count: leftOut.length, join: leftOut.map((s) => s.label).join(' and ') },
                    )}
                  </Text>
                </View>
              )}
              {keeping === null ? null : <FieldError>{keeping}</FieldError>}
              {documents ? (
                <Button
                  startIcon={<Icon icon={FolderOpen} />}
                  loading={busy === 'RequestExport'}
                  onPress={() => void keep()}
                >
                  {t('people.transfer.export-dialog.save_to_documents', 'Save to Documents')}
                </Button>
              ) : null}
              <Button variant="link" onPress={onFull}>
                {t(
                  'people.transfer.export-dialog.more_options_a_date_a_format',
                  'More options: a date, a format, sending',
                )}
              </Button>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.transfer.export-dialog.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            startIcon={<Icon icon={Download} tone="on-accent" />}
            loading={busy === 'RequestExport'}
            onPress={() => void download()}
          >
            {t('people.transfer.export-dialog.download_csv', 'Download CSV')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
