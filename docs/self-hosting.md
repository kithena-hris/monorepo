# Self-hosting

Whether Kithena can run on our own containers instead of Vercel, what it would
cost, and why the answer is "yes, but not yet, and not with Kubernetes first".

Written because the dependency is real and worth understanding before it is
load-bearing, not because a move is planned.

## The coupling is thinner than six Vercel projects suggest

| Piece                                     | What ties it to Vercel                                | Work to containerise             |
| ----------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| `platform/identity`, `platform/messaging` | `api/gateway.ts` and a `vercel.json` rewrite          | Effectively none                 |
| `apps/auth/shell`                         | `MODERNJS_DEPLOY=vercel` on one script                | Effectively none                 |
| `apps/web`, `apps/admin`                  | Nothing beyond the platform                           | One line: `output: 'standalone'` |
| Image uploads                             | `@vercel/blob`, and a domain rule naming its hostname | Real work — see below            |

The services were written this way on purpose. `platform/identity/api/gateway.ts`
says so:

> `src/main.ts` stays. It is what `just dev` runs and what a container would
> run, and keeping it means this service is still a plain HTTP server that
> happens to be deployed as a function rather than one that can only be a
> function.

That is the whole reason this document is short. A service whose only entry
point was a platform's function signature would be a rewrite; these are a
`Dockerfile` and a `CMD`.

### Two accidents that make the Next apps unusually portable

Both fall out of decisions taken for other reasons, and both are worth
protecting.

**No `next/image` anywhere.** Image Optimization is the hardest Next feature to
self-host — it wants a running optimiser, a cache and a storage backend. We have
none of it, because the uploaded-image work chose a plain `<img>` rather than add
every Blob host to `remotePatterns`. That comment appears in four files and reads
like a note about configuration churn. It is also what keeps these apps portable.

**No `revalidate`, no ISR.** Nothing to invalidate across replicas, so no shared
cache to stand up and no cache-coherence bug to write.

If either changes, this document gets more expensive. Adding `next/image` is the
single change most likely to make leaving Vercel a project rather than a week.

## The one real lock-in

`@vercel/blob`, and it reaches further than the upload route:

```ts
// platform/identity/src/tenancy/domain/provision.ts
const BLOB_HOST = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//;
```

That is a **domain rule with a test**, not a configuration value. It exists so a
customer's login page cannot render an image somebody else controls — the one
screen where a swapped image is a convincing phishing prompt. So moving off Blob
means changing a security invariant _and_ rewriting every stored `logo_url` and
`cover_image_url`.

Worth decoupling regardless of whether we ever leave: every other external
dependency in this codebase sits behind a port, and this one does not.

## "Free tier Kubernetes" mostly does not exist

Checked because it was the premise of the question, and it is the part that
decides the answer.

| Provider                   | What is actually free                                        |
| -------------------------- | ------------------------------------------------------------ |
| GKE                        | One zonal **control plane**. Nodes are billed.               |
| AKS                        | Control plane. Nodes are billed.                             |
| EKS                        | Nothing — the control plane is charged by the hour.          |
| DigitalOcean, Linode, Civo | No permanent free tier.                                      |
| Oracle Cloud Always Free   | Genuinely free and genuinely capable: 4 Ampere cores, 24 GB. |

Oracle is the only one that could carry all six containers for nothing. Two
caveats decide it: Ampere capacity is frequently unavailable in popular regions,
and free accounts are reclaimed for inactivity. That is an acceptable risk for a
side project and not an acceptable one for the service that holds a customer's
authentication.

So the realistic shape is **one small VM running k3s, roughly $5–12 a month** —
which is fine, but it is a VM we are buying, not a free tier we are using.

Free-tier terms move. Anyone acting on this table should re-check it.

## What we would take on

- **Wildcard TLS for `*.app.kithena.com`.** cert-manager with a DNS-01 solver
  against the registrar's API. Routine, and ours to renew.
- **We lose** per-pull-request preview deployments, which `ci` currently uses,
  and the one-command rollback in `vercel-production.yml`.
- **We gain** no deploy cap, real access control, and one deploy for six apps
  instead of six deploys that can disagree — the wildcard-alias bug in
  `vercel-staging.yml` was exactly that class of mistake.
- **We own** node patching, cluster upgrades, certificate renewal, monitoring,
  and somebody being reachable when it breaks at 02:00.

That last line is the actual cost. Everything above it is a week of work.

## Recommendation

In order, and Kubernetes is not first.

1. **Pay for Vercel Pro before doing anything else.** The problems that prompted
   this were Hobby's, not Vercel's: a 100-deploy daily cap, and the fact that
   Hobby _cannot_ protect a production deployment at all — which is why
   `pnpm docs:brand-leak` is a merge gate rather than a convention. Both go away
   for about the price of an hour of the time this would otherwise take.

2. **Put object storage behind a port,** and make `BLOB_HOST` configuration
   rather than a literal in a domain rule. This pays off whether we move or not:
   it is the only piece that would otherwise need a data migration, and it is
   currently the only external dependency without a port.

3. **Containerise `identity` and `messaging` first** if the appetite survives
   step 1. They are ready today, and they are where the function model fits
   worst — the gateway comment names Postgres pooling as "the objection that
   sent this service to a container in the first place".

4. **Move the Next apps only if** multi-cloud becomes a requirement or the cost
   curve bends. They are both the easiest to move and the least painful to leave
   where they are.

The summary: the codebase will not fight a move, the free tier will not fund one,
and the question is not whether we can run our own platform but whether we want
to be the team that does.
