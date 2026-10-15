# Recruiting's AI: risk management file and technical documentation

The provider's file for Recruiting's AI features under the EU AI Act
(Regulation (EU) 2024/1689). Kithena is the **provider**; each company using
Recruiting is a **deployer**. The deployer's instructions for use are in
[`recruiting-ai-instructions.md`](recruiting-ai-instructions.md).

The evidence matrix and rediscovery compare applications with a job's
criteria, so they are **high-risk** (Annex III, point 4(a)). The other
features draft text or read job data, and are not. After the Digital Omnibus
(Regulation (EU) 2026/1744), the high-risk obligations apply from
**2 December 2027**. Transparency (art. 50) and AI literacy (art. 4) already
apply.

This file describes what the code does today, with the file behind each
claim. It is kept current with the code, and is not legal advice. The
conformity assessment and the EU database registration (REC-127) are a
business task: someone still has to be named to own them.

## 1. The system

### 1.1 Intended purpose

To help a company's hiring team read applications against the criteria they
wrote for a job, and to find people in their talent pools who agreed to be
kept. It **labels**; it never decides. No stage, rejection or ranking happens
because of it: the band is shown beside the person's own stage (PRD §22.5),
and newest first stays the default order.

It is not for:

- deciding or recommending whether to hire, reject or advance anyone;
- reading anything but an application (CV text, form answers) or scorecards;
- inferring protected characteristics, emotions or personality;
- people the company has no lawful basis to process (pool members whose
  consent has lapsed are never read).

### 1.2 Features and their risk

| Feature                       | Screen   | Reads                                     | High-risk            |
| ----------------------------- | -------- | ----------------------------------------- | -------------------- |
| Evidence matrix               | R10, R11 | The masked application, the job criteria  | Yes                  |
| Rediscovery                   | R10      | Consenting pool members' last application | Yes                  |
| CV parser                     | R11, J6  | The masked application                    | No¹                  |
| Debrief summary               | R17      | Masked scorecards                         | No¹                  |
| Ad writer, hints, translation | R5       | Job data                                  | No                   |
| Interview kit questions       | Settings | A scorecard's competencies                | No                   |
| Email drafts                  | R12      | The purpose, typed by a person            | No                   |
| Job assistant                 | J8       | The job ad, the company, the process      | No (art. 50 applies) |
| Ask for a chart               | R25      | The metrics catalogue, names only         | No                   |

¹ They read about a person but evaluate nothing: the parser fills a profile
the candidate checks, and the summary keeps only sentences that cite a
scorecard. Both are logged as high-risk reads are.

### 1.3 Architecture

- **One way in.** Every read of an application goes through
  `services/recruiting/src/application/ai.ts` (`readApplication`,
  `readMasked`). It checks the caller is on the job's hiring team, that the
  company switched the feature on, masks the text, sends it, checks the
  answer against a schema, and keeps the record.
- **Masking by code** (`domain/ai/mask.ts`), before anything leaves:
  name, contact details, the address beyond the city, date of birth and
  age, gender markers, nationality, marital status, religion, health and
  union membership, and schools if the company asks. A labelled line goes
  whole. Tests: `domain/ai/mask.test.ts`.
- **The gateway** (`packages/telemetry/src/ai-gateway.ts`), wrapped in
  `infrastructure/model.ts` with Recruiting's denied fields
  (`application/ai-denied.ts`): a prompt that still names special-category
  data is refused whole. This is the second lock after masking.
- **The model plans or reads; the domain decides.** Quotes are verified
  against the text and unverified claims become `not_evidenced`
  (`domain/ai/matrix.ts`). The score (met 1, partly met 0.5, by weight) and
  the band (strong at 75% with every must-have met, good at 50%) are
  computed by code. The model is told never to give a number.
- **The model** is any OpenAI-compatible API on `ASSISTANT_BASE_URL`,
  `ASSISTANT_API_KEY` and `ASSISTANT_MODEL`, at temperature 0 with JSON
  output. Without a key, every feature is off and every screen still works.

## 2. Risk management (art. 9)

