# Recruiting's AI: instructions for use

For the people at a company who switch on and use Recruiting's AI features.
Under the EU AI Act your company is the **deployer** and Kithena the
**provider**. The provider's file is
[`recruiting-ai-act.md`](recruiting-ai-act.md).

## What it is for

The **evidence matrix** reads an application against the criteria your team
wrote for the job, and quotes what it found for each one: met, partly met, not
met, or not evidenced. Kithena checks that every quote is really in the
application, then computes a score and a band (strong, good or weak) from the
verdicts and the weights you set.

**Rediscovery** does the same for people in your talent pools who agreed to be
kept, when a new job opens.

The band is a **label to help you read**, not a decision. Nothing moves,
hides or rejects a candidate because of it.

## What it is not for

- Do not reject anyone, or decide not to look at an application, because of
  a band or a verdict alone.
- Do not use it on a job whose criteria are not job-related, or that would
  favour a group (for example "native speaker" where fluency is meant).
- Do not use it on anything other than applications.

## Before you switch it on

1. Write each job's criteria as specific, job-related sentences, and mark the
   must-haves. The matrix can only be as fair as its criteria.
2. Make sure the people using it have had AI literacy training (art. 4): what
   the band means, what it does not, and what automation bias is.
3. Tell candidates, in your privacy notice, that an AI may help read
   applications and how to ask for a person to review theirs without it. For
   a job in New York City, the apply form also gives the notice that Local Law
   144 requires.
4. For a job in New York City, record the date of your last independent bias
   audit in Settings → AI, and publish its summary. Until then the matrix
   stays off for that job.
5. Consider asking voluntary self-ID questions (Settings → AI), so you can see
   in the fairness check whether outcomes differ between groups.

## How to oversee it

- **Read the quotes, not the band.** Each verdict shows the passages it came
  from. If they do not support it, say so with "Was this right? No".
- **Disagree freely.** Every disagreement is kept with the assessment.
- **Look at the fairness check** (Analytics → Fairness) at least monthly. A
  ratio under four-fifths for a group at a stage is a reason to review the
  criteria and the decisions. Compare decisions made with and without the
  matrix.
- **Keep the default order.** The applications list is newest first. Sorting
  by match is a choice; make it consciously.

## Its limits

- It reads the text of the CV and the form answers. A scanned CV with no text
  layer is not read; a person reads it.
- Before the model sees anything, Kithena removes the person's name, contact
  details, address beyond the city, date of birth and age, gender markers,
  nationality, marital status, religion, health and union membership, and
  schools if you ask. Masking is strongest in English, German and Spanish. If
  an application still names special-category data, the read is refused
  rather than sent.
- It can be wrong in both directions, and is more likely to miss evidence
  that is phrased unusually, or written in a language other than the
  criteria's.
- It does not know anything that is not written in the application.

## Candidates' rights

A candidate may ask for a person to review their application without the
matrix. Your privacy notice says how, and in New York City the apply form does
too. Under GDPR art. 22 no decision with
legal effect is taken by automated means alone, and none is taken here: a
person always decides.

## Records

Every read keeps the model, the prompt's version, exactly what was read
(masked) and what it answered, who asked, and when. Ask Kithena for these
records during an audit or a candidate's access request.

## Switching it off

Settings → AI, one switch per feature. Everything in Recruiting works without
them.
