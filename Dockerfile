# Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
# Dummy values: module-level getEnv() calls run during `next build` page-data
# collection. These never reach the runtime image (separate stage).
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    AUTH_SECRET=build-only \
    AGENT_API_KEY=build-only \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- migrate target: full deps + tsx, runs drizzle migrations then exits.
# Also doubles as the one-off ops-script runner (bootstrap-staging-operator,
# create-agent-key): the Cloud SQL instance has no public IP, so these only
# run from inside the VPC — via `gcloud run jobs execute migrate
# --command=... --args=...`, reusing this job's existing VPC access instead
# of a laptop-side cloud-sql-proxy. ---
FROM deps AS migrate
COPY drizzle ./drizzle
COPY scripts/migrate.ts ./scripts/migrate.ts
COPY scripts/ops ./scripts/ops
COPY scripts/agents ./scripts/agents
COPY src/lib/env.ts ./src/lib/env.ts
COPY src/lib/agent-auth.ts ./src/lib/agent-auth.ts
COPY src/db/client.ts ./src/db/client.ts
COPY src/db/schema ./src/db/schema
COPY tsconfig.json ./
CMD ["npx", "tsx", "scripts/migrate.ts"]

# --- runtime target: minimal standalone server ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
