export const TEST_DB_NAME = 'agency_test';

/**
 * Derives the vitest database URL from the dev DATABASE_URL by swapping the database
 * name. Vitest suites must never run against the dev database: its seeded org
 * ('Sunday AI Work') is live data, and fixtures written there enter real pipelines.
 */
export function toTestDatabaseUrl(devUrl: string): string {
  const url = new URL(devUrl);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}
