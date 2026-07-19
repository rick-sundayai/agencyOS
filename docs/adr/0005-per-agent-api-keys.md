# 0005: Authenticate agents individually with per-agent API keys

**Date:** 2026-07-19
**Status:** Accepted

## Context

Every `/api/agent/*` route is gated by `requireAgentKey` ([agent-auth.ts](../../src/lib/agent-auth.ts)), which compares the request's `x-agent-api-key` header against one shared `AGENT_API_KEY` env var. The transition route additionally accepts `actor: z.string().min(1)` as free text in the request body and writes it straight into `approved_by`/`cancelled_by` ([decision-store.ts](../../src/services/decision-store.ts)) — the audit trail for who dispositioned a Decision.

This means any caller holding the one shared key can claim to be any Agent. Contrast with the human path: `queue-actions.ts` derives `actor` from the authenticated `next-auth` session (`session.user.id`), never from client input. The domain model (`CONTEXT.md`'s Agent and Agent roster entries) already treats Agents as distinct named actors, but nothing in the system enforces that a call claiming to be one agent actually came from that agent's credential — and the codebase is heading toward genuinely multiple, independently-operating agents, not one shared automation runtime.

There is currently no registered notion of "Agent" as an entity at all — the visible Agent roster is derived by grouping free-text `agent_runs.agent` strings, with no backing table.

## Decision

We will introduce a minimal `agents` table (`id`, `org_id`, `name`, `api_key_hash`) used only for authenticating `/api/agent/*` calls, and change `requireAgentKey` to hash the incoming key (SHA-256) and look up the owning agent, returning that resolved identity instead of a boolean. The transition route drops `actor` from its request body entirely — `actor` is now always the server-resolved agent name, mirroring how the human path already derives `userId` from the session rather than trusting client input.

We chose per-agent static keys over JWTs because there's no token-issuance infrastructure or stated requirement for short-lived credentials — JWTs would add a subsystem to solve a problem that doesn't exist yet. We chose SHA-256 over a slow KDF (bcrypt/argon2) because these are high-entropy random tokens, not human passwords; a slow KDF adds latency with no corresponding security benefit. We scoped the new `agents` table to authentication only, leaving `agent_runs.agent` as free text and the roster derivation untouched — unifying "Agent" into one system-of-record everywhere is a real future improvement but drags in a migration of historical data and roster/health-rail code unrelated to closing this security gap. Provisioning is a manual operator-run script (no admin UI, no self-service rotation), and rollout is a hard cutover per client "stamp" (no dual-support window) — each stamp is an isolated environment where the operator controls both the server and the calling n8n credentials directly, so there's no untrusted third party to support gradually.

## Consequences

**Positive:**
- Closes the spoofing gap: `approved_by`/`cancelled_by` now reflects who actually authenticated, not what the caller claimed.
- Agent and human paths become structurally symmetric — both derive `actor` server-side from the authenticated identity.
- Per-agent keys can be individually revoked without invalidating every other agent's access.

**Negative / trade-offs:**
- Key rotation is manual (rerun the script, update Secret Manager/n8n, no expiry safety net).
- `agents` and `agent_runs.agent` are two separate, unreconciled representations of "Agent" until a future unification pass.
- Hard cutover requires coordinating each stamp's n8n credential update with its deploy — a missed stamp breaks that stamp's agent calls until fixed.
- The transition endpoint's request body also changed shape (the `actor` field was removed) — a caller still sending `actor` gets 400 regardless of whether its key was rotated, so a stamp's n8n workflow must update both the credential AND the transition-call payload together.

**Neutral:**
- Introduces the first registered identity table for Agents; the roster continues to be free-text-derived until a later ADR addresses unification.
