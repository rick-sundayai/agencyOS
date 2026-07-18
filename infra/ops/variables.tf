variable "org_id" {
  type = string
}
variable "billing_account" {
  type = string
}
variable "ops_project_id" {
  type = string # e.g. "agencyos-ops"
}
variable "region" {
  type    = string
  default = "us-central1"
}
variable "github_repo" {
  type    = string
  default = "rick-sundayai/agencyOS"
}
