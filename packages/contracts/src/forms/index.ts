import * as z from 'zod';

import { asFreeText, asInternal, asPublic, policy } from '../classification.js';

/**
 * The forms contract (Performance PRD §11.1, PRF-007): a form's definition and
 * its answers, shared by every module that stores forms of its own. Performance
 * is the first: reviews, feedback with a template, quizzes and probation
 * reviews. `packages/form-kit` is the pure logic over these shapes.
 *
 * A question's words are the company's (`internal`); an answer and its comment
 * are what a person wrote about another (`asFreeText`), so never in an event,
 * a log line or a prompt that was not masked first.
 */

const words = (max: number) => z.string().max(max).register(policy, asInternal());
const key = () =>
  z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/u, 'lower-case letters, digits, - and _')
    .register(policy, asPublic());

/** Which review kinds a question is shown in; absent, all of them. */
export const FormActivity = z
  .enum(['self', 'manager', 'peer', 'upward', 'skip', 'goals', 'feedback', 'quiz'])
  .register(policy, asPublic());
export type FormActivity = z.infer<typeof FormActivity>;

const Base = {
  id: key(),
  prompt: words(500).min(1),
  help: words(1000).nullable().default(null),
  required: z.boolean().default(true).register(policy, asPublic()),
  allowComment: z.boolean().default(false).register(policy, asPublic()),
  /** Never shown to the review's subject, anywhere (§11.4). */
  private: z.boolean().default(false).register(policy, asPublic()),
  /** The activities it is asked in; absent, every one the form is used for. */
  activities: z.array(FormActivity).max(8).optional(),
};

export const ScaleOption = z.object({
  label: words(80).min(1),
  description: words(300).nullable().default(null),
  value: z.int().min(-100).max(100).register(policy, asPublic()),
});
export type ScaleOption = z.infer<typeof ScaleOption>;

export const ChoiceOption = z.object({ id: key(), label: words(200).min(1) });
export type ChoiceOption = z.infer<typeof ChoiceOption>;

export const TextQuestion = z.object({
  ...Base,
  type: z.literal('text'),
  /** Shown, never enforced. */
  guidance: z.int().min(1).max(20_000).nullable().default(null).register(policy, asPublic()),
});
export const ScaleQuestion = z.object({
  ...Base,
  type: z.literal('scale'),
  options: z.array(ScaleOption).min(2).max(10),
});
export const BinaryQuestion = z.object({
  ...Base,
  type: z.literal('binary'),
  yes: words(80).default('Yes'),
  no: words(80).default('No'),
});
export const ChoiceQuestion = z.object({
  ...Base,
  type: z.literal('choice'),
  options: z.array(ChoiceOption).min(2).max(50),
  multiple: z.boolean().default(false).register(policy, asPublic()),
  min: z.int().min(0).max(50).nullable().default(null).register(policy, asPublic()),
  max: z.int().min(1).max(50).nullable().default(null).register(policy, asPublic()),
  /** A quiz's right answers, never shown to whoever answers. */
  correct: z.array(key()).max(50).optional(),
});
export const NumberQuestion = z.object({
  ...Base,
  type: z.literal('number'),
  min: z.number().nullable().default(null).register(policy, asPublic()),
  max: z.number().nullable().default(null).register(policy, asPublic()),
  unit: words(20).nullable().default(null),
});
/** Computed from the form's ratings: nobody types it (§11.5, design PF2b). */
export const PerformanceScoreQuestion = z.object({
  ...Base,
  type: z.literal('performance_score'),
});
/** Generated from the subject's goals when a cycle rates them (§14.6). */
export const GoalsQuestion = z.object({
  ...Base,
  type: z.literal('goals'),
  goalId: z.uuid().register(policy, asPublic()),
  progress: z.int().min(0).max(100).nullable().default(null).register(policy, asInternal()),
});

export const FormQuestion = z.discriminatedUnion('type', [
  TextQuestion,
  ScaleQuestion,
  BinaryQuestion,
  ChoiceQuestion,
  NumberQuestion,
  PerformanceScoreQuestion,
  GoalsQuestion,
]);
export type FormQuestion = z.infer<typeof FormQuestion>;
export type QuestionType = FormQuestion['type'];

export const FormSection = z.object({
  id: key(),
  title: words(200).min(1),
  description: words(1000).nullable().default(null),
  questions: z.array(FormQuestion).max(100),
});
export type FormSection = z.infer<typeof FormSection>;

export const FormDefinition = z.object({
  title: words(200).min(1),
  description: words(2000).nullable().default(null),
  sections: z.array(FormSection).max(30),
});
export type FormDefinition = z.infer<typeof FormDefinition>;
export type FormDefinitionInput = z.input<typeof FormDefinition>;

/**
 * One answer: rich text (HTML from Reach's editor, or plain text from a
 * phone), one option's value, several options' ids, yes or no, a number.
 */
export const AnswerValue = z
  .union([
    z.string().max(40_000),
    z.number(),
    z.boolean(),
    z.array(z.string().max(40)).max(50),
    z.null(),
  ])
  .register(policy, asFreeText());
export type AnswerValue = z.infer<typeof AnswerValue>;

export const FormAnswer = z.object({
  value: AnswerValue,
  comment: z.string().max(20_000).nullable().default(null).register(policy, asFreeText()),
});
export type FormAnswer = z.infer<typeof FormAnswer>;

/** Answers by question id. */
export const FormAnswers = z.record(z.string().max(40), FormAnswer);
export type FormAnswers = z.infer<typeof FormAnswers>;

/** A company's scale for every rating and the score (§11.5): labels by value, low to high. */
export const CompanyScale = z.array(ScaleOption).min(2).max(10);
export type CompanyScale = z.infer<typeof CompanyScale>;

export const DEFAULT_SCALE: CompanyScale = [
  { label: 'Below expectations', description: null, value: 1 },
  { label: 'Partly meets', description: null, value: 2 },
  { label: 'Meets', description: null, value: 3 },
  { label: 'Exceeds', description: null, value: 4 },
  { label: 'Outstanding', description: null, value: 5 },
];
