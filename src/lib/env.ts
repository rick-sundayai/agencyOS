const KEYS = ['DATABASE_URL', 'AGENT_API_KEY'] as const;
export type EnvKey = (typeof KEYS)[number];

export function getEnv(key: EnvKey): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}
