terraform {
  required_version = ">= 1.7"
  backend "gcs" {
    bucket = "agencyos-ops-tfstate" # ops output; adjust if different
    prefix = "stamps/staging"
  }
}

variable "org_id" {
  type = string
}

variable "billing_account" {
  type = string
}

variable "deployer_sa" {
  type = string
}

variable "alert_email" {
  type = string
}

variable "artifact_registry" {
  type = string # e.g. us-central1-docker.pkg.dev/agencyos-ops/agencyos
}

provider "google" {
  region = "us-central1"
}

module "stamp" {
  source          = "../../modules/stamp"
  stamp_name      = "staging"
  project_id      = "agencyos-staging"
  org_id          = var.org_id
  billing_account = var.billing_account
  deployer_sa     = var.deployer_sa
  alert_email     = var.alert_email
  app_image       = "${var.artifact_registry}/app:bootstrap"
  migrate_image   = "${var.artifact_registry}/migrate:bootstrap"
}

output "app_url" {
  value = module.stamp.app_url
}