| Risk                                                | What reduces it                                                                                                           | Where                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| The model infers or uses a protected characteristic | Masking before the call; the gateway refuses what slips past; self-ID is in a sealed store no AI path reads               | `mask.ts`, `ai-denied.ts`, `fairness.ts` |
| A verdict without evidence                          | Every quote must be in the text; a claim left with no quote becomes `not_evidenced`                                       | `matrix.ts`                              |
| The model's number decides                          | It gives no number; the domain scores, and the band is a label, never a stage                                             | `matrix.ts`, `screens.ts`                |
| Automation bias: people follow the band             | Newest first by default; the band sits beside the stage; "was this right?" per criterion, stored to give an overturn rate | `screens.ts`, `candidate.tsx`            |
| Disparate impact on a group                         | Stage pass rates by voluntary self-ID group, four-fifths flagged, split into decisions with and without the matrix        | `domain/fairness/impact.ts`              |
| A person not on the job reads an application        | Only the job's hiring team; rediscovery only for the new job's recruiter, and only consented pool members                 | `ai.ts`, `matrix.ts`                     |
| Reading someone without a basis                     | Pools need live consent; anonymisation removes the parsed profile and self-ID                                             | `matrix.ts`, `privacy.ts`                |
| NYC Local Law 144                                   | No matrix in New York City without an audit from the last year, and only ten business days after the notice               | `domain/ai/nyc.ts`                       |
| A public feature costs money or leaks               | J8 sees only public job data, is limited per address, and says it is an AI                                                | `job-assistant.ts`, `http/limits.ts`     |
| The model is unavailable or answers badly           | A schema check; a refusal or a failure shows "could not read this just now"; nothing is half-saved                        | `ai.ts`                                  |

Residual risks, open:

- **No evaluation set yet.** The prompts are tested for their shape, not
  their accuracy. Before 2 December 2027 there must be a labelled,
  representative set of applications per launch country and language, kept
  under data governance (art. 10), with accuracy and per-group error rates
  measured against it for each prompt version.
- Masking is pattern-based. It is tested in English, German and Spanish, and
  is weaker in Hindi and other scripts. The gateway is the backstop.
- The overturn rate is stored but not yet reported on a screen.

## 3. Data governance (art. 10)

- Applications are never used to train a model. The provider the deployment
  points at must not train on its input, and should process in the EU where
  it offers to (`docs/environments.md`).
- What is sent is the masked text, kept with each assessment
  (`ai_assessment.masked_input`, with its SHA-256) so an audit sees exactly
  what was read.
- Self-ID is voluntary, asked after applying, and sealed with AES-256-GCM
  bound to its application (`infrastructure/sealer.ts`). Only the fairness
  check opens it, only for an administrator, and only to count groups of
  five or more.

## 4. Record-keeping (art. 12)

Each read keeps the model's name, the prompt's version (for example
`matrix@1`), the masked input and its hash, the checked output, the score and
the band, who asked, and when (`ai_assessment`). Each finding's agreement or
disagreement is kept with it (`ai_verdict`). The human decision that followed
is the pipeline's own append-only history (`application_stage_event`).

## 5. Transparency and human oversight (art. 13, 14, 50)

- Every AI output shows what it read, the model and the date, and asks
  "was this right?" (PRD §22.4).
- The job assistant says it is an AI, and so does the search's
  sentence-to-filters box.
- A person can switch every feature off, per feature (Settings → AI).
- The deployer's instructions: `recruiting-ai-instructions.md`.

## 6. Accuracy, robustness and security (art. 15)

- Temperature 0, JSON-only answers, and schema checks on every answer.
- Quote verification makes a fabricated verdict fall to `not_evidenced`.
- Prompt injection inside a CV can change what the model writes, but not
  what is kept: quotes must exist in the text, the model cannot set a score,
  and the instructions say text marked `[masked]` is not to be restored.
- Public model calls are rate-limited per address.

## 7. Changes

A prompt's version changes with any change to its instruction, and the
version is in every record. A change to masking, scoring or the band
thresholds is a change to this file.
