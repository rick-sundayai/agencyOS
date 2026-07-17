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

### Agent roster

The always-visible list of agents in the Control Room sidebar with their current status (working / review / idle / stalled). Its job is to make a stalled agent obvious at a glance.

### Drawer

The slide-in panel over the Cockpit used to disposition a single Decision — its full reasoning, evidence, and payload — without leaving the queue. Records that warrant study (candidate, job order, client) open as full pages instead, not in the Drawer.

### Health rail

The set of operational vital signs shown as tiles above the queue. Calm by default — a healthy signal is monochrome, so color is reserved as the alarm. Tapping a tile drills into the underlying view.

**Distinguishes from:** Cockpit — see Cockpit.

### Consent

A candidate's permission status for a given outreach channel (granted / revoked / unknown). It is the compliance basis for any agent outreach: contacting a candidate on a channel without granted consent is a compliance breach.

**Invariants:**
- Consent is tracked per candidate per channel.
- Absence of a granted Consent is treated as "not permitted," not "permitted."
