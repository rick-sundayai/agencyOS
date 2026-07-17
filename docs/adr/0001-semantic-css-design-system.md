# 0001: Style via a semantic CSS design system, not utility classes

**Date:** 2026-07-17
**Status:** Accepted

## Context

AgencyOS is adopting RecruiterPro's design system wholesale to reskin the Cockpit and Control Room. RecruiterPro's system is authored as a **semantic CSS class library** (`app.css` tokens + `rp.css` components: `.dcard`, `.chip`, `.btn`, `.htile`, `.cstrip-pill`), driven by CSS custom properties.

AgencyOS already styles this way — its current `globals.css` uses semantic classes (`.card`, `.badge`, `.board`, `.topnav`), and Tailwind is **not installed** (no dependency, no config, no PostCSS wiring). The realistic alternative would have been to introduce Tailwind (utility-first) and re-express RecruiterPro's components as utility compositions.

## Decision

We will style AgencyOS with a semantic CSS design system — RecruiterPro's token + component-class layers. Utility-first CSS (Tailwind) is explicitly not adopted; it is not present today and will not be introduced.

This keeps a single styling paradigm across the app, lets us port RecruiterPro's components with near-zero translation, and keeps the design tokens (color, radius, shadow, type) in one authoritative place that the light/dark theme layer can pivot on. Splitting into utilities would fork the paradigm and dilute the token layer that theming depends on.

## Consequences

**Positive:**
- RecruiterPro components port with minimal rework; same class names, same tokens.
- Theming (see ADR 0002) has a single token surface to switch, not utilities scattered across markup.
- Markup stays readable; component intent lives in named classes, not utility strings.

**Negative / trade-offs:**
- No utility-class ergonomics for one-off spacing/layout tweaks; those need a class or inline style.
- Contributors expecting Tailwind must learn the semantic-class convention.

**Neutral:**
- No Tailwind is added; the styling standard is documented so contributors don't introduce it later. (There was no `tailwind.config.ts` to remove — an earlier note mistakenly attributed RecruiterPro's dead config to this repo.)
