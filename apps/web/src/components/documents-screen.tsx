'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition, type JSX } from 'react';

import * as actions from '../app/(app)/documents/actions';
import * as peopleActions from '../app/(app)/people/actions';
import type { ScreenLoad } from '../lib/people-screens';
import { AREAS } from '../lib/remotes';
import type { areaFrame } from '../lib/shell-data';
import { withQuery } from '../lib/url-state';
import type { Embedded } from './act-screen';
import { useShellData } from './app-shell';
import { RemoteScreen, type RemoteRoute } from './remote-screen';

/**
 * A Documents screen's props (DOC-030), as `timeoff-screen.tsx` is Time
 * Off's: the server's answer as it arrived, and every callback a server
 * action or a navigation. The one place the shell knows each screen's props.
 */
export interface DocumentsScreenProps {
  readonly route: RemoteRoute | null;
  readonly load: ScreenLoad | { readonly status: 'loading' };
  readonly frame: ReturnType<typeof areaFrame>;
  /** The address it is of, which inside another page is not the page's. */
  readonly path?: string;
  /** Drawn inside another page, the Inbox's pane: where its links go. */
  readonly embedded?: Embedded;
}

export function DocumentsScreen({
  route,
  load,
  frame,
  path,
  embedded,
}: DocumentsScreenProps): JSX.Element {
  const router = useRouter();
  const here = usePathname();
  const pathname = embedded === undefined || path === undefined ? here : path;
  // People is here: a document can fill the record of the person it is about.
  const shellData = useShellData();
  const people = shellData.sections.length > 0;
  const timeOffHere = shellData.remotes?.['timeoff'] !== undefined;
  const [, startTransition] = useTransition();
  const loadable =
    load.status === 'ready'
      ? { status: 'ready' as const, data: load.data }
      : load.status === 'error'
        ? {
            status: 'error' as const,
            message: load.message,
            ...(load.code === 'FORBIDDEN' ||
            load.code === 'NOT_ENTITLED' ||
            load.code === 'NOT_FOUND'
              ? { refused: true as const }
              : {
                  retry: () => {
                    startTransition(() => {
                      router.refresh();
                    });
                  },
                }),
          }
        : { status: 'loading' as const };
  // A plain push, as Time Off's: inside a transition React keeps the old
  // screen until the next one is wholly ready, and a remote screen's switch
  // never was, so a link looked dead.
  const go = (to: string): void => {
    if (embedded === undefined) router.push(to, { scroll: false });
    else embedded.navigate(to, false);
  };
  /** A filter changed: the address holds it, and the server reads it again. */
  const filter = (patch: Readonly<Record<string, string | null>>): void => {
    go(withQuery(window.location.pathname, window.location.search, patch));
  };
  // With People: your documents answer what your record is waiting for (J1, J2, J6).
  const answers = people
    ? {
        onWaitingFor: actions.waitingFor,
        onLookFor: actions.lookFor,
        onAnswer: (changed: Readonly<Record<string, string>>) =>
          peopleActions.saveOwnSection('', changed),
      }
    : {};
  const files = {
    onStartUpload: actions.startUpload,
    onFileLink: actions.fileLink,
  };

  const props = ((): Record<string, unknown> => {
    switch (route?.component) {
      case 'Library':
        return {
          load: loadable,
          onFilter: filter,
          onNavigate: go,
          ...files,
          onUpload: actions.uploadDocument,
          onShare: actions.shareDocument,
          onAskAfterUpload: actions.setAskAfterUpload,
          onCreateSection: actions.createSection,
          onChangeSection: actions.changeSection,
          onDecideAccess: actions.decideAccess,
          onAsk: actions.askForDocument,
          onRemind: actions.remindRequest,
          onRemindSigners: actions.remindEnvelope,
          onRestore: actions.restoreDocument,
          onConfirmDeletion: actions.confirmDeletion,
          onAskAcross: actions.askDocuments,
          ...(people
            ? {
                onPreviewLetters: actions.previewLetters,
                onGenerateLetters: actions.generateLetters,
              }
            : {}),
          onDraftDocument: actions.draftDocument,
          onPreviewDraft: actions.previewDraft,
          onFileDraft: actions.fileDraft,
          onProposeSplit: actions.proposeSplit,
          onFileSplit: actions.fileSplit,
          ...answers,
          onSuggest: actions.suggestFiling,
        };
      case 'DocumentView':
        return {
          load: loadable,
          path: pathname,
          onNavigate: go,
          ...files,
          onAddVersion: actions.addVersion,
          onShare: actions.shareDocument,
          onConfidential: actions.setConfidential,
          onRename: actions.renameDocument,
          onExpiry: actions.setExpiry,
          onDelete: actions.deleteDocument,
          onRestore: actions.restoreDocument,
          onRequestAccess: actions.requestAccess,
          onDecideAccess: actions.decideAccess,
          onPlaceHold: actions.placeHold,
          onAcknowledge: actions.acknowledgeDocument,
          onSendForAcknowledgement: actions.sendForAcknowledgement,
          onSummarize: actions.summarizeDocument,
          onAskDocument: actions.askDocument,
          onCompare: actions.compareVersions,
          // With Time Off: a certificate's leave, asked for on its request page (J4).
          ...(timeOffHere ? { onCertificateLeave: actions.certificateLeave } : {}),
          // With People: fill the person's record from the document (G5).
          ...(people
            ? {
                onReadRecord: actions.recordFromDocument,
                onApplyRecord: (personId: string, changed: Readonly<Record<string, string>>) =>
                  peopleActions.savePersonSection(personId, '', changed),
                ...answers,
                onReadLetter: actions.letterOutcome,
                onGiveNotice: (personId: string, lastWorkingDay: string) =>
                  peopleActions.moveLifecycle(personId, {
                    kind: 'giveNotice',
                    lastWorkingDay,
                    reason: 'resigned',
                  }),
              }
            : {}),
        };
      case 'Envelopes':
        return { load: loadable, onNavigate: go };
      case 'Envelope':
        return {
          load: loadable,
          onNavigate: go,
          onFileLink: actions.envelopeFileLink,
          onSign: actions.signEnvelope,
          onKeepSignature: actions.keepSignature,
          onDecline: actions.declineEnvelope,
          onAsk: actions.askEnvelopeSender,
          onVoid: actions.voidEnvelope,
          onRemind: actions.remindEnvelope,
          onRefresh: () => {
            router.refresh();
          },
          onReassign: actions.reassignSigner,
          onSeal: actions.sealEnvelope,
        };
      case 'SendForSignature':
        return {
          load: loadable,
          onNavigate: go,
          onFileLink: actions.fileLink,
          onSend: actions.sendForSignature,
        };
      case 'Campaign':
        return { load: loadable, onNavigate: go };
      case 'PersonFile':
        return {
          load: loadable,
          onNavigate: go,
          ...files,
          onUpload: actions.uploadDocument,
          onAsk: actions.askForDocument,
          onRemind: actions.remindRequest,
          onCancel: actions.cancelRequest,
        };
      case 'DocumentTypes':
        return { load: loadable, onSave: actions.saveType, onDescribe: actions.describeType };
      case 'AiSettings':
        return { load: loadable, onSave: actions.setAiSettings };
      case 'AccessSettings':
        return { load: loadable, onSave: actions.setAccessSettings };
      case 'RetentionSettings':
        return { load: loadable, onLift: actions.liftHold };
      default:
        return {};
    }
  })();

  return (
    <RemoteScreen
      name={AREAS.documents.name}
      area={AREAS.documents.label}
      route={route}
      props={{
        ...props,
        frame:
          load.status === 'ready' && load.notice !== undefined
            ? { ...frame, notice: load.notice }
            : frame,
      }}
      fallback={null}
    />
  );
}
