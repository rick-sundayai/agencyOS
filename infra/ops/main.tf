terraform {
  required_version = ">= 1.7"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
  # First apply uses local state; then migrate:
  # terraform init -migrate-state  (uncomment after the bucket exists)
  # backend "gcs" {
  #   bucket = "agencyos-ops-tfstate"
  #   prefix = "ops"
  # }
}

provider "google" {
  project = var.ops_project_id
  region  = var.region
}

resource "google_project" "ops" {
  name            = "AgencyOS Ops"
  project_id      = var.ops_project_id
  org_id          = var.org_id
  billing_account = var.billing_account
  deletion_policy = "PREVENT"
}

resource "google_project_service" "ops" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "iamcredentials.googleapis.com",
    "iam.googleapis.com",
    "storage.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudbilling.googleapis.com",
  ])
  project = google_project.ops.project_id
  service = each.value
}

resource "google_storage_bucket" "tfstate" {
  project                     = google_project.ops.project_id
  name                        = "${var.ops_project_id}-tfstate"
  location                    = "US"
  uniform_bucket_level_access = true
  versioning { enabled = true }
  public_access_prevention = "enforced"
}

resource "google_artifact_registry_repository" "agencyos" {
  project       = google_project.ops.project_id
  location      = var.region
  repository_id = "agencyos"
  format        = "DOCKER"
  depends_on    = [google_project_service.ops]
}

# --- CI identity: GitHub Actions -> GCP via Workload Identity Federation ---
resource "google_service_account" "deployer" {
  project      = google_project.ops.project_id
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = google_project.ops.project_id
  workload_identity_pool_id = "github"
  depends_on                = [google_project_service.ops]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = google_project.ops.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }
  attribute_condition = "assertion.repository == \"${var.github_repo}\""
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  project    = google_project.ops.project_id
  location   = var.region
  repository = google_artifact_registry_repository.agencyos.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}
