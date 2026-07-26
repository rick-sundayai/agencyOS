# Concept mapping worksheet (#20)

Fill this in the same day as the session. This is the artifact the core/module split ticket
consumes — it, not the raw notes, is what resolves #20.

**Verdict codes:**

- `CORE` — same shape in both verticals; belongs to the brokerage core
- `MODULE` — exists in both but the substance differs enough that each vertical owns it
- `RECRUITING-ONLY` — no real estate equivalent; belongs to the recruiting module
- `RE-ONLY` — real estate needs it and recruiting has nothing like it; the core is missing something
- `BREAKS` — the recruiting model is actively wrong for real estate; core-model change required

`RE-ONLY` and `BREAKS` rows are the valuable ones. A worksheet with none of them means the session
was too polite.

---

## Parties

| Recruiting (as built) | Proposed core concept | Real estate equivalent | Verdict | Evidence / their words |
|---|---|---|---|---|
| `clients` (employer) | Client | | | |
| `prospects` | Prospect | | | |
| `candidates` | Counterparty | | | |
| — | Third parties (solicitor, notary, surveyor, lender) | | | |

**Key question this table answers:** is client-vs-counterparty a *type* or a *role*? If one party
can be both simultaneously, it's a role, and the core model changes.

---

## Inventory

| Recruiting (as built) | Proposed core concept | Real estate equivalent | Verdict | Evidence / their words |
|---|---|---|---|---|
| `jobs` / job order | Inventory item | | | |
| Job order closes when filled | Single lifecycle per item | | | |
| — | Asset with an owner, outliving its pipeline | | | |
| — | Price that changes over time | | | |

---

## Pipeline and stage

| Recruiting (as built) | Proposed core concept | Real estate equivalent | Verdict | Evidence / their words |
|---|---|---|---|---|
| `applications` (candidate × job) | Pipeline instance | | | |
| `PIPELINE_STAGES` (7, forward-only) | Stage vocabulary | | | |
| One stage at a time | Single-stage invariant | | | |
| Independent applications | Independence of instances | | | |
| — | Chain / cross-instance dependency | | | |

**Watch:** the independence assumption is the most fragile thing in the current model. If a chain
is normal, one pipeline instance's stage depends on instances the agency may not even own.

---

## Activities and conversations

| Recruiting (as built) | Proposed core concept | Real estate equivalent | Verdict | Evidence / their words |
|---|---|---|---|---|
| `conversations` / `messages` | Conversation | | | |
| Interview (agency absent) | Scheduled activity | | | |
| — | Attended activity with an outcome report (viewing) | | | |
| `consents` (per channel) | Consent | | | |

---

## Documents and compliance

| Recruiting (as built) | Proposed core concept | Real estate equivalent | Verdict | Evidence / their words |
|---|---|---|---|---|
| CV / resume | Counterparty document | | | |
| Consent gate on outreach | Compliance gate | | | |
| — | Mandatory disclosure before listing or sale | | | |
| — | Identity / AML check on a party | | | |

**Key question:** does compliance gate *communication* (as built) or the *transaction* (likely in
real estate)? If both, the compliance gate is core but its trigger points are vertical.

---

## Match and money

| Recruiting (as built) | Proposed core concept | Real estate equivalent | Verdict | Evidence / their words |
|---|---|---|---|---|
| `placements` | Completed match | | | |
| Fee on start date, % of salary | Commission trigger | | | |
| Rebate if placement fails | Clawback | | | |
| Single agency earns | Fee ownership | | | |
| — | Split between agencies | | | |
| `timesheets` | — | | | |

**Note:** `timesheets` is almost certainly `RECRUITING-ONLY` (contract staffing). Confirm it,
because it's currently sitting in the `ats` cluster as if it were peer to placements.

---

## External systems

| Recruiting (as built) | Proposed core concept | Real estate equivalent | Verdict | Evidence / their words |
|---|---|---|---|---|
| JobDiva client | External system of record | | | |
| Internal-first sourcing, external fallback | Sync policy | | | |

**If this row comes back `CORE`,** it changes the architecture: "sync with an external system of
record" moves out of the recruiting module and into the brokerage core, and the JobDiva client
becomes one adapter behind a core interface.

---

## Autonomy tiers

| Action the agent would take | Recruiting tier (as built) | RE agent's instinct | Same? |
|---|---|---|---|
| Draft and send routine follow-up | | | |
| Schedule a viewing / interview | | | |
| Send something to the client | | | |
| Anything involving money or a legal commitment | | | |

**If the tier boundaries land in different places,** the Autonomy policy needs per-vertical
defaults — a governance-runtime change, and the first evidence that layer 1 is not as
vertical-agnostic as assumed.

---

## Falsification results

| # | Claim | Survived? | If not, what breaks |
|---|---|---|---|
| 1 | A party is either a client or a counterparty, never both | | |
| 2 | Inventory is created, matched once, and closes | | |
| 3 | One pipeline instance's progress is independent of any other | | |
| 4 | Commission is earned by one agency on one completed match | | |
| 5 | Compliance gates outreach, not the transaction | | |

---

## Verdict

**Core coverage estimate:** of a real estate agent's working week, roughly what fraction would the
proposed brokerage core serve as designed? Give a fraction and the reasoning.

**Thesis status** — pick one and justify it in two or three sentences:

- **Holds.** The core is substantial; real estate is a module on top of it.
- **Holds with changes.** The core is substantial but wrong in specific named places.
- **Thin.** The core is a small fraction of each vertical. AgencyOS is a shared library, not a
  platform — and ADR-0009 should be revisited rather than defended.

**Three things the current model gets wrong:**

1.
2.
3.

**Follow-up questions for the second conversation:**

-
-
