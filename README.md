# AgencyOS

Greenfield agentic recruiting agency platform. Spec:
`Agentic_Recruiting/01-architecture/agentic-agency-greenfield-design_2026-07-09.md`.

Agents (n8n) propose decisions → decision store (Postgres) → cockpit approves per
autonomy tier → capability agents execute. Agents never act directly.

## Local setup

```bash
docker compose up -d      # Postgres 17 + pgvector on :5433
cp .env.example .env.local  # or create with DATABASE_URL + AGENT_API_KEY
npm install
npm run db:migrate
npm run db:seed           # default org + autonomy policy defaults
npm test
npm run dev
```

## Key paths

- `src/contracts/` — the Decision Zod contract + state machine (source of truth)
- `src/db/schema/` — core / crm / ats / agentic / intelligence clusters
- `src/services/decision-store.ts` — propose (policy-driven), transition, queue
- `src/app/api/agent/decisions/` — n8n's single write path (`x-agent-api-key`)
