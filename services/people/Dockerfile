# The People service, as a container.
#
# Not a Vercel function, which is what identity and messaging became. Those two
# answer requests and hold nothing between them. People holds three things a
# function-per-request runtime takes away: Kafka consumer groups (`wireConsumers`
# and the policy reload), hourly and daily background jobs (`wireBackground`),
# and a SIGTERM drain that lets a message in hand and a job in flight finish
# before the pools close (PEO-118). A function that stops existing between
# requests has no consumer to keep in a group and no clock to tick.
#
# Built from the repository root, like identity's: the build needs the
# workspace and the lockfile. `docs/environments.md` "People, the router and the
# remote" has the host and the settings.
#
# Debian, not Alpine as identity's is. `@temporalio/core-bridge` ships a
# glibc-linked native module, and on musl the process dies at import with
# `gnu_get_libc_version: symbol not found` before it opens a port — found by
# running this image, which is the only place it shows.

# --------------------------------------------------------------------- build
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable

# Manifests and patches before any source, so a `.ts` change does not
# invalidate the dependency layer. Identity's Dockerfile has the reasons.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline

# Turbo, because `build` depends on `codegen` (the generated redaction paths
# telemetry compiles against), which a plain recursive run knows nothing about.
RUN pnpm turbo run build --filter=@kithena/people...

RUN pnpm --filter @kithena/people deploy --prod --legacy /app

# --------------------------------------------------------------------- serve
FROM node:22-bookworm-slim AS serve
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

USER node

EXPOSE 4001

# `dist/src/main.js`: `rootDir` is the package, so `src` survives into `dist`.
# `node` directly, not `pnpm start`: a package manager in between swallows the
# SIGTERM the drain is waiting for.
CMD ["node", "dist/src/main.js"]
