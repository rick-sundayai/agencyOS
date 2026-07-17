# 0002: Ship both light and dark themes on a variable token layer

**Date:** 2026-07-17
**Status:** Accepted

## Context

RecruiterPro's design system is authored **light only** — a deliberate "operations room": near-white `--paper`, warm-cool ink neutrals, and soft semantic tints built with `color-mix(... , var(--paper))`. There are no dark tokens anywhere in its CSS. A core principle is "color is the alarm": healthy states are monochrome (neutral ink), so any color reads as a signal.

The team wants dark mode (a preference confirmed during design, not inferred from any config — AgencyOS has no theming config today). The options were: adopt light only, replace with dark only, or support both via a swappable token layer. We chose both.

The catch is that the design's soft tints are computed against `--paper`. When `--paper` flips dark, every `color-mix` soft token (`--good-soft`, `--warn-soft`, `--bad-soft`, `--accent-soft`, and the `.dcard.risk` / `.htile.alert` tints) is re-derived rather than inherited — and "color is the alarm" must be re-validated, because neutral ink that reads as calm on paper does not automatically read as calm on a dark canvas.

## Decision

We will ship light and dark as two token sets over a single CSS-variable layer, switched by a theme toggle (e.g. `data-theme` on the root), with light as the default. The dark token set is authored net-new — including a re-derived soft-tint palette — and must preserve the "color is the alarm" behavior (healthy = neutral, color = signal).

We chose dual-theme over light-only because dark mode is a wanted feature, and over dark-only because RecruiterPro's components are tuned for light and light stays the reference rendering.

## Consequences

**Positive:**
- Operators get a dark mode; light remains the faithful reference design.
- A single token layer means components stay theme-agnostic — they read variables, not literals.

**Negative / trade-offs:**
- Net-new work: a full dark token set plus re-derived semantic soft tints; not a free inversion of light.
- Every semantic tint and shadow must be checked in dark for the "color is the alarm" principle; regressions there are subtle.
- Ongoing cost: new components must be verified in both themes.

**Neutral:**
- Introduces a theme-switch mechanism and a root theme attribute the app must set and persist.
