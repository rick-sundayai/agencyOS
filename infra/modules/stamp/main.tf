terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

resource "google_project" "stamp" {
  name            = "AgencyOS ${var.stamp_name}"
  project_id      = var.project_id
  org_id          = var.folder_id == null ? var.org_id : null
  folder_id       = var.folder_id
  billing_account = var.billing_account
  deletion_policy = "PREVENT"
}

data "google_project" "stamp" {
  project_id = google_project.stamp.project_id
}

# Org-wide Domain Restricted Sharing blocks allUsers IAM bindings by default;
# the app's public URL needs one, so this stamp's project gets an exception
# rather than loosening the constraint org-wide.
resource "google_org_policy_policy" "allow_public_invoker" {
  name   = "projects/${google_project.stamp.project_id}/policies/iam.allowedPolicyMemberDomains"
  parent = "projects/${google_project.stamp.project_id}"
  spec {
    rules {
      allow_all = "TRUE"
    }
  }
}

locals {
  # app_image/migrate_image are "<location>-docker.pkg.dev/<project>/<repo>/<name>:<tag>"
  ar_parts    = split("/", var.app_image)
  ar_location = trimsuffix(local.ar_parts[0], "-docker.pkg.dev")
  ar_project  = local.ar_parts[1]
  ar_repo     = local.ar_parts[2]
}

# Cloud Run pulls app/migrate images from the ops project's registry; its
# per-project Service Agent needs read access there since the images live
# in a different project than the one running them.
resource "google_artifact_registry_repository_iam_member" "stamp_pulls_images" {
  project    = local.ar_project
  location   = local.ar_location
  repository = local.ar_repo
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${data.google_project.stamp.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "compute.googleapis.com",
    "aiplatform.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
  ])
  project = google_project.stamp.project_id
  service = each.value
}

# ---------- network (private services access for Cloud SQL) ----------
resource "google_compute_network" "vpc" {
  project                 = google_project.stamp.project_id
  name                    = "stamp"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  project       = google_project.stamp.project_id
  name          = "stamp-${var.region}"
  region        = var.region
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.10.0.0/24"
}

resource "google_compute_global_address" "psa" {
  project       = google_project.stamp.project_id
  name          = "psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "psa" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa.name]
}

# ---------- database ----------
resource "google_sql_database_instance" "pg" {
  project          = google_project.stamp.project_id
  name             = "agencyos"
  region           = var.region
  database_version = "POSTGRES_17"
  settings {
    tier    = var.db_tier
    edition = "ENTERPRISE"
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
  }
  deletion_protection = var.sql_deletion_protection
  depends_on          = [google_service_networking_connection.psa]
}

resource "google_sql_database" "app" {
  project  = google_project.stamp.project_id
  name     = "agency"
  instance = google_sql_database_instance.pg.name
}

resource "google_sql_database" "n8n" {
  project  = google_project.stamp.project_id
  name     = "n8n"
  instance = google_sql_database_instance.pg.name
}

resource "random_password" "db_app" {
  length  = 32
  special = false
}

resource "random_password" "db_n8n" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  project  = google_project.stamp.project_id
  name     = "app"
  instance = google_sql_database_instance.pg.name
  password = random_password.db_app.result
}

resource "google_sql_user" "n8n" {
  project  = google_project.stamp.project_id
  name     = "n8n"
  instance = google_sql_database_instance.pg.name
  password = random_password.db_n8n.result
}

# ---------- secrets ----------
resource "random_password" "auth_secret" {
  length  = 44
  special = false
}

resource "random_password" "agent_api_key" {
  length  = 44
  special = false
}

resource "random_password" "n8n_encryption_key" {
  length  = 44
  special = false
}

locals {
  db_host = google_sql_database_instance.pg.private_ip_address
  secrets = {
    "database-url"       = "postgres://app:${random_password.db_app.result}@${local.db_host}:5432/agency"
    "auth-secret"        = random_password.auth_secret.result
    "agent-api-key"      = random_password.agent_api_key.result
    "n8n-db-password"    = random_password.db_n8n.result
    "n8n-encryption-key" = random_password.n8n_encryption_key.result
    "jobdiva-client-id"  = var.jobdiva_client_id
    "jobdiva-username"   = var.jobdiva_username
    "jobdiva-password"   = var.jobdiva_password
  }
  # Not derived from local.secrets: the 5 random_password-backed values are
  # unknown until apply, which would make this map's truthiness undecidable
  # at plan time (and break every for_each keyed on it below). Those 5 are
  # always non-empty by construction; only the jobdiva-* keys are genuinely
  # optional, and are plan-time-known straight from the input variables.
  secret_has_value = {
    "database-url"       = true
    "auth-secret"        = true
    "agent-api-key"      = true
    "n8n-db-password"    = true
    "n8n-encryption-key" = true
    # nonsensitive(): knowing whether the string is empty doesn't leak its
    # content, but without stripping the mark, sensitivity from the jobdiva_*
    # vars would propagate onto this map and, from there, onto every for_each
    # keyed on it below.
    "jobdiva-client-id" = nonsensitive(var.jobdiva_client_id != "")
    "jobdiva-username"  = nonsensitive(var.jobdiva_username != "")
    "jobdiva-password"  = nonsensitive(var.jobdiva_password != "")
  }
}

