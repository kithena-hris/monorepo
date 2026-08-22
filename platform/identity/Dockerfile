# The identity service, as a container.
#
# It is not a Vercel function and cannot become one: it holds a Postgres pool
# and a Valkey connection across requests, which is exactly what a
# function-per-request runtime takes away. Every request would open a new
# connection, and Postgres would run out of them long before the traffic
# justified it.
#
# So it wants somewhere that runs a process. `docs/authentication.md` argued for
# containers behind an ingress for the product too; this is the first piece with
# no alternative.

# --------------------------------------------------------------------- build
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

# The lockfile, the manifests and the patches, before any source. A change to a
# `.ts` file then does not invalidate the dependency layer. The patches are here
# because the lockfile names them, and `pnpm fetch` fails on a patch it cannot
# find rather than skipping it — which is the right way round, since a patch
# that silently did not apply is a dependency behaving differently in production
# than anywhere else.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline

# Turbo rather than a plain recursive run, and the difference is not ordering.
# `turbo.json` declares `build` as depending on `codegen`, and contracts' codegen
# writes `packages/telemetry/src/generated/redaction.ts` — an output, never
# committed, that telemetry does not compile without. pnpm orders packages by
# their dependency graph and knows nothing about that task, so a plain run fails
# inside `domain-kit` on an import of a `dist` nothing had built.
RUN pnpm turbo run build --filter=@kithena/identity...

# One directory holding the service and the production half of its dependency
# tree, with the workspace links resolved into real files.
#
# The alternative — copying the whole built repo and reinstalling `--prod` on
# top of it — was the first attempt, and it ran for twenty minutes without
# finishing: every dev dependency in the monorepo was copied into the runtime
# stage before being thrown away again.
RUN pnpm --filter @kithena/identity deploy --prod --legacy /app

# --------------------------------------------------------------------- serve
FROM node:22-alpine AS serve
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

# Not root. A process that never writes to disk has no reason to be able to.
USER node

EXPOSE 4100

# `dist/src/main.js`: `rootDir` is the package and `outDir` is `dist`, so the
# tree beneath it keeps the `src` level.
CMD ["node", "dist/src/main.js"]
