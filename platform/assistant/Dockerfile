# The assistant, as a container beside Slack, People and Time Off on the VM.
#
# No database, no Kafka, no role in Postgres (assistant PRD §15.1): it keeps
# nothing at rest, so the image is the service and its settings. Built from
# the repository root for the workspace and the lockfile, as Slack's is;
# People's Dockerfile has the reasons for each layer.

# --------------------------------------------------------------------- build
FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline

RUN pnpm turbo run build --filter=@kithena/assistant...

RUN pnpm --filter @kithena/assistant deploy --prod --legacy /app

# --------------------------------------------------------------------- serve
FROM node:24-bookworm-slim AS serve
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

USER node

EXPOSE 4104

# `node` directly, so the SIGTERM reaches the drain.
CMD ["node", "dist/src/main.js"]
