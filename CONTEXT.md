# Context: Cockpit

The operator-facing surface for supervising autonomous recruiting agents: reviewing the actions they propose, disposing of them by autonomy tier, and monitoring operational health.

## Glossary

### Control Room

The product framing for AgencyOS as a whole: a single operator supervises a team of recruiting agents rather than doing the recruiting by hand. The Control Room is the shell (persistent sidebar with nav + live agent roster) that hosts the Cockpit and the ATS/CRM views.

### Cockpit

The operator's primary workspace: the live queue of Decisions awaiting disposition. The queue is the spine of the interface; everything else (health, drilling into a record) is arranged around it.

**Distinguishes from:** Health rail — the Cockpit is for *decisions* (things needing a call); the Health rail is for *health* (operational vitals that need no action when green).

### Decision

An action an agent proposes to take (an `action_class` such as an outreach or a submittal), carrying the reasoning behind it and the payload it would execute. A Decision is dispositioned by a human — or by policy — according to its Tier.

**Invariants:**
- Every Decision has exactly one Tier, assigned from the Autonomy policy for its action class.
- A Decision moves through states: proposed → (approved) → executed, or → cancelled; it is never silently dropped.
- A Risk-tier Decision can never be auto-approved.

### Tier

The autonomy level governing how a Decision is dispositioned. There are four:

- **Tier 1 — Auto:** approved by policy, executes without human involvement.
- **Tier 2 — Undo window:** executes automatically after a cancellable delay (the Undo window); the operator may Undo during it.
- **Tier 3 — Needs approval:** does not execute until a human explicitly Approves.
- **Risk:** flagged as risky; cannot be Approved, only Resolved by a human.

### Autonomy policy

The per-organization rule that maps an action class to its Tier and Undo-window length. It is the single source of truth for how much autonomy an agent has for a given kind of action.

### Undo window

The cancellable delay between a Tier-2 Decision being approved and it executing. Defaults to 15 minutes. During the window the operator sees a live countdown and can cancel.

### Agent

An autonomous worker that performs recruiting workflows and proposes Decisions. Agents are named actors (not the human operator) whose activity is recorded as Agent runs.

### Agent run

A single execution of an agent workflow, recording the model used, tokens, status, and any Decision it produced. Runs are the raw material for an agent's live status.

### Sourcing run

One recruiter-visible execution of the sourcing flow for a job order, created when a
recruiter clicks **Source candidates** (or imports a JobDiva job number). Tracks a
`phase` (`queued → searching_pool → checking_jobdiva → embedding_new → shortlisting →
screening → done | failed`) that the n8n sourcing workflow advances and the job page
polls.

**Invariants:**
- At most one non-terminal Sourcing run per job order at a time.
- The internal pool is always searched before JobDiva; JobDiva is only called when
  fewer than 10 good matches (cosine distance < 0.55) exist internally.
- A JobDiva failure never fails the run — it degrades to internal-only results.
- A non-terminal run untouched for 10 minutes is presumed dead and reported failed.

**Distinguishes from:** Agent run — an Agent run is one model-call's telemetry; a
Sourcing run is the recruiter-facing progress record spanning the whole flow.

### Agent roster

The always-visible list of agents in the Control Room sidebar with their current status (working / review / idle / stalled). Its job is to make a stalled agent obvious at a glance.

### Drawer

The slide-in panel over the Cockpit used to disposition a single Decision — its full reasoning, evidence, and payload — without leaving the queue. Records that warrant study (candidate, job order, client) open as full pages instead, not in the Drawer.

### Health rail

The set of operational vital signs shown as tiles above the queue. Calm by default — a healthy signal is monochrome, so color is reserved as the alarm. Tapping a tile drills into the underlying view.

**Distinguishes from:** Cockpit — see Cockpit.

### Pipeline

The board view of Applications arranged by Stage — one column per Stage, each card an Application (a candidate against a job order). Dragging a card advances the Application to a new Stage. It is the visual, operator-facing rendering of the same `applications.stage` data the ATS record pages read.

**Stage** — the canonical Application lifecycle vocabulary, defined once in `PIPELINE_STAGES` (`src/services/ats-views.ts`) and backing real `applications.stage` data plus the decision contracts. There are seven, in order: **sourced → screened → submitted → interviewing → offer → placed → rejected** (`placed` and `rejected` are terminal).

**Invariants:**
- A given Application is in exactly one Stage at a time.
- The Stage set is AgencyOS's own, not RecruiterPro's. RP's design mockup uses a different, throwaway set (`sourced/screened/contacted/interviewing/offer`); AgencyOS adopts RP's *visual* column treatment (per-stage color, drag-to-advance) but keeps its own Stage vocabulary. RP's `contacted` has no AgencyOS Stage — outreach is modelled as Conversations/Messages, not a pipeline Stage.

### Analytics

The operator-facing agency-performance view (RP's design ported to AgencyOS). Scoped to metrics AgencyOS's data can honestly back today: Decisions/day and Auto-run rate (`decisions`), Autonomy Tier split (`decisions.tier`), current Stage distribution (`applications.stage`), placements per month and Time-to-fill (`placements` + timestamps), candidate sources (`candidates.source`), and Agent team performance (`agent_runs`).

**Invariants:**
- Analytics shows only real derived numbers — never fabricated or placeholder figures.
- Metrics that require *event history* AgencyOS does not yet record are deliberately absent, not faked: **funnel conversion %** (stage-to-stage), **time-to-shortlist / per-stage timing**, and **placements-vs-goal**. These need a stage-transition log (`applications` stores only current Stage + `updated_at`) and per-org placement goals, both deferred to a follow-up.

### Consent

A candidate's permission status for a given outreach channel (granted / revoked / unknown). It is the compliance basis for any agent outreach: contacting a candidate on a channel without granted consent is a compliance breach.

**Invariants:**
- Consent is tracked per candidate per channel.
- Absence of a granted Consent is treated as "not permitted," not "permitted."
