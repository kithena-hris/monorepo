# The audit service (`docs/audit.md`), as a container beside People on the VM.
#
# Not a Vercel function like messaging: it holds a Kafka consumer group open to
# read every module's topic, which a function that stops existing between
# requests cannot keep. Built from the repository root for the workspace and
# the lockfile, as People's and Slack's are; People's Dockerfile has the
# reasons for each layer.

# --------------------------------------------------------------------- build
FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline

RUN pnpm turbo run build --filter=@kithena/audit...

RUN pnpm --filter @kithena/audit deploy --prod --legacy /app

# --------------------------------------------------------------------- serve
FROM node:24-bookworm-slim AS serve
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

USER node

EXPOSE 4103

# `node` directly, so the SIGTERM reaches the drain.
CMD ["node", "dist/src/main.js"]
