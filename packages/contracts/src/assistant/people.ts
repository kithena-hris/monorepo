import { capability } from './capability.js';

/**
 * People's capabilities (assistant PRD §7.4, §8, §16): every behaviour of
 * People's Slack answer today (`application/assistant/ask.ts`), as queries the
 * assistant can plan and join. `about` is what the model reads.
 */

export const PeopleFind = capability({
  name: 'people.find',
  version: 1,
  module: 'people',
  about:
    'Find people by the fields offered, or the team of a manager named in the question; list them, count them, or rank them.',
  accepts: { filters: true, match: true, sort: true, name: true, groupBy: true, within: true },
  groups: ['field:*'],
  output: 'people',
});

export const PeoplePerson = capability({
  name: 'people.person',
  version: 1,
  module: 'people',
  about: 'About one person named in the question: their job, manager, start date and work email.',
  accepts: { name: 'required' },
  output: 'profile',
});

export const PeopleReports = capability({
  name: 'people.reports',
  version: 1,
  module: 'people',
  about: 'Who reports directly to a person named in the question.',
  accepts: { name: 'required' },
  output: 'people',
});

export const PeopleManagers = capability({
  name: 'people.managers',
  version: 1,
  module: 'people',
  about: 'The managers of the people an earlier step found, each once.',
  accepts: { within: 'required' },
  output: 'people',
});

export const PeopleApprovals = capability({
  name: 'people.approvals',
  version: 1,
  module: 'people',
  about: 'What is waiting for the asker’s approval.',
  accepts: {},
  output: 'items',
});

export const peopleCapabilities = [
  PeopleFind,
  PeoplePerson,
  PeopleReports,
  PeopleManagers,
  PeopleApprovals,
] as const;
