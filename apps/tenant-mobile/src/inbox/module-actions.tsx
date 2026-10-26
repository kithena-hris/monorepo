import {
  DocumentsInboxDetail,
  OnboardingTaskDetail,
  PerformanceInboxDetail,
} from '@kithena/contracts';
import {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  Textarea,
  useToast,
} from '@reach/ui-native';
import { Camera, FileUp, X } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Linking } from 'react-native';

import { chooseFile, putFile, scan } from '../documents/api';
import { useSigned } from '../people/api';
import { openIn, type Nav } from './item';
import type { Item } from './model';
import { useInboxWrite } from './task-card';
import { t } from '../i18n';

/**
 * Documents', Onboarding's and Performance's tasks done on the card, as the
 * web's Inbox does them (`apps/web/src/components/inbox/detail-*.tsx`): the
 * file HR asked for, scanned or picked and filed against the request; a
 * policy acknowledged; access granted or refused; an onboarding task ticked
 * off; an unlock decided; nominations approved. Anything else keeps `fallback`.
 */
export function ModuleActions({
  item,
  navigation,
  fallback,
}: {
  readonly item: Item;
  readonly navigation: Nav;
  readonly fallback: ReactNode;
}): ReactNode {
  if (item.lane !== 'task') return fallback;
  if (item.module === 'documents') {
    const p = DocumentsInboxDetail.safeParse(item.detail);
    if (p.success) return <DocumentsActions item={item} d={p.data} navigation={navigation} />;
  }
  if (item.module === 'onboarding') {
    const p = OnboardingTaskDetail.safeParse(item.detail);
    if (p.success) return <OnboardingActions item={item} d={p.data} />;
  }
  if (item.module === 'performance') {
    const p = PerformanceInboxDetail.safeParse(item.detail);
    if (p.success) return <PerformanceActions item={item} d={p.data} navigation={navigation} />;
  }
  return fallback;
}

