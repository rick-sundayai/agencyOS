# Discovery guide — sit with a working estate agent

**Ticket:** #20 · **Type:** `wayfinder:task` (HITL) · **Blocks:** the brokerage core / recruiting
module split

---

## Why this session exists

AgencyOS's thesis is that recruiting and real estate share a brokerage core: parties, inventory,
pipelines, activities, documents and commission. Right now that claim is reasoned from the
outside — from structural similarity — by people with no real estate domain knowledge. Nobody in
the effort can name a single thing an estate agency does that recruiting has no equivalent for.

That silence is the risk. It is far more likely to mean the vertical hasn't been looked at
properly than that no divergence exists.

**So this is a falsification exercise, not a validation one.** You are not going to find out
whether the thesis is nice. You are going to find out where it breaks. A session that produces no
surprises has failed.

## What resolving the ticket looks like

Notes good enough that the core/module split can be argued against a real workflow. Concretely:

- The concept mapping worksheet is filled in, with a verdict on every row.
- At least three places where the recruiting model does **not** transfer are named specifically.
- You can state, with a number attached, roughly how much of an estate agent's working week the
  proposed brokerage core would actually cover.

If the honest answer is "the core is thin," that is a successful session. Record it. It kills the
platform thesis cheaply, which is the entire point of doing this before designing anything.

---

## Before the room

