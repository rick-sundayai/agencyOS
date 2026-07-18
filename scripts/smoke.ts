const base = process.env.SMOKE_BASE_URL;
if (!base) {
  console.error('SMOKE_BASE_URL is required');
  process.exit(1);
}

type Check = { name: string; run: () => Promise<void> };

const checks: Check[] = [
  {
    name: 'login page renders (200, html)',
    run: async () => {
      const res = await fetch(`${base}/login`, { redirect: 'follow' });
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('text/html')) throw new Error(`content-type ${type}`);
    },
  },
  {
    name: 'agent API is up and key-guarded (401/403 without key)',
    run: async () => {
      const res = await fetch(`${base}/api/agent/decisions`);
      if (res.status !== 401 && res.status !== 403)
        throw new Error(`expected 401/403, got ${res.status}`);
    },
  },
  {
    name: 'cockpit stream endpoint does not 5xx',
    run: async () => {
      const res = await fetch(`${base}/api/cockpit/stream`, { redirect: 'manual' });
      if (res.status >= 500) throw new Error(`status ${res.status}`);
      // Unauthenticated: any of 401/403/302/307 is fine — proves the route exists.
      await res.body?.cancel();
    },
  },
];

(async () => {
  let failed = 0;
  for (const check of checks) {
    try {
      await check.run();
      console.log(`ok   ${check.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${check.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
})();
