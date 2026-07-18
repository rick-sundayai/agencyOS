output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${google_project.ops.project_id}/agencyos"
}
output "tfstate_bucket" { value = google_storage_bucket.tfstate.name }
output "wif_provider" { value = google_iam_workload_identity_pool_provider.github.name }
output "deployer_sa" { value = google_service_account.deployer.email }
