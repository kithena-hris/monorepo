# The Documents service, as a container.
#
# Time Off's Dockerfile with the names changed, for People's reasons: Documents
# holds Kafka consumer groups, a nightly sweep and a SIGTERM drain, none of
# which a function-per-request runtime keeps. `services/people/Dockerfile` has
# the longer account of each.
#
# `graphql` is a runtime dependency in `package.json`, not a dev one: the image
# installs with `pnpm deploy --prod`, and People's production deploy failed on
# exactly that (#208).

# --------------------------------------------------------------------- build
FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline

# Turbo, because `build` depends on `codegen` (the generated redaction paths
# telemetry compiles against).
RUN pnpm turbo run build --filter=@kithena/documents...

RUN pnpm --filter @kithena/documents deploy --prod --legacy /app

# --------------------------------------------------------------------- serve
FROM node:24-bookworm-slim AS serve
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

USER node

EXPOSE 4003

# `node` directly, not `pnpm start`: a package manager in between swallows the
# SIGTERM the drain is waiting for.
CMD ["node", "dist/src/main.js"]
