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

export async function loadScreen(component: string, query: ScreenQuery): Promise<ScreenLoad> {
  const s = query.search;
  switch (component) {
    case 'Library':
      return read('DocumentsLibrary', {
        show: s['show'] ?? 'all',
        q: s['q'] ?? '',
        queue: QUEUES.has(s['queue'] ?? '') ? s['queue'] : null,
        deleted: s['deleted'] === 'true',
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
