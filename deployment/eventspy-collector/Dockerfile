ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp/eventspy-home
COPY --chown=1000:1000 package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=1000:1000 scripts/tickets/eventspy-mirror.mjs ./scripts/tickets/
COPY --chown=1000:1000 src/lib/tickets/eventspy-mirror-schema.mjs src/lib/tickets/eventspy-coverage.mjs ./src/lib/tickets/
USER 1000:1000
ENTRYPOINT ["node", "scripts/tickets/eventspy-mirror.mjs"]