function DocumentsActions({
  item,
  d,
  navigation,
}: {
  readonly item: Item;
  readonly d: DocumentsInboxDetail;
  readonly navigation: Nav;
}): React.JSX.Element {
  const signed = useSigned();
  const { toast } = useToast();
  const { write, busy } = useInboxWrite();
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  if (d.kind === 'request') {
    const send = async (how: 'scan' | 'file'): Promise<void> => {
      setPicking(false);
      const file = how === 'scan' ? await scan() : await chooseFile();
      if (file === null) return;
      setSending(true);
      const put = await putFile(signed, file);
      if (!put.ok) {
        setSending(false);
        toast({
          title: t('inbox.module-actions.that_did_not_work', 'That did not work'),
          description: put.message,
          tone: 'danger',
        });
        return;
      }
      await write(
        'documents',
        'UploadDocument',
        {
          input: {
            title: d.typeName,
            typeKey: d.typeKey,
            subjectPersonId: d.personId,
            sectionId: null,
            expiresOn: null,
            requestId: d.requestId,
            upload: put.data,
          },
        },
        t('inbox.module-actions.sent_your', 'Sent your {{name}}', { name: d.typeName }),
      );
      setSending(false);
    };
    return (
      <>
        <Button
          size="sm"
          variant="primary"
          loading={sending}
          onPress={() => {
            setPicking(true);
          }}
        >
          {t('inbox.module-actions.add', 'Add')}
        </Button>
        <ActionSheet open={picking} onOpenChange={setPicking}>
          <ActionSheetContent title={d.typeName}>
            <ActionSheetItem icon={Camera} onSelect={() => void send('scan')}>
              {t('inbox.module-actions.scan_it', 'Scan it')}
            </ActionSheetItem>
            <ActionSheetItem icon={FileUp} onSelect={() => void send('file')}>
              {t('inbox.module-actions.choose_a_file', 'Choose a file')}
            </ActionSheetItem>
          </ActionSheetContent>
        </ActionSheet>
      </>
    );
  }
  if (d.kind === 'acknowledge') {
    return (
      <>
        <Button
          size="sm"
          onPress={() => {
            navigation.navigate('DocumentDetail', { id: d.documentId, title: item.title });
          }}
        >
          {t('inbox.module-actions.read', 'Read')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={busy === 'AcknowledgeDocument'}
          onPress={() => {
            void write(
              'documents',
              'AcknowledgeDocument',
              { campaignId: d.campaignId },
              t('inbox.module-actions.acknowledged', 'Acknowledged'),
            );
          }}
        >
          {t('inbox.module-actions.ive_read_it', 'I’ve read it')}
        </Button>
      </>
    );
  }
  const decide = (grant: boolean): void => {
    void write(
      'documents',
      'DecideDocumentAccess',
      { requestId: d.requestId, input: { grant } },
      grant
        ? t('inbox.module-actions.granted', 'Granted')
        : t('inbox.module-actions.refused', 'Refused'),
    );
  };
  return (
    <>
      <Button
        size="sm"
        loading={busy === 'DecideDocumentAccess'}
        onPress={() => {
          decide(false);
        }}
      >
        {t('inbox.module-actions.refuse', 'Refuse')}
      </Button>
      <Button
        size="sm"
        variant="primary"
        onPress={() => {
          decide(true);
        }}
      >
        {t('inbox.module-actions.grant', 'Grant')}
      </Button>
    </>
  );
}

function OnboardingActions({
  item,
  d,
}: {
  readonly item: Item;
  readonly d: OnboardingTaskDetail;
}): React.JSX.Element {
  const signed = useSigned();
  const { write, busy } = useInboxWrite();
  const link = d.link;
  return (
    <>
      {link === null ? null : (
        <Button
          size="sm"
          onPress={() => {
            void Linking.openURL(link.startsWith('/') ? `${signed.company.origin}${link}` : link);
          }}
        >
          {t('inbox.module-actions.do_it', 'Do it')}
        </Button>
      )}
      <Button
        size="sm"
        variant="primary"
        loading={busy === 'CompleteOnboardingTask'}
        onPress={() => {
          void write(
            'onboarding',
            'CompleteOnboardingTask',
            { planId: d.planId, taskId: d.taskId },
            t('inbox.module-actions.done', 'Done: {{title}}', { title: item.title }),
          );
        }}
      >
        {t('inbox.module-actions.mark_done', 'Mark done')}
      </Button>
    </>
  );
}

function PerformanceActions({
  item,
  d,
  navigation,
}: {
  readonly item: Item;
  readonly d: PerformanceInboxDetail;
  readonly navigation: Nav;
}): React.JSX.Element {
  const signed = useSigned();
  const { write, busy } = useInboxWrite();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  if (d.kind === 'nominations') {
    return (
      <>
        <Button
          size="sm"
          onPress={() => {
            openIn(signed, navigation, item);
          }}
        >
          {t('inbox.module-actions.change', 'Change')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={d.nominees.length === 0}
          loading={busy === 'DecidePerformanceNominations'}
          onPress={() => {
            void write(
              'performance',
              'DecidePerformanceNominations',
              {
                id: d.nominationId,
                input: {
                  decisions: d.nominees.map((n) => ({
                    personId: n.personId,
                    approve: true,
                    reason: null,
                  })),
                  replacements: [],
                },
              },
              t('inbox.module-actions.approved', 'Approved'),
            );
          }}
        >
          {t('inbox.module-actions.approve_all', 'Approve all')}
        </Button>
      </>
    );
  }
  const who = item.from?.name ?? t('inbox.module-actions.they', 'They');
  const unlock = (approve: boolean, why: string): void => {
    void write(
      'performance',
      'DecidePerformanceUnlock',
      { id: d.reviewId, input: { approve, note: why } },
      approve
        ? t('inbox.module-actions.unlocked', 'Unlocked')
        : t('inbox.module-actions.declined', 'Declined'),
    );
  };
  return (
    <>
      <Button
        size="sm"
        accessibilityLabel={t('inbox.module-actions.decline', 'Decline')}
        startIcon={<Icon icon={X} size={16} />}
        onPress={() => {
          setDeclining(true);
        }}
      />
      <Button
        size="sm"
        variant="primary"
        loading={busy === 'DecidePerformanceUnlock'}
        onPress={() => {
          unlock(true, t('inbox.module-actions.unlocked', 'Unlocked'));
        }}
      >
        {t('inbox.module-actions.unlock', 'Unlock')}
      </Button>
      {declining ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setDeclining(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('inbox.module-actions.decline_the_unlock', 'Decline the unlock')}
              </DialogTitle>
              <DialogDescription>
                {t('inbox.module-actions.who_sees_your_reason', '{{who}} sees your reason.', {
                  who,
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Textarea
                value={note}
                onChange={setNote}
                placeholder={t('inbox.module-actions.reason', 'Reason')}
                accessibilityLabel={t('inbox.module-actions.reason', 'Reason')}
              />
            </DialogBody>
            <DialogFooter>
              <Button
                onPress={() => {
                  setDeclining(false);
                }}
              >
                {t('inbox.module-actions.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={note.trim() === ''}
                onPress={() => {
                  setDeclining(false);
                  unlock(false, note.trim());
                }}
              >
                {t('inbox.module-actions.decline', 'Decline')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
