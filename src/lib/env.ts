const KEYS = ['DATABASE_URL', 'AUTH_SECRET'] as const;
export type EnvKey = (typeof KEYS)[number];

export function getEnv(key: EnvKey): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export function poolMax(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 10;
}
