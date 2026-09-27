# The Slack service, as a container beside People on the VM.
#
# Not a Vercel function like messaging: it holds a Socket Mode connection open
# to Slack — a WebSocket that must outlive every request — and answers Slack
# within three seconds of an event. Built from the repository root for the
# workspace and the lockfile, as People's is; People's Dockerfile has the
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

RUN pnpm turbo run build --filter=@kithena/slack...

RUN pnpm --filter @kithena/slack deploy --prod --legacy /app

# --------------------------------------------------------------------- serve
FROM node:24-bookworm-slim AS serve
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

USER node

EXPOSE 4102

# `node` directly, so the SIGTERM reaches the drain.
CMD ["node", "dist/src/main.js"]
