import { describe, expect, it } from 'vitest';
import { SignupQuestion } from '@kithena/contracts';

import { pendingQuestions } from './signup.js';

const q = (key: string, required: boolean): SignupQuestion =>
  SignupQuestion.parse({
    key,
    label: key,
    description: null,
    dataType: 'text',
    required,
    options: [],
    maxLength: null,
    min: null,
    max: null,
    decimals: null,
    classification: 'internal',
  });

describe('which sign-up questions a link asks', () => {
  const set = [q('t_shirt', true), q('nickname_badge', false), q('dietary', true)];

  it('asks every question of somebody signing up for the first time', () => {
    expect(pendingQuestions(set, [], 'invitation').map((x) => x.key)).toEqual([
      't_shirt',
      'nickname_badge',
      'dietary',
    ]);
  });

  it('never asks again what was already answered', () => {
    expect(pendingQuestions(set, ['t_shirt'], 'invitation').map((x) => x.key)).toEqual([
      'nickname_badge',
      'dietary',
    ]);
  });

  it('asks a recovering person only the required ones they have not answered', () => {
    // A lost device is not the moment for optional questions; People's own
    // missing-information prompts cover those once they are signed in.
    expect(pendingQuestions(set, ['t_shirt'], 'recovery').map((x) => x.key)).toEqual(['dietary']);
  });
});
