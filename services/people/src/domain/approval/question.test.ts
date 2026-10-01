import { describe, expect, it } from 'vitest';

import { openApproval, type Approval } from './approval.js';
import { answerQuestion, askRequester, type Question } from './question.js';

const NORA = 'acct-nora';
const SOFIA = 'acct-sofia';
const AT = '2026-09-22T09:00:00.000Z';

function change(state: Approval['state'] = 'pending'): Approval {
  const opened = openApproval({
    id: 'c1',
    requestedBy: NORA,
    reason: null,
    reasonOptional: true,
    at: AT,
    expiresAt: '2026-09-29T09:00:00.000Z',
  });
  if (!opened.ok) throw new Error(opened.error.message);
  return { ...opened.value, state };
}

const ask = (over: Partial<Parameters<typeof askRequester>[1]> = {}) =>
  askRequester(change(), { id: 'q1', by: SOFIA, question: ' Is this the promotion? ', at: AT, ...over });

describe('asking the requester (design AI7: "Ask Nora")', () => {
  it('records the question, trimmed, unanswered', () => {
    const asked = ask();
    expect(asked.ok && asked.value).toEqual({
      id: 'q1',
      changeId: 'c1',
      askedBy: SOFIA,
      askedAt: AT,
      question: 'Is this the promotion?',
      answer: null,
      answeredAt: null,
    });
  });

  it('needs words, and not too many', () => {
    const empty = ask({ question: '   ' });
    expect(!empty.ok && empty.error).toMatchObject({ code: 'REASON_REQUIRED', path: ['question'] });
    expect(ask({ question: 'x'.repeat(501) }).ok).toBe(false);
  });

  it('is not the requester’s, and only while the change waits', () => {
    expect(!ask({ by: NORA }).ok && ask({ by: NORA })).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    const late = askRequester(change('approved'), { id: 'q1', by: SOFIA, question: 'Why?', at: AT });
    expect(!late.ok && late.error.code).toBe('APPROVAL_DECIDED');
    const lapsed = askRequester(change(), {
      id: 'q1',
      by: SOFIA,
      question: 'Why?',
      at: '2026-10-01T09:00:00.000Z',
    });
    expect(!lapsed.ok && lapsed.error.code).toBe('APPROVAL_EXPIRED');
  });
});

describe('answering', () => {
  const asked = (): Question => {
    const q = ask();
    if (!q.ok) throw new Error(q.error.message);
    return q.value;
  };

  it('is the requester’s, once', () => {
    const answered = answerQuestion(asked(), change(), {
      by: NORA,
      answer: 'Yes, see my email of 24 Sep',
      at: '2026-09-22T10:00:00.000Z',
    });
    expect(answered.ok && answered.value).toMatchObject({
      answer: 'Yes, see my email of 24 Sep',
      answeredAt: '2026-09-22T10:00:00.000Z',
    });
    if (!answered.ok) return;
    const again = answerQuestion(answered.value, change(), { by: NORA, answer: 'More', at: AT });
    expect(!again.ok && again.error.code).toBe('ALREADY_ANSWERED');
  });

  it('refuses anybody else, an empty answer, and a change already closed', () => {
    expect(answerQuestion(asked(), change(), { by: SOFIA, answer: 'Yes', at: AT }).ok).toBe(false);
    expect(answerQuestion(asked(), change(), { by: NORA, answer: ' ', at: AT }).ok).toBe(false);
    expect(answerQuestion(asked(), change('rejected'), { by: NORA, answer: 'Yes', at: AT }).ok).toBe(
      false,
    );
  });
});
