/**
 * The org's Agent personas — the fixed team shown on the roster and Agents page.
 * Single source of truth: `name` + `systemPrompt` are seeded into the agents table
 * (see src/db/reseed.ts); `icon` + `color` are presentational and consumed by the UI.
 */
export type AgentPersona = {
  name: string;
  systemPrompt: string;
  icon: string;
  color: string;
};

export const AGENT_PERSONAS: AgentPersona[] = [
  { name: 'Scout', systemPrompt: 'You are a helpful assistant.', icon: '🧭', color: '#6366f1' },
  { name: 'Sift', systemPrompt: 'You are a helpful assistant.', icon: '🔬', color: '#0ea5e9' },
  { name: 'Echo', systemPrompt: 'You are a helpful assistant.', icon: '📣', color: '#f59e0b' },
  { name: 'Atlas', systemPrompt: 'You are a helpful assistant.', icon: '🗺️', color: '#10b981' },
  { name: 'Envoy', systemPrompt: 'You are a helpful assistant.', icon: '✉️', color: '#ec4899' },
  { name: 'Sentry', systemPrompt: 'You are a helpful assistant.', icon: '🛡️', color: '#ef4444' },
  { name: 'Trace', systemPrompt: 'You are a helpful assistant.', icon: '🔎', color: '#8b5cf6' },
];

const BY_NAME = new Map(AGENT_PERSONAS.map((p) => [p.name.toLowerCase(), p]));

/** Look up a persona's presentation by agent name (case-insensitive); null if unknown. */
export function personaFor(name: string): AgentPersona | null {
  return BY_NAME.get(name.toLowerCase()) ?? null;
}
