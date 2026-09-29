import type { Prompt } from '@kithena/telemetry';

import type { ToolCall } from '../../domain/assistant/settings-plan.js';
import type { AssistantPort } from './assistant-port.js';

/**
 * A fake model for the AI settings tests, deterministic from recorded answers:
 * the tool calls a model gives for each request, looked up by the request's
 * exact words. A request with no answer here fails the test that sent it, so
 * nothing passes by a fake making something up.
 *
 * The answers were written by hand to be what a faithful planner returns
 * (no model key was available when they were made; docs/ai-settings.md says
 * how to check them against the real one with `pnpm --filter @kithena/people
 * ai-settings:try`).
 */

export const SIMPLE = 'Add a T-shirt size field to Personal information with sizes S, M, L and XL.';

export const MEDIUM =
  'Rename the Bank section to Payment, and add an IBAN field there that employees fill in during onboarding; only HR and finance can see it besides the employee.';

export const COMPLEX =
  'Set up a Spanish engineering company: personal details, contract, bank and tax, emergency contact, equipment; employees fill personal, bank and emergency; HR fills contract; managers see contract but not bank; NIF and IBAN are sensitive; add a location in Barcelona.';

export const OUT_OF_SCOPE = 'Connect Slack and add a webhook that sends new hires to our payroll.';

const onboarding = { collectAt: 'onboarding' } as const;
const byEmployee = { ownership: ['employee'], visibility: ['self', 'hr'] } as const;
const contract = {
  ownership: ['hr'],
  visibility: ['self', 'manager', 'hr'],
  collectAt: 'hr_only',
} as const;

