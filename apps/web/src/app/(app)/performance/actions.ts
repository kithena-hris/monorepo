'use server';

import { documents, performance } from '../../../lib/people';
import { OPERATIONS, type OperationName } from '../../../lib/performance-operations';
import type { Done } from '../recruiting/actions';
import { serverWords } from '../../../lib/server-words';

/**
 * What the Performance screens' buttons do (PRF-070): Onboarding's one server
 * action, for Performance's operations. The router accepts only the persisted
 * operations, and Performance decides whether this person may. Reads that a
 * dialog asks for on its own (a picker's search, a preview, a PDF) go
 * through here too.
 */
/**
 * A released review filed to the person in Documents (PRD §20, PRF-191): the
 * shell composes the two modules, as each lets this person — Performance draws
 * the review as they may read it, Documents files it under "Performance and
 * development" as they may file. Neither module knows the other.
 */
async function fileToDocuments(variables: Readonly<Record<string, unknown>>): Promise<Done> {
  const t = await serverWords();
  const reviewId = typeof variables['id'] === 'string' ? variables['id'] : '';
  const subjectPersonId =
    typeof variables['subjectPersonId'] === 'string' ? variables['subjectPersonId'] : null;
  if (reviewId === '' || subjectPersonId === null)
    return { ok: false, message: t('app.app.performance.actions.which_review', 'Which review?') };
  const pdf = await performance<{ filename: string; base64: string }>('PerformanceReviewPdf', {
    id: reviewId,
  });
  if (!pdf.ok) return { ok: false, message: pdf.message };
  const bytes = Buffer.from(pdf.data.base64, 'base64');
  const file = { name: pdf.data.filename, mediaType: 'application/pdf', size: bytes.length };
  const put = await documents<{ uploadId: string; url: string; headers: Record<string, string> }>(
    'StartDocumentsUpload',
    { input: file },
  );
  if (!put.ok) return { ok: false, message: put.message };
  const sent = await fetch(put.data.url, {
    method: 'PUT',
    headers: put.data.headers,
    body: bytes,
  }).catch(() => null);
  if (sent?.ok !== true)
    return {
      ok: false,
      message: t(
        'app.app.performance.actions.documents_did_not_take_the_file',
        'Documents did not take the file',
      ),
    };
  const filed = await documents<{ id: string }>('UploadDocument', {
    input: {
      title: pdf.data.filename.replace(/\.pdf$/u, ''),
      typeKey: 'performance_review',
      subjectPersonId,
      sectionId: null,
      expiresOn: null,
      requestId: null,
      upload: { uploadId: put.data.uploadId, name: file.name, mediaType: file.mediaType },
    },
  });
  return filed.ok ? { ok: true, data: filed.data } : { ok: false, message: filed.message };
}

export async function performanceAct(
  name: string,
  variables: Readonly<Record<string, unknown>>,
): Promise<Done> {
  const t = await serverWords();
  if (name === 'FilePerformanceReviewToDocuments') return fileToDocuments(variables);
  if (!Object.hasOwn(OPERATIONS, name) || name === 'PerformanceLive')
    return {
      ok: false,
      message: t(
        'app.app.performance.actions.not_something_this_page_can_do',
        'Not something this page can do',
      ),
    };
  const answer = await performance<unknown>(name as OperationName, { ...variables });
  return answer.ok
    ? { ok: true, data: answer.data }
    : { ok: false, message: answer.message, code: answer.code };
}
