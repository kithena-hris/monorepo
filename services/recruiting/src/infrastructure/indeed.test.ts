import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { Questionnaire } from '../domain/screening/questionnaire.js';
import { DISPOSITION, indeedInbound, screenerQuestions } from './indeed.js';

describe('Indeed Apply (REC-132)', () => {
  const inbound = indeedInbound('shared-secret');
  const raw = JSON.stringify({
    id: 'ia-1',
    job: { jobId: 'indeed-job', jobMeta: 'acme/0192f1c2-0000-7000-8000-000000000001' },
    applicant: {
      fullName: 'Yuki Sato',
      email: 'yuki@example.com',
      phoneNumber: '+44 20 7946 0000',
      resume: {
        file: {
          fileName: 'cv.pdf',
          contentType: 'application/pdf',
          data: Buffer.from('%PDF').toString('base64'),
        },
      },
    },
    screenerQuestionsAndAnswers: {
      questionsAndAnswers: [
        { question: { id: 'years', type: 'text', format: 'decimal' }, answer: '4' },
        { question: { id: 'licence', type: 'select' }, answer: { label: 'Yes', value: 'yes' } },
        {
          question: { id: 'langs', type: 'multiselect' },
          answer: [
            { label: 'German', value: 'German' },
            { label: 'Spanish', value: 'Spanish' },
          ],
        },
        { question: { id: 'note', type: 'textarea' }, answer: '' },
        {
          question: { id: 'cert', type: 'file' },
          answer: [{ fileName: 'cert.pdf', contentType: 'application/pdf', data: 'JVBERg==' }],
        },
      ],
    },
  });

  it('accepts only what Indeed signed', () => {
    const signed = createHmac('sha1', 'shared-secret').update(raw).digest('base64');
    expect(inbound.verify(raw, signed)).toBe(true);
    expect(inbound.verify(`${raw} `, signed)).toBe(false);
    expect(inbound.verify(raw, '')).toBe(false);
  });

  it('maps the application to Recruiting’s shape, the job from the meta it was posted with', () => {
    const parsed = inbound.parse(raw);
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        jobId: '0192f1c2-0000-7000-8000-000000000001',
        ref: 'ia-1',
        name: 'Yuki Sato',
        email: 'yuki@example.com',
        phone: '+44 20 7946 0000',
      },
    });
    expect(parsed.ok && parsed.value.files.map((f) => [f.field, f.fileName])).toEqual([
      ['cv', 'cv.pdf'],
      ['q_cert', 'cert.pdf'],
    ]);
    expect(inbound.parse('{"id":"x"}').ok).toBe(false);
  });

  it('reads the screener answers as the public form would send them', () => {
    const parsed = inbound.parse(raw);
    expect(parsed.ok && parsed.value.answers).toEqual({
      q_years: 4,
      q_licence: 'yes',
      q_langs: ['German', 'Spanish'],
      q_cert: ['cert.pdf'],
    });
  });

  it('asks every question kind as an Indeed screener question', () => {
    const kinds = [
      'short_text',
      'long_text',
      'single',
      'multiple',
      'number',
      'yes_no',
      'date',
      'file',
    ] as const;
    const questionnaire: Questionnaire = {
      id: 'qn',
      version: 1,
      name: 'Screening',
      worksCouncilConsentVersion: null,
      questions: kinds.map((kind) => ({
        id: kind,
        text: `A ${kind} question`,
        kind,
        required: kind === 'number',
        options: ['One', 'Two'],
        points: null,
        knockout: null,
      })),
    };
    const asked = screenerQuestions(questionnaire);
    expect(asked.schemaVersion).toBe('1.3');
    expect(
      asked.screenerQuestions.questions.map((q) => [q['id'], q['type'], q['format'] ?? null]),
    ).toEqual([
      ['short_text', 'text', null],
      ['long_text', 'textarea', null],
      ['single', 'select', null],
      ['multiple', 'multiselect', null],
      ['number', 'text', 'decimal'],
      ['yes_no', 'select', null],
      ['date', 'date', 'yyyy-MM-dd'],
      ['file', 'file', null],
    ]);
    expect(asked.screenerQuestions.questions[4]?.['required']).toBe(true);
    expect(asked.screenerQuestions.questions[5]?.['options']).toEqual([
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ]);
  });

  it('tells Indeed every stage in its own words', () => {
    for (const status of [
      'applied',
      'screening',
      'assessment',
      'interview',
      'works_council',
      'offer',
      'hired',
      'rejected',
      'withdrawn',
    ])
      expect(DISPOSITION[status], status).toBeDefined();
  });
});