export const ANSWERS: Readonly<Record<string, readonly ToolCall[]>> = {
  [SIMPLE]: [
    {
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'personal',
          label: 'T-shirt size',
          dataType: 'select',
          options: ['S', 'M', 'L', 'XL'],
          requiredness: 'never',
          ...byEmployee,
          ...onboarding,
          classification: 'internal',
          piiKind: 'none',
        },
      },
    },
    {
      name: 'finish_plan',
      input: { summary: 'Adds an optional T-shirt size field to Personal information.' },
    },
  ],
  [MEDIUM]: [
    { name: 'rename_section', input: { sectionKey: 'bank', label: 'Payment' } },
    {
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'Payment',
          label: 'IBAN',
          description: 'The account your salary is paid into.',
          dataType: 'bank_account',
          country: 'ES',
          requiredness: 'always',
          ownership: ['employee'],
          visibility: ['self', 'hr', 'finance'],
          ...onboarding,
          classification: 'confidential',
          piiKind: 'financial',
        },
      },
    },
    {
      name: 'finish_plan',
      input: { summary: 'Renames Bank to Payment and adds a required IBAN field there.' },
    },
  ],
  [COMPLEX]: [
    { name: 'add_country_pack', input: { country: 'ES' } },
    { name: 'rename_section', input: { sectionKey: 'personal', label: 'Personal details' } },
    { name: 'add_section', input: { label: 'Contract' } },
    { name: 'add_section', input: { label: 'Bank and tax' } },
    { name: 'add_section', input: { label: 'Emergency contact' } },
    { name: 'add_section', input: { label: 'Equipment' } },
    ...[
      ['Date of birth', 'date', 'identity', 'confidential', true],
      ['Personal phone', 'phone', 'contact', 'confidential', false],
      ['Home address', 'address', 'identity', 'confidential', true],
    ].map(([label, dataType, piiKind, classification, required]) => ({
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'personal',
          label,
          dataType,
          requiredness: required === true ? 'always' : 'never',
          ...byEmployee,
          ...onboarding,
          classification,
          piiKind,
        },
      },
    })),
    {
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'Contract',
          label: 'Contract kind',
          dataType: 'select',
          options: ['Permanent', 'Fixed term', 'Internship'],
          requiredness: 'always',
          ...contract,
          classification: 'internal',
          piiKind: 'none',
        },
      },
    },
    {
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'Contract',
          label: 'Weekly hours',
          dataType: 'decimal',
          requiredness: 'always',
          ...contract,
          classification: 'internal',
          piiKind: 'none',
        },
      },
    },
    {
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'Contract',
          label: 'Contract end date',
          description: 'Only for fixed-term contracts.',
          dataType: 'date',
          requiredness: 'never',
          ...contract,
          classification: 'internal',
          piiKind: 'none',
        },
      },
    },
    {
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'Bank and tax',
          label: 'IBAN',
          description: 'The account your salary is paid into.',
          dataType: 'bank_account',
          country: 'ES',
          requiredness: 'always',
          ownership: ['employee'],
          visibility: ['self', 'hr', 'finance'],
          ...onboarding,
          classification: 'confidential',
          piiKind: 'financial',
        },
      },
    },
    {
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'Bank and tax',
          label: 'IRPF withholding rate',
          description: 'As a percentage, for example 15.',
          dataType: 'decimal',
          requiredness: 'never',
          ownership: ['employee'],
          visibility: ['self', 'hr', 'finance'],
          ...onboarding,
          classification: 'confidential',
          piiKind: 'financial',
        },
      },
    },
    ...[
      ['Emergency contact name', 'text', true],
      ['Emergency contact phone', 'phone', true],
    ].map(([label, dataType, required]) => ({
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'Emergency contact',
          label,
          dataType,
          requiredness: required === true ? 'always' : 'never',
          ...byEmployee,
          ...onboarding,
          classification: 'confidential',
          piiKind: 'contact',
        },
      },
    })),
    {
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'Emergency contact',
          label: 'Relationship',
          dataType: 'select',
          options: ['Partner', 'Parent', 'Child', 'Sibling', 'Friend', 'Other'],
          requiredness: 'never',
          ...byEmployee,
          ...onboarding,
          classification: 'confidential',
          piiKind: 'contact',
        },
      },
    },
    {
      name: 'add_field',
      input: {
        field: {
          sectionKey: 'Equipment',
          label: 'Laptop',
          dataType: 'select',
          options: ['MacBook Pro 14"', 'MacBook Pro 16"', 'ThinkPad X1'],
          requiredness: 'never',
          ownership: ['hr'],
          visibility: ['self', 'manager', 'hr'],
          collectAt: 'hr_only',
          classification: 'internal',
          piiKind: 'none',
        },
      },
    },
    {
      name: 'add_location',
      input: {
        name: 'Barcelona office',
        country: 'ES',
        timeZone: 'Europe/Madrid',
        legalEntity: 'Acme Iberia SL',
      },
    },
    {
      name: 'finish_plan',
      input: {
        summary:
          'Sets up a Spanish company: the ES pack, personal, contract, bank and tax, emergency contact and equipment fields, and a Barcelona office.',
      },
    },
  ],
  [OUT_OF_SCOPE]: [
    { name: 'cannot_do', input: { request: 'Connect Slack', area: 'chat_apps' } },
    { name: 'cannot_do', input: { request: 'A webhook for new hires', area: 'webhooks' } },
    { name: 'finish_plan', input: { summary: 'Nothing here can be set up with the assistant.' } },
  ],
};

/** The model, faked from `answers`; every prompt it was sent is kept, to check what left. */
export function fakePlanner(
  answers: Readonly<Record<string, readonly ToolCall[]>> = ANSWERS,
): AssistantPort & {
  readonly prompts: Prompt[];
} {
  const prompts: Prompt[] = [];
  return {
    prompts,
    loadPolicies: () => Promise.resolve(),
    complete: (_tenant, prompt) => {
      prompts.push(prompt);
      const request = String(prompt.context['request']);
      const calls = answers[request];
      if (calls === undefined) throw new Error(`no recorded answer for: ${request.slice(0, 80)}`);
      return Promise.resolve({ ok: true, value: JSON.stringify({ calls }) });
    },
  };
}
