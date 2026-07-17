-- Custom SQL migration file, put your code below! --
CREATE UNIQUE INDEX candidates_org_jobdiva_uq ON candidates (org_id, jobdiva_id) WHERE jobdiva_id IS NOT NULL;
CREATE UNIQUE INDEX job_orders_org_jobdiva_uq ON job_orders (org_id, jobdiva_id) WHERE jobdiva_id IS NOT NULL;
CREATE UNIQUE INDEX clients_org_jobdiva_uq ON clients (org_id, jobdiva_id) WHERE jobdiva_id IS NOT NULL;
