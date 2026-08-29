---
name: reach-ui
description: Build Kithena screens strictly from the Reach design system (@reach/ui). Use when writing or reviewing any UI in apps/admin, apps/web or apps/auth — picking a component, deciding whether to add one, or checking a screen for hand-rolled markup that should have been a Reach component.
---

# Build screens from Reach, not from markup that looks like Reach

Anything with behaviour, state, or a visual treatment comes from `@reach/ui`.
Never hand-roll one, and never re-create one out of utility classes.

## The rule

Use the Reach component. If it seems to be missing, it is usually named
something you did not guess — check the export list before concluding anything.

| Instead of | Use |
| --- | --- |
| `<button>`, or a div with hover styles | `Button` (`variant="primary"` for the main action — the default is `secondary`) |
| `<input>`, `<textarea>` | `Input`, `PasswordField`, `NumberField`, `TagsInput` |
| `<select>`, a custom dropdown | `Select`, `Combobox` |
| `<label>` + spans + error text | `Field`, `FieldLabel`, `FieldDescription`, `FieldError` |
| a bordered box | `Card` (`variant="outlined"`, `padded`) |
| a coloured message box | `Alert` (`tone`) |
| a status pill | `Badge` (`tone`) |
| `<img>` as an avatar or a logo | `Avatar` (`shape`, `fit`, `size`) |
| a file or image picker | `ImageUploader`, `AvatarUploader`, `FileUploader`, `Dropzone` |
| a hand-built table | `Table` |
| a page title block | `PageHeader`, `PageSection`, `PageLayout` |
| a spinner or skeleton | `Spinner`, `Progress` |
| a toast or banner you wrote | `useToast` |

## What this is not

**Not a ban on HTML.** `div`, `span`, `p`, `ul`, `li`, `section`, `main`,
`form`, `h1`–`h6`, `a`, and a full-bleed decorative background `<img>` are
structure and text. Reach has no opinion about them and neither should you.

**Not a ban on utility classes.** Layout, spacing and responsive behaviour are
what they are for. What is forbidden is assembling a border, a radius, a padding
and a hover state into something button-shaped.

## When Reach is genuinely missing something

Add it to Reach *first*, as a variant on the nearest existing component rather
than a new component beside it.

The test: can the design system describe the need without knowing who is asking?
`shape="rounded"` can. `variant="company"` cannot — and that is how a
presentational package starts learning what a tenant is, which
`.dependency-cruiser.cjs` exists to prevent.

A worked example. A company logo needed a square, uncropped avatar. `Avatar` was
circle-only with `object-cover`, correct for a face and destructive to a
wordmark. The fix was `shape` and `fit` variants on `Avatar` — not a
`CompanyMark` component, and not three screens each reaching for `<img>` with
its own idea of the border.

## Before you finish

- New or changed component? Add a story — `pnpm test:stories` runs axe over
  every one as a merge gate.
- `pnpm lint` also runs `pnpm boundaries`: `packages/ui` may not import a
  contract or a domain type, and `services/*` may not import `packages/ui`.
- Reach must never learn Kithena exists. `pnpm docs:brand-leak` enforces it.
