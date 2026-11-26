import 'server-only';

import { myLegalName, mySignature } from './my-signature';
import { documents } from './people';
import type { ScreenLoad, ScreenQuery } from './people-screens';
import type { OperationName } from './documents-operations';

/**
 * The data each Documents screen is drawn from, fetched on the server before
 * the page is sent, through the router, as the person signed in (DOC-030):
 * Time Off's way (`timeoff-screens.ts`), for the third area. Every filter is
 * the address, so a shared link opens the same list.
 */

async function read(
  name: OperationName,
  variables: Record<string, unknown> = {},
): Promise<ScreenLoad> {
  const answer = await documents<unknown>(name, variables);
  return answer.ok
    ? { status: 'ready', data: answer.data }
    : answer.code === 'UNREACHABLE'
      ? { status: 'error', message: answer.message, unreachable: true }
      : { status: 'error', message: answer.message, code: answer.code };
}

const QUEUES = new Set(['to_sign', 'expiring', 'missing', 'to_delete']);

/** The queue an address is: HR's follow-up tabs are each their own page. */
const QUEUE_AT: Readonly<Record<string, string>> = {
  '/documents/queues/missing': 'missing',
  '/documents/queues/expiring': 'expiring',
  '/documents/queues/to-delete': 'to_delete',
};

export async function loadScreen(
  component: string,
  query: ScreenQuery,
  path = '',
): Promise<ScreenLoad> {
  const s = query.search;
  switch (component) {
    // Where Documents opens: the list's own read, unfiltered, drawn as an overview.
    case 'Overview':
      return read('DocumentsLibrary', { show: 'all', q: '', queue: null, deleted: false });
    case 'Library':
      return read('DocumentsLibrary', {
        show: s['show'] ?? 'all',
        q: s['q'] ?? '',
        queue: QUEUE_AT[path] ?? (QUEUES.has(s['queue'] ?? '') ? s['queue'] : null),
        deleted: path === '/documents/deleted' || s['deleted'] === 'true',
      });
    case 'DocumentView':
      return read('DocumentsDocument', { documentId: query.params['id'] ?? '' });
    case 'PersonFile':
      return read('DocumentsPersonFile', { personId: query.params['id'] ?? '' });
    case 'Envelopes':
      return read('DocumentsEnvelopes');
    case 'Envelope': {
      // The signature on file and the legal name, from People, read beside the request.
      const [envelope, signature, legalName] = await Promise.all([
        read('DocumentsEnvelope', { envelopeId: query.params['id'] ?? '' }),
        mySignature().catch(() => null),
        myLegalName().catch(() => null),
      ]);
      if (envelope.status !== 'ready') return envelope;
      return {
        status: 'ready',
        data: {
          ...(envelope.data as object),
          legalName,
          ...(signature === null
            ? {}
            : {
                signature: {
                  mark: signature.mark,
                  canKeep: signature.canKeep,
                  pending: signature.pending,
                },
              }),
        },
      };
    }
    case 'SendForSignature':
      return read('DocumentsDocument', { documentId: query.params['id'] ?? '' });
    case 'Campaign':
      return read('DocumentsCampaign', { campaignId: query.params['id'] ?? '' });
    case 'DocumentTypes':
    case 'AccessSettings':
    case 'RetentionSettings':
    case 'AiSettings':
      return read('DocumentsSettings');
    default:
      return { status: 'none' };
  }
}