resource "google_secret_manager_secret" "s" {
  for_each  = local.secrets
  project   = google_project.stamp.project_id
  secret_id = each.key
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "s" {
  # for_each must resolve to a set of plain key strings, not a copy of
  # local.secrets: re-deriving a map via a for-expression over sensitive
  # values loses Terraform's per-key sensitivity handling and taints the
  # whole for_each argument. secret_data indexes the original map directly
  # instead, which keeps that handling intact.
  for_each    = toset([for k, v in local.secret_has_value : k if v])
  secret      = google_secret_manager_secret.s[each.key].id
  secret_data = local.secrets[each.key]
}

# ---------- service accounts ----------
resource "google_service_account" "app" {
  project      = google_project.stamp.project_id
  account_id   = "app-runtime"
  display_name = "AgencyOS app runtime"
}

resource "google_service_account" "n8n" {
  project      = google_project.stamp.project_id
  account_id   = "n8n-runtime"
  display_name = "n8n runtime"
}

resource "google_secret_manager_secret_iam_member" "app_reads" {
  for_each = toset(["database-url", "auth-secret", "agent-api-key",
  "jobdiva-client-id", "jobdiva-username", "jobdiva-password"])
  project   = google_project.stamp.project_id
  secret_id = google_secret_manager_secret.s[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "n8n_reads" {
  # jobdiva-* deliberately excluded: no n8n workflow calls JobDiva yet. Re-add
  # here (and to the env block below) only when one does.
  for_each  = toset(["n8n-db-password", "n8n-encryption-key", "agent-api-key"])
  project   = google_project.stamp.project_id
  secret_id = google_secret_manager_secret.s[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.n8n.email}"
}

# The migrate job (running as the app SA) doubles as the ops-script runner
# (bootstrap-staging-operator, create-agent-key) since Cloud SQL has no
# public IP. Those scripts deliver a one-time operator password / agent key
# through these secrets rather than stdout, which `gcloud run jobs execute`
# otherwise captures into Cloud Logging by default. Pre-created here (empty,
# no version) so the app SA only needs version-add/destroy, not project-wide
# secret creation.
resource "google_secret_manager_secret" "onetime_operator_password" {
  project   = google_project.stamp.project_id
  secret_id = "onetime-operator-password"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "onetime_agent_key" {
  project   = google_project.stamp.project_id
  secret_id = "onetime-agent-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "app_writes_onetime" {
  for_each = toset([
    google_secret_manager_secret.onetime_operator_password.secret_id,
    google_secret_manager_secret.onetime_agent_key.secret_id,
  ])
  project   = google_project.stamp.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretVersionManager"
  member    = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "app_vertex" {
  project = google_project.stamp.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# CI deployer may deploy services/jobs in this stamp
resource "google_project_iam_member" "deployer_run" {
  project = google_project.stamp.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${var.deployer_sa}"
}
resource "google_project_iam_member" "deployer_sa_user" {
  project = google_project.stamp.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${var.deployer_sa}"
}

# ---------- Cloud Run: app ----------
resource "google_cloud_run_v2_service" "app" {
  project             = google_project.stamp.project_id
  name                = "app"
  location            = var.region
  deletion_protection = false
  template {
    service_account = google_service_account.app.email
    scaling {
      min_instance_count = var.app_min_instances
      max_instance_count = 4
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = var.app_image
      ports {
        container_port = 8080
      }
      env {
        name  = "AUTH_TRUST_HOST"
        value = "true"
      }
      env {
        name  = "DB_POOL_MAX"
        value = "5"
      }
      env {
        name  = "VERTEX_PROJECT"
        value = google_project.stamp.project_id
      }
      env {
        name  = "VERTEX_LOCATION"
        value = var.region
      }
      env {
        # Project-number URL form, not google_cloud_run_v2_service.n8n.uri:
        # n8n's own env already references app.uri, so referencing n8n.uri here
        # would be a circular resource dependency. This form is stable and
        # depends only on the project number, confirmed live (403 from Cloud
        # Run's IAM layer, not a DNS/routing failure) against the deployed
        # service before relying on it here.
        name  = "N8N_WEBHOOK_URL"
        value = "https://n8n-${data.google_project.stamp.number}.${var.region}.run.app/webhook"
      }
      dynamic "env" {
        for_each = { for k, v in {
          DATABASE_URL      = "database-url",
          AUTH_SECRET       = "auth-secret",
          AGENT_API_KEY     = "agent-api-key",
          JOBDIVA_CLIENT_ID = "jobdiva-client-id",
          JOBDIVA_USERNAME  = "jobdiva-username",
          JOBDIVA_PASSWORD  = "jobdiva-password"
        } : k => v if local.secret_has_value[v] }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.s, google_artifact_registry_repository_iam_member.stamp_pulls_images]
  lifecycle {
    ignore_changes = [template[0].containers[0].image] # CI owns the image
  }
}

resource "google_cloud_run_v2_service_iam_member" "app_public" {
  project    = google_project.stamp.project_id
  location   = var.region
  name       = google_cloud_run_v2_service.app.name
  role       = "roles/run.invoker"
  member     = "allUsers"
  depends_on = [google_org_policy_policy.allow_public_invoker]
}

# ---------- Cloud Run: n8n (IAM-only; reach editor via `gcloud run services proxy`) ----------
resource "google_cloud_run_v2_service" "n8n" {
  project             = google_project.stamp.project_id
  name                = "n8n"
  location            = var.region
  deletion_protection = false
  template {
    service_account = google_service_account.n8n.email
    scaling {
      min_instance_count = 1
      max_instance_count = 1 # cron triggers need always-on
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = var.n8n_image
      ports {
        container_port = 5678
      }
      env {
        name  = "DB_TYPE"
        value = "postgresdb"
      }
      env {
        name  = "DB_POSTGRESDB_HOST"
        value = local.db_host
      }
      env {
        name  = "DB_POSTGRESDB_DATABASE"
        value = "n8n"
      }
      env {
        name  = "DB_POSTGRESDB_USER"
        value = "n8n"
      }
      env {
        name  = "N8N_DIAGNOSTICS_ENABLED"
        value = "false"
      }
      env {
        name  = "AGENCYOS_URL"
        value = google_cloud_run_v2_service.app.uri
      }
      dynamic "env" {
        # jobdiva-* deliberately excluded: no n8n workflow calls JobDiva yet.
        for_each = { for k, v in {
          DB_POSTGRESDB_PASSWORD = "n8n-db-password",
          N8N_ENCRYPTION_KEY     = "n8n-encryption-key",
          AGENCYOS_AGENT_API_KEY = "agent-api-key",
        } : k => v if local.secret_has_value[v] }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.s]
  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }
}
# NOTE: no allUsers invoker on n8n — IAM auth required by omission.
resource "google_cloud_run_v2_service_iam_member" "app_invokes_n8n" {
  project  = google_project.stamp.project_id
  location = var.region
  name     = google_cloud_run_v2_service.n8n.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.app.email}"
}

# ---------- Cloud Run Job: migrate ----------
resource "google_cloud_run_v2_job" "migrate" {
  project             = google_project.stamp.project_id
  name                = "migrate"
  location            = var.region
  deletion_protection = false
  template {
    template {
      service_account = google_service_account.app.email
      vpc_access {
        network_interfaces {
          network    = google_compute_network.vpc.id
          subnetwork = google_compute_subnetwork.main.id
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
      containers {
        image = var.migrate_image
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s["database-url"].secret_id
              version = "latest"
            }
          }
        }
      }
      max_retries = 0
    }
  }
  depends_on = [google_secret_manager_secret_version.s, google_artifact_registry_repository_iam_member.stamp_pulls_images]
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
  }
}

# ---------- domain + monitoring ----------
resource "google_cloud_run_domain_mapping" "app" {
  count    = var.custom_domain == null ? 0 : 1
  project  = google_project.stamp.project_id
  location = var.region
  name     = var.custom_domain
  metadata {
    namespace = google_project.stamp.project_id
  }
  spec {
    route_name = google_cloud_run_v2_service.app.name
  }
}

resource "google_monitoring_notification_channel" "email" {
  project      = google_project.stamp.project_id
  display_name = "operator email"
  type         = "email"
  labels       = { email_address = var.alert_email }
  depends_on   = [google_project_service.apis]
}

resource "google_monitoring_uptime_check_config" "app" {
  project      = google_project.stamp.project_id
  display_name = "app login"
  timeout      = "10s"
  period       = "300s"
  http_check {
    path         = "/login"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = google_project.stamp.project_id
      host       = replace(google_cloud_run_v2_service.app.uri, "https://", "")
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  project               = google_project.stamp.project_id
  display_name          = "app down"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  conditions {
    display_name = "uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.app.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "600s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_FRACTION_TRUE"
        cross_series_reducer = "REDUCE_MIN"
      }
    }
  }
}
