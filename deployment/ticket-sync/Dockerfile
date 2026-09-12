ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE}

ENV NODE_ENV=production
WORKDIR /app

# The synchronizer uses only Node built-ins. No package manager install or
# credentials are needed in the image.
COPY --chown=node:node scripts/tickets ./scripts/tickets
COPY --chown=node:node src/lib/schedule.mjs ./src/lib/schedule.mjs
COPY --chown=node:node src/lib/tickets ./src/lib/tickets
COPY --chown=node:node src/data/nfl/{team}.json ./src/data/nfl/{team}.json
COPY --chown=node:node src/data/tickets/match-overrides.json ./src/data/tickets/match-overrides.json

USER node
ENTRYPOINT ["node", "scripts/tickets/sync.mjs"]