**Pick the right person.** A working sales agent or negotiator with two or more years on the job.
Not a branch director (they'll describe the business, not the work), not someone who left the
industry three years ago, not a lettings-only specialist unless lettings is in scope.

**Get a second, shorter conversation if you can.** Twenty minutes with a sales progressor,
branch administrator or office manager is worth as much as the hour with the agent, because that
person *is* the operations layer. They do the chasing, the paperwork and the compliance. If layer
2 is real, they are the one who feels it.

**Decide the jurisdiction and write it down.** This matters more than it does in recruiting, and
it is the most likely place the thesis breaks:

- **US:** the MLS is the system of record. Listings, comps and status live outside your software.
  Dual agency, escrow, title companies, a buyer's agent with a signed representation agreement.
- **UK:** no MLS. Portals (Rightmove, Zoopla) are advertising, not a record. Chains, gazumping,
  a sale that can collapse at any point until exchange, solicitors on both sides.
- **Germany:** no MLS; ImmoScout24 as the dominant portal. *Makler* commission split rules and
  *Bestellerprinzip* determine who pays, *Notar* handles the transaction, *Energieausweis* is
  mandatory disclosure.

These are not cosmetic differences. They change who the parties are, what documents exist, and
when commission is earned. If your recruiting customer runs JobDiva they are probably US-based —
do not assume the estate agency is in the same jurisdiction, and do not let one jurisdiction's
answers stand in for the vertical.

**Do not prepare a demo.** Do not open AgencyOS. Do not describe what you're building.

---

## Rules in the room

1. **Never pitch.** The moment they know what you want to hear, the data is worthless.
2. **Never ask "would you like a system that…"** — everyone says yes. Ask what they did last
   Tuesday.
3. **Ask for the last time, not the general case.** "Walk me through the last listing you took"
   beats "how do you take listings."
4. **Follow the pain, not the process.** Where they sigh, sit there and ask three more questions.
5. **Ask what they do outside their software.** The spreadsheet, the WhatsApp thread, the
   notebook, the thing they re-type twice. That's where the real model lives.
6. **Let them use their own words, then ask what the word means.** Their vocabulary is the domain
   model. When they say "instruction" or "chain" or "under offer," make them define it.
7. **Shut up.** Long silences are where the good material arrives.

---

## Session shape — 90 minutes

| Minutes | What |
|---|---|
| 0–10 | Their role, patch, volume. How many listings live, how many buyers on the books, how many sales in flight. |
| 10–50 | **Walk the week.** Last Monday to last Friday, chronologically. Interrupt only to ask what a word means or what happened next. |
| 50–75 | Targeted probes from the question bank — only the ones the walk didn't already answer. |
| 75–85 | Money. Commission, when it's earned, when it's lost. |
| 85–90 | The two closing questions (below). |

---

## Question bank

Grouped by the core concept each question is testing. Don't ask all of them — the walk-the-week
should answer half. Use these to fill gaps and to probe where you smell divergence.

### Party — is "client and counterparty" the right shape?

- Who is your client on a sale — the seller, the buyer, or both? Can it be both at once?
- Have you ever had someone who is selling with you *and* buying through you? How do you keep
  track of that?
- Who else is involved in a sale who isn't the buyer or the seller?
- Does a buyer ever "belong" to you formally, or are they just someone on a list?

**What we're testing:** recruiting has a clean split — the employer pays, the candidate is placed,
never the same entity. If a single person is routinely both vendor and buyer, "client" and
"counterparty" are roles a party plays, not types of party. That's a core-model change.

### Inventory — is a listing really a job order?

- Walk me through taking on a new listing. What happens before it goes live?
- What can change about a listing after it's live? How often does the price move?
- What happens to a listing that doesn't sell?
- Can one property be listed more than once, or with more than one agency?
- Does a listing ever come back after it's sold?

**What we're testing:** a job order is opened, filled once, and closes. A property is a long-lived
asset with an owner, a moving price and repeat lifecycles. If listings routinely re-list, the
core needs an asset that outlives its pipeline instance — recruiting has no such thing.

### Pipeline and stage — is there one pipeline or several?

- From first enquiry to completion, what are the stages a sale goes through? What do you call
  them?
- Which of those stages can go backwards?
- What's the difference between a buyer who's interested and a buyer who's made an offer?
- Do you track the buyer's progress, the property's progress, or the sale's progress?
- What's a chain, and what does it do to your week?

**What we're testing:** in recruiting an Application is one candidate against one job, in exactly
one stage, and it moves forward. If a chain means one sale's progress depends on three other
sales at other agencies, no pipeline in AgencyOS models that today. This is the single most
likely place the thesis breaks — sit here longest.

### Activity and conversation

- How many people do you chase in a normal day, and about what?
- What do you follow up that you'd forget without a reminder?
- Where do your conversations happen? How much is phone versus WhatsApp versus email?
- What does a viewing involve for you before, during and after?

**What we're testing:** viewings are scheduled, attended and reported on. Recruiting interviews
are similar but the agency usually isn't present. If the agent physically attends and produces
feedback, that's an activity type with an outcome the core doesn't have.

### Document and compliance

- What paperwork exists on a sale, and who produces each piece?
- What are you legally required to collect or show, and when?
- What ID or money-laundering checks do you do, on whom, and at what point?
- What happens if a document is missing at the wrong moment?

**What we're testing:** recruiting's compliance is consent-and-contact based (see `CONTEXT.md` →
Consent). Property compliance is disclosure-and-identity based, and it gates the transaction
rather than the outreach. Different shape, possibly different layer.

### Match and commission

- When exactly do you get paid, and what has to be true first?
- Can you do all the work and get nothing? How often does that happen, and why?
- If a sale falls through after you've been paid, what happens?
- Is your fee ever split with another agent or agency?

**What we're testing:** a placement fee is invoiced on a start date with a rebate clause. A sale
commission triggers on exchange or completion, can be split, and can evaporate late. If splits
between agencies are normal, commission has a party structure recruiting never needed.

### External system of record

- What software do you use today, and what do you keep outside it?
- What do you have to type into more than one place?
- Where does the authoritative version of a listing live — your system, or somewhere else?

**What we're testing:** JobDiva is treated as a recruiting-specific integration in AgencyOS today.
If real estate has an equivalent external system of record — MLS, a portal feed — then "sync with
an external system of record" is a **core** capability, not a vertical one. That's a finding worth
the whole session on its own.

### Autonomy — what would they let a machine do?

- If something could draft your follow-ups overnight, which ones would you send without reading?
- Which ones would you never let go out unread?
- What would you want to know had happened, versus be asked about first?
- What's the worst thing an assistant could get wrong on your behalf?

**What we're testing:** the governance runtime's Tier model, against a second vertical. If their
tier boundaries fall in the same places as recruiting's, the Autonomy policy generalises as built.
If not, the policy needs per-vertical defaults.

### The two closing questions

1. **"What's the thing about this job that people outside it always get wrong?"**
2. **"If I built you software that did everything you've described, what would still be missing?"**

The second one has produced more architecture changes than any other question on this page. Ask
it, then don't speak.

---

## Falsification tests

Five claims the current architecture rests on. After the session, mark each one.

| # | Claim | Survived? |
|---|---|---|
| 1 | A party is either a client or a counterparty, never both | |
| 2 | Inventory is created, matched once, and closes | |
| 3 | One pipeline instance's progress is independent of any other | |
| 4 | Commission is earned by one agency on one completed match | |
| 5 | Compliance gates *outreach*, not the transaction | |

Any claim that fails is a core-model change, not a module detail. Write it up as such.

---

## After the room

1. Fill in `20-concept-mapping-worksheet.md` while it's fresh — same day.
2. Mark the five falsification tests.
3. Estimate the core coverage: of the hours in their week, what fraction would the proposed
   brokerage core actually serve? A rough fraction with reasoning beats a confident number.
4. Post the answer as a resolution comment on #20 and close it:

```bash
gh issue comment 20 --body-file 20-session-capture.md
gh issue close 20 --comment "Resolved — see capture notes. Unblocks the core/module split ticket."
```

5. Add a one-line gist plus link to the map's **Decisions so far**.
6. If any of the five tests failed, say so explicitly in the gist. The next session needs to open
   the core/module ticket already knowing the model is wrong somewhere.

**If the session doesn't happen:** close #20 as skipped, and say so on the core/module ticket.
The map stays honest about proceeding on assumption rather than quietly implying validation that
never occurred.
