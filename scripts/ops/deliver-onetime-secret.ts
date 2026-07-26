// Delivers a one-time bootstrap value (operator password, agent API key) via
// Secret Manager instead of stdout. The migrate Cloud Run Job's stdout is
// captured into Cloud Logging by default, and the log exclusion meant to keep
// these values out of durable storage (infra/modules/stamp/main.tf) works by
// dropping matching entries at the log router — which also makes them
// unrecoverable via `gcloud logging read`. Secret Manager access is
// IAM-gated and the version can be destroyed once retrieved.
export async function deliverOneTimeSecret(secretId: string, plaintext: string): Promise<void> {
  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  const client = new SecretManagerServiceClient();
  const projectId = await client.getProjectId();
  const parent = `projects/${projectId}`;
  const secretName = `${parent}/secrets/${secretId}`;

  try {
    await client.createSecret({
      parent,
      secretId,
      secret: { replication: { automatic: {} } },
    });
  } catch (e) {
    if ((e as { code?: number }).code !== 6 /* ALREADY_EXISTS */) throw e;
  }

  const [version] = await client.addSecretVersion({
    parent: secretName,
    payload: { data: Buffer.from(plaintext, 'utf8') },
  });

  console.log(`Value stored in Secret Manager as ${secretId}, version ${version.name?.split('/').pop()}.`);
  console.log(`Retrieve: gcloud secrets versions access ${version.name?.split('/').pop()} --secret=${secretId} --project=${projectId}`);
  console.log(`Then destroy it: gcloud secrets versions destroy ${version.name?.split('/').pop()} --secret=${secretId} --project=${projectId} --quiet`);
}
