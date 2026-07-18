output "app_url" {
  value = google_cloud_run_v2_service.app.uri
}

output "project_id" {
  value = google_project.stamp.project_id
}
