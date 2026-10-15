import 'server-only';

import { recruiting } from './people';
import type { ScreenLoad, ScreenQuery } from './people-screens';
import type { OperationName } from './recruiting-operations';

/**
 * The data each Recruiting screen is drawn from, fetched on the server
 * before the page is sent, through the router, as the person signed in
 * (REC-070): Documents' way. Every filter is the address.
 */

async function read(
  name: OperationName,
  variables: Record<string, unknown> = {},
): Promise<ScreenLoad> {
  const answer = await recruiting<unknown>(name, variables);
  return answer.ok
    ? { status: 'ready', data: answer.data }
    : answer.code === 'UNREACHABLE'
      ? { status: 'error', message: answer.message, unreachable: true }
      : { status: 'error', message: answer.message, code: answer.code };
}

const or = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

export async function loadScreen(component: string, query: ScreenQuery): Promise<ScreenLoad> {
  const s = query.search;
  const id = query.params['id'] ?? '';
  switch (component) {
    case 'Home':
    case 'Jobs':
      return read('RecruitingHome');
    case 'Requisitions':
    case 'Requisition':
    case 'RequisitionApproval':
      return read('RecruitingRequisitions');
    case 'JobSetup':
      return id === 'new' ? { status: 'none' } : read('RecruitingJob', { jobId: id });
    case 'Pipeline':
      return read('RecruitingPipeline', {
        jobId: id,
        q: or(s['q']),
        stage: or(s['stage']),
        source: or(s['source']),
        sort: or(s['sort']),
      });
    case 'Candidates':
      return read('RecruitingCandidates', { q: or(s['q']), tag: or(s['tag']) });
    case 'Candidate':
      return read('RecruitingCandidate', { candidateId: id });
    case 'Pools':
      return read('RecruitingPools', { poolId: or(query.params['id']) });
    case 'Interviews':
      return read('RecruitingInterviews');
    case 'Kit':
      return read('RecruitingKit', { interviewId: id });
    case 'Debrief':
      return read('RecruitingDebrief', { applicationId: id });
    case 'Schedule':
      return read('RecruitingCandidates', { q: null, tag: null });
    case 'Offers':
      return read('RecruitingOffers');
    case 'Offer':
    case 'OfferApproval':
    case 'Contract':
      return read('RecruitingOffer', { offerId: id });
    case 'Board':
      return read('RecruitingBoard');
    case 'Analytics':
      return read('RecruitingAnalytics', {
        period: or(s['period']),
        jobId: or(s['job']),
        department: or(s['department']),
        source: or(s['source']),
      });
    case 'Agencies':
    case 'Settings':
      return read('RecruitingSettings');
    default:
      return { status: 'none' };
  }
}
