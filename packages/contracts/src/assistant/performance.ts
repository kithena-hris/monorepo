import { capability } from './capability.js';

/**
 * Performance's capabilities (Performance PRD §22.10; assistant PRD §8.6):
 * what is due and how far things have got, read as the asker in Performance's
 * own access rules. Never what a review, a piece of feedback or a note says,
 * nor a score: the assistant can say a review is due, not what is in it.
 */

/** The reviews the asker writes, and when each is due, as their My reviews shows them. */
export const PerformanceOwed = capability({
  name: 'performance.owed',
  version: 1,
  module: 'performance',
  about: 'Reviews the asker has to write, and when each is due.',
  accepts: {},
  output: 'items',
});

/** For a manager: how far each report's reviews have got in the running cycles. */
export const PerformanceTeamReviews = capability({
  name: 'performance.team_reviews',
  version: 1,
  module: 'performance',
  about: 'How far the asker’s reports’ reviews have got in the running cycles.',
  accepts: {},
  output: 'items',
});

/** The asker's goals and their progress; for a manager, their team's at risk. */
export const PerformanceGoals = capability({
  name: 'performance.goals',
  version: 1,
  module: 'performance',
  about: 'The asker’s goals and their progress, and their team’s goals at risk or off track.',
  accepts: {},
  output: 'items',
});

/** Learning due for the asker, or for their team. */
export const PerformanceLearningDue = capability({
  name: 'performance.learning_due',
  version: 1,
  module: 'performance',
  about: 'Training due for the asker, or for their team.',
  accepts: {},
  output: 'items',
});

/** Feedback the asker was asked for and has not given yet. */
export const PerformanceFeedbackAsked = capability({
  name: 'performance.feedback_asked',
  version: 1,
  module: 'performance',
  about: 'Feedback the asker has been asked to give and has not given yet.',
  accepts: {},
  output: 'items',
});

/** For HR and managers: each running cycle, how many reviews are in and how many are late. */
export const PerformanceCycles = capability({
  name: 'performance.cycles',
  version: 1,
  module: 'performance',
  about: 'Each running review cycle the asker oversees: how many reviews are in, and how many are late.',
  accepts: {},
  output: 'items',
});

export const performanceCapabilities = [
  PerformanceOwed,
  PerformanceTeamReviews,
  PerformanceGoals,
  PerformanceLearningDue,
  PerformanceFeedbackAsked,
  PerformanceCycles,
] as const;
